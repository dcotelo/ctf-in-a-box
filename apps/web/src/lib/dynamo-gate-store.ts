import "server-only";
import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { CTF_DYNAMO_TABLE, getDynamoClient } from "@/lib/dynamo";
import { GATE_PK, gateSk, getN } from "@/lib/dynamo-shapes";

/**
 * Brute-force throttle for the challenges gate, one item per client IP under
 * pk=GATE. Five failed password attempts lock the IP for 24 hours. Used in
 * every CTF_DATA_BACKEND mode — DynamoDB credentials are ambient (Vercel OIDC
 * / the SDK default chain).
 *
 * These items hold a client IP address, which is personal data, so they carry
 * a 30-day `ttl` for DynamoDB to reap. Two things to understand about that:
 *
 *  1. The TTL is a RETENTION bound, not the lock mechanism. DynamoDB deletes
 *     expired items on a best-effort basis (typically within 48h of expiry),
 *     which is far too loose to enforce a 24h lock. The lock window is still
 *     enforced on read — an expired window is treated as a fresh start — so
 *     the throttle is correct regardless of when the reaper actually runs.
 *  2. The `ttl` attribute does nothing unless TTL is ENABLED on the table with
 *     AttributeName "ttl". That is table-level infra config, not something
 *     this code can assert. If it is off, these items simply persist, which is
 *     the behaviour we had before. See README for the enable step.
 *
 * consumeGateAttempt deliberately THROWS on transport errors: the caller fails
 * closed (500), so a DynamoDB outage can never disable the throttle.
 *
 * ORDERING IS THE WHOLE POINT. The attempt is charged BEFORE the password is
 * compared, in a single conditional write. The previous design read the
 * counter, decided, compared, and only then wrote — four statements with
 * nothing serialising concurrent same-IP requests, so N parallel POSTs all
 * observed the same pre-burst counter and all reached the compare. The
 * throttle bounded sequential guessing and nothing else.
 */

export const GATE_MAX_FAILURES = 5;
export const GATE_LOCK_MS = 24 * 60 * 60 * 1000;
/** Retention bound for the IP address held in a throttle item. */
export const GATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type GateThrottle = { failures: number; lastFailAt: number } | null;

/** DynamoDB TTL wants epoch SECONDS, not milliseconds. Exported so the
 *  retention window is directly testable. */
export function gateTtlSeconds(now: number): number {
  return Math.floor((now + GATE_TTL_MS) / 1000);
}

export async function getGateThrottle(ip: string): Promise<GateThrottle> {
  const res = await getDynamoClient().send(
    new GetItemCommand({
      TableName: CTF_DYNAMO_TABLE,
      Key: { pk: { S: GATE_PK }, sk: { S: gateSk(ip) } },
      // A throttle read that can return a stale counter is a throttle an
      // attacker can outrun. Eventually-consistent is the SDK default.
      ConsistentRead: true,
    }),
  );
  if (!res.Item) return null;
  return throttleFromItem(res.Item);
}

function throttleFromItem(item: Record<string, AttributeValue>): GateThrottle {
  return { failures: getN(item, "failures"), lastFailAt: getN(item, "lastFailAt") };
}

/** Seconds until the lock lifts; 0 = not locked. Pure so the lock math is
 *  directly testable. */
export function gateLockRemainingSeconds(throttle: GateThrottle, now: number): number {
  if (!throttle || throttle.failures < GATE_MAX_FAILURES) return 0;
  const liftAt = throttle.lastFailAt + GATE_LOCK_MS;
  return now < liftAt ? Math.ceil((liftAt - now) / 1000) : 0;
}

export type GateVerdict =
  /** Budget was charged. The caller may now compare the password. */
  | { allowed: true }
  /** Locked out. Never let the caller compare. */
  | { allowed: false; retryAfterSeconds: number };

/**
 * Charge one attempt against this IP's budget and say whether the caller may
 * proceed to the password compare. Atomic: the increment and the lock decision
 * are the same conditional write, so concurrent requests serialise on
 * DynamoDB's per-item conditional semantics rather than racing.
 *
 * Two writes, because "increment" and "restart an expired window" are
 * different operations and DynamoDB cannot express both in one expression:
 *
 *   1. Conditional Put — succeeds only for an unseen IP or one whose lock
 *      window has already lapsed. Resets the counter to 1.
 *   2. Conditional Update — the item exists inside a live window, so ADD one,
 *      guarded by `failures < GATE_MAX_FAILURES`. The guard is what a
 *      concurrent burst collides with: exactly one request can take the last
 *      unit of budget, and the rest get ConditionalCheckFailed.
 *
 * Note the caller is charged for a SUCCESSFUL attempt too — the compare has
 * not happened yet and cannot, without reintroducing the race. The successful
 * caller's budget is returned by clearGateThrottle, and it leaves holding a
 * 30-day unlock cookie either way. See the route for why that is survivable.
 */
