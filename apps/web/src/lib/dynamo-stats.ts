import "server-only";
import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { CTF_DYNAMO_TABLE, getDynamoClient } from "@/lib/dynamo";
import { STATS_PK, countrySk } from "@/lib/dynamo-shapes";

/**
 * Aggregate reach counters: how many visits came from each country, and
 * nothing else.
 *
 * This is deliberately the most boring store in the app. One item per country,
 * holding a single integer. There is no login on it, no IP address (hashed or
 * otherwise), no timestamp, and no session id — so there is nothing here to
 * join back to a person even with the rest of the table in hand. That is the
 * whole design: answer "roughly where did contestants come from" without
 * building a location history for anybody.
 *
 * If you are tempted to add a field, read src/app/(site)/privacy/page.tsx
 * first — the page makes a specific promise about this data.
 *
 * Counts are approximate by construction: one increment per browser session,
 * so a contestant on two devices counts twice and the numbers are a measure of
 * reach, not a headcount. They are also unauthenticated, so treat them as a
 * rough signal rather than a figure to publish precisely.
 */

/** ISO 3166-1 alpha-2, as an edge/proxy geo header supplies it. Anything else
 *  is dropped rather than stored — this value becomes part of a sort key, so
 *  it is validated, never interpolated on trust. */
const ISO_3166_ALPHA2 = /^[A-Z]{2}$/;

export function normalizeCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return ISO_3166_ALPHA2.test(code) ? code : null;
}

/**
 * Increment one country's counter. Best-effort by contract: analytics must
 * never break a request, so transport errors are swallowed after logging.
 * The log line carries the country code only, which is already aggregate.
 */
export async function recordCountryVisit(country: string): Promise<void> {
  const code = normalizeCountry(country);
  if (!code) return;

  try {
    await getDynamoClient().send(
      new UpdateItemCommand({
        TableName: CTF_DYNAMO_TABLE,
        Key: { pk: { S: STATS_PK }, sk: { S: countrySk(code) } },
        UpdateExpression: "ADD #count :one",
        ExpressionAttributeNames: { "#count": "count" },
        ExpressionAttributeValues: { ":one": { N: "1" } },
      }),
    );
  } catch (err) {
    console.error(`[stats] country counter failed: ${(err as Error).message}`);
  }
}
