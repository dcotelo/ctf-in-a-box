import "server-only";
import {
  BatchGetItemCommand,
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  TransactionCanceledException,
  type CancellationReason,
} from "@aws-sdk/client-dynamodb";
import { CTF_DYNAMO_TABLE, getDynamoClient } from "@/lib/dynamo";
import {
  HINTSPEND_PK,
  HINTS_PK,
  HINT_SK_PREFIX,
  getN,
  getS,
  hintPurchaseItem,
  hintSk,
  spendSk,
  userPk,
  type DynamoItem,
} from "@/lib/dynamo-shapes";

/**
 * DynamoDB half of the hint store. The Lua charge-if-new maps to one transaction:
 * a conditional Put of the purchase item (attribute_not_exists = the SADD-style
 * charge-once guard) plus an ADD on the spend aggregate — a double-click or a race
 * across two tabs still can't charge twice. Hint TEXT is served from pk=HINTS,
 * which the backfill copies from the scorer-seeded Upstash hashes — Upstash stays
 * the authority, so the backfill must be re-run after any hint re-seeding.
 */

export type DynamoChargeResult = { status: "charged" | "owned"; spent: number } | { status: "error" };

const failed = (reason: CancellationReason | undefined) => reason?.Code === "ConditionalCheckFailed";

async function readSpent(login: string): Promise<number> {
  const res = await getDynamoClient().send(
    new GetItemCommand({
      TableName: CTF_DYNAMO_TABLE,
      Key: { pk: { S: HINTSPEND_PK }, sk: { S: spendSk(login) } },
    }),
  );
  return getN(res.Item, "spent");
}

export async function dynamoChargeHint(login: string, app: string, id: string, cost: number): Promise<DynamoChargeResult> {
  try {
    await getDynamoClient().send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Put: {
              TableName: CTF_DYNAMO_TABLE,
              Item: hintPurchaseItem({ login, app, id, cost, purchasedAt: new Date().toISOString() }),
              ConditionExpression: "attribute_not_exists(pk)",
            },
          },
          {
            Update: {
              TableName: CTF_DYNAMO_TABLE,
              Key: { pk: { S: HINTSPEND_PK }, sk: { S: spendSk(login) } },
              UpdateExpression: "ADD #spent :cost SET #login = :login, #updatedAt = :now",
              ExpressionAttributeNames: { "#spent": "spent", "#login": "login", "#updatedAt": "updatedAt" },
              ExpressionAttributeValues: {
                ":cost": { N: String(cost) },
                ":login": { S: login },
                ":now": { S: new Date().toISOString() },
              },
            },
          },
        ],
      }),
    );
    // The exact total needs a follow-up read (transactions don't return values);
    // the tiny race window only affects the number echoed back, never the charge.
    return { status: "charged", spent: await readSpent(login) };
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      const [purchaseReason] = err.CancellationReasons ?? [];
      if (failed(purchaseReason)) {
        try {
          return { status: "owned", spent: await readSpent(login) };
        } catch {
          return { status: "owned", spent: 0 };
        }
      }
    }
    console.error(`[dynamo] chargeHint failed: ${(err as Error).message}`);
    return { status: "error" };
  }
}

/** One hint's text from pk=HINTS, or null when no such hint exists. Throws on
 *  transport errors — the caller maps those to its own error shape. */
export async function dynamoGetHintText(app: string, id: string): Promise<string | null> {
  const res = await getDynamoClient().send(
    new GetItemCommand({
      TableName: CTF_DYNAMO_TABLE,
      Key: { pk: { S: HINTS_PK }, sk: { S: hintSk(app, id) } },
    }),
  );
  return getS(res.Item, "text");
}

/** Texts for many app/id pairs at once, order-preserving (null where the hint
 *  is missing). BatchGetItem caps at 100 keys per call and may return
 *  UnprocessedKeys under throttling — both are handled here. */