export async function consumeGateAttempt(ip: string, now: number): Promise<GateVerdict> {
  const key = { pk: { S: GATE_PK }, sk: { S: gateSk(ip) } };
  const windowStart = now - GATE_LOCK_MS;

  try {
    await getDynamoClient().send(
      new PutItemCommand({
        TableName: CTF_DYNAMO_TABLE,
        Item: {
          ...key,
          failures: { N: "1" },
          lastFailAt: { N: String(now) },
          ttl: { N: String(gateTtlSeconds(now)) },
        },
        // Unseen IP, or the previous window has lapsed and this is a fresh
        // start. `attribute_not_exists(pk)` is the idiomatic "item absent"
        // test: pk is the partition key, so it exists iff the item does.
        ConditionExpression: "attribute_not_exists(pk) OR #lastFailAt <= :windowStart",
        ExpressionAttributeNames: { "#lastFailAt": "lastFailAt" },
        ExpressionAttributeValues: { ":windowStart": { N: String(windowStart) } },
        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      }),
    );
    return { allowed: true };
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
    // Live window. If the returned item already shows the cap, answer from it
    // rather than spending a second write to be told the same thing.
    const prior = err.Item ? throttleFromItem(err.Item) : await getGateThrottle(ip);
    const locked = gateLockRemainingSeconds(prior, now);
    if (locked > 0) return { allowed: false, retryAfterSeconds: locked };
  }

  try {
    // The TTL is refreshed on every charged attempt so an actively-attacked IP
    // keeps its counter for the full window rather than being reaped mid-attack.
    await getDynamoClient().send(
      new UpdateItemCommand({
        TableName: CTF_DYNAMO_TABLE,
        Key: key,
        UpdateExpression: "ADD #failures :one SET #lastFailAt = :now, #ttl = :ttl",
        // `attribute_not_exists(#failures)` is not reachable through this
        // module's own writes, which always set failures and lastFailAt
        // together. It is here so that an item malformed by anything else
        // cannot wedge this IP into a permanent 500: without it the condition
        // is false forever and the ADD can never repair the item.
        ConditionExpression: "attribute_not_exists(#failures) OR #failures < :max",
        ExpressionAttributeNames: {
          "#failures": "failures",
          "#lastFailAt": "lastFailAt",
          "#ttl": "ttl",
        },
        ExpressionAttributeValues: {
          ":one": { N: "1" },
          ":now": { N: String(now) },
          ":ttl": { N: String(gateTtlSeconds(now)) },
          ":max": { N: String(GATE_MAX_FAILURES) },
        },
        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      }),
    );
    return { allowed: true };
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
    const prior = err.Item ? throttleFromItem(err.Item) : await getGateThrottle(ip);
    // Clamp to 1: the condition only fails inside a live window, so zero here
    // would be a contradiction, and Retry-After: 0 reads as "retry now".
    return { allowed: false, retryAfterSeconds: Math.max(1, gateLockRemainingSeconds(prior, now)) };
  }
}

/**
 * Return the budget after a successful unlock. Best-effort by contract — a
 * failed delete must never block the 200 — but it matters more than it used
 * to, because attempts are now charged before the compare. Someone who typos
 * four times and gets it right on the fifth has spent the whole budget; if
 * this delete does not land, that IP is at the cap holding the correct
 * password. Hence the retry.
 *
 * Even in the worst case they are not locked out of anything they need right
 * now: the 200 that follows carries a 30-day unlock cookie. The cost is that a
 * SECOND unlock from that IP (another device, a cleared cookie) is refused
 * until the window lapses.
 *
 * Returns whether the item is gone, so the caller can log the difference.
 */
export async function clearGateThrottle(ip: string): Promise<boolean> {
  const command = new DeleteItemCommand({
    TableName: CTF_DYNAMO_TABLE,
    Key: { pk: { S: GATE_PK }, sk: { S: gateSk(ip) } },
  });
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await getDynamoClient().send(command);
      return true;
    } catch (err) {
      if (attempt === 2) {
        console.error(`[gate] throttle clear failed after retry: ${(err as Error).message}`);
        return false;
      }
    }
  }
  return false;
}