export async function dynamoGetHintTexts(refs: { app: string; id: string }[]): Promise<(string | null)[]> {
  const bySk = new Map<string, string>();
  for (let start = 0; start < refs.length; start += 100) {
    let keys: DynamoItem[] = refs
      .slice(start, start + 100)
      .map(({ app, id }) => ({ pk: { S: HINTS_PK }, sk: { S: hintSk(app, id) } }));
    // A few retries is plenty at this table's scale; anything still unprocessed
    // after that degrades to "missing", the same as a deleted hint.
    for (let attempt = 0; keys.length > 0 && attempt < 3; attempt++) {
      const res = await getDynamoClient().send(
        new BatchGetItemCommand({ RequestItems: { [CTF_DYNAMO_TABLE]: { Keys: keys } } }),
      );
      for (const item of res.Responses?.[CTF_DYNAMO_TABLE] ?? []) {
        const sk = getS(item, "sk");
        const text = getS(item, "text");
        if (sk && text) bySk.set(sk, text);
      }
      keys = (res.UnprocessedKeys?.[CTF_DYNAMO_TABLE]?.Keys ?? []) as DynamoItem[];
    }
    if (keys.length > 0) console.warn(`[dynamo] ${keys.length} hint text keys unprocessed after retries`);
  }
  return refs.map(({ app, id }) => bySk.get(hintSk(app, id)) ?? null);
}

/** Which challenge ids have a hint, per app — one pk=HINTS Query with the text
 *  projected OUT, so the result is safe for the public availability shape. */
export async function dynamoGetHintAvailability(): Promise<Record<string, string[]>> {
  const byApp: Record<string, string[]> = {};
  let cursor: DynamoItem | undefined;
  do {
    const page = await getDynamoClient().send(
      new QueryCommand({
        TableName: CTF_DYNAMO_TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": { S: HINTS_PK } },
        ProjectionExpression: "#app, #id",
        ExpressionAttributeNames: { "#app": "app", "#id": "challengeId" },
        ExclusiveStartKey: cursor,
      }),
    );
    for (const item of page.Items ?? []) {
      const app = getS(item, "app");
      const id = getS(item, "challengeId");
      if (app && id) (byApp[app] ??= []).push(id);
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return byApp;
}

/** The viewer's purchases (app/challenge pairs, no text) plus their spend total. */
export async function dynamoGetViewerPurchases(login: string): Promise<{ purchases: { app: string; id: string }[]; spent: number }> {
  const purchases: { app: string; id: string }[] = [];
  let cursor: DynamoItem | undefined;
  do {
    const page = await getDynamoClient().send(
      new QueryCommand({
        TableName: CTF_DYNAMO_TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": { S: userPk(login) }, ":prefix": { S: HINT_SK_PREFIX } },
        ExclusiveStartKey: cursor,
      }),
    );
    for (const item of page.Items ?? []) {
      const app = getS(item, "app");
      const id = getS(item, "challengeId");
      if (app && id) purchases.push({ app, id });
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return { purchases, spent: await readSpent(login) };
}

/** Penalty points per login — one single-partition Query serves the whole
 *  leaderboard, the HGETALL ctf:hints:spent equivalent. */
export async function dynamoGetHintPenalties(): Promise<Map<string, number>> {
  const penalties = new Map<string, number>();
  let cursor: DynamoItem | undefined;
  do {
    const page = await getDynamoClient().send(
      new QueryCommand({
        TableName: CTF_DYNAMO_TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": { S: HINTSPEND_PK } },
        ExclusiveStartKey: cursor,
      }),
    );
    for (const item of page.Items ?? []) {
      const login = getS(item, "login");
      const spent = getN(item, "spent");
      if (login && spent > 0) penalties.set(login, spent);
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return penalties;
}

/**
 * Dual-mode wrapper: mirrors a charge Upstash (the authority) already confirmed.
 * Best-effort by contract — never throws, never blocks the response; a non-
 * "charged" verdict here means the stores disagree and is the drift signal to
 * investigate before cutting CTF_DATA_BACKEND over to "dynamo".
 */
export async function mirrorHintCharge(login: string, app: string, id: string, cost: number): Promise<void> {
  try {
    const result = await dynamoChargeHint(login, app, id, cost);
    if (result.status === "charged") console.log(`[dynamo-mirror] hint:purchase ok`);
    else console.warn(`[dynamo-mirror] hint:purchase verdict mismatch: upstash=charged dynamo=${result.status}`);
  } catch (err) {
    console.error(`[dynamo-mirror] hint:purchase failed: ${(err as Error).message}`);
  }
}
