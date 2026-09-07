import "server-only";

// Zero-dependency client for the Upstash Redis REST /pipeline endpoint,
// shared by the leaderboard reader and the team store. Commands are plain
// arrays (["HGET", key, field]); results come back positionally as
// { result } or { error } per command.

export type UpstashResult = { result?: unknown; error?: string };

/** How long one /pipeline round trip may take before it is an error. A
 *  backend that accepts the connection and never answers would otherwise
 *  hang the request until the platform kills it; surfacing it as an error
 *  lets each caller's documented fail-open/fail-closed rule apply instead.
 *  Well above any healthy SRH/Redis latency; same constant as
 *  scorer/src/store.js and sync/src/redis.js. */
const PIPELINE_TIMEOUT_MS = 10_000;

/** One POST /pipeline round trip. Throws on HTTP failure or timeout; a
 *  per-command `{ error }` is returned positionally for the caller to
 *  judge, because some callers (the reset's SCAN walk, the Lua evals) treat
 *  individual command failures differently. */
export async function upstashPipeline(
  commands: (string | number)[][],
  { timeoutMs = PIPELINE_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<UpstashResult[]> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("UPSTASH_REDIS_REST_URL/TOKEN are not set");
  const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Upstash pipeline failed: HTTP ${res.status}`);
  return (await res.json()) as UpstashResult[];
}

/**
 * One page of a SCAN walk, with the two failures that end a walk EARLY turned
 * into throws (issue #358).
 *
 * `upstashPipeline` reports a per-command failure as `{ error }` rather than
 * throwing, and every SCAN loop in this app used to read `scan.result` through
 * a `["0", []]` fallback. That fallback is not a harmless default: `"0"` is the
 * cursor value meaning ITERATION COMPLETE, so a failed page did not retry, did
 * not throw, and did not return empty — it ended the walk and handed back the
 * pages gathered so far, indistinguishable from a full sweep. A team went
 * missing from the leaderboard that way while `/profile` still showed it.
 *
 * The same shape sat behind the master reset (a partial wipe reported as a
 * completed count), the per-contestant solve clear, and two counters. Callers
 * differ in what they should DO about a failure — that is theirs to decide —
 * but none of them can decide anything about a failure they were never told
 * about. So this throws, and each caller applies its own documented fail
 * direction.
 */
export function parseScanPage(reply: UpstashResult, context: string): [string, string[]] {
  if (reply.error) throw new Error(`Upstash SCAN failed (${context}): ${reply.error}`);
  const page = reply.result;
  // A well-formed reply is [cursor, keys]. Anything else means the walk cannot
  // be trusted to have covered the keyspace, and "cursor 0" would claim it had.
  //
  // The ELEMENT types are checked, not just the outer shape: a page of
  // `[{}, [1]]` passes an Array.isArray-only guard, and then `String(page[0])`
  // hands the next SCAN the cursor `"[object Object]"` while a numeric key is
  // returned as `string[]` and interpolated into a key name. Both failures
  // land far from here, which is the opposite of the point.
  if (
    !Array.isArray(page) ||
    page.length < 2 ||
    (typeof page[0] !== "string" && typeof page[0] !== "number") ||
    !Array.isArray(page[1]) ||
    !page[1].every((key): key is string => typeof key === "string")
  ) {
    throw new Error(`Upstash SCAN returned an unexpected shape (${context}): ${JSON.stringify(page)}`);
  }
  // Redis answers the cursor as a bulk string; some proxies hand back a number.
  return [String(page[0]), page[1]];
}

/** Runs a Lua script as a single atomic Redis operation. */
export async function upstashEval(
  script: string,
  keys: string[],
  args: (string | number)[],
): Promise<unknown> {
  const [res] = await upstashPipeline([["EVAL", script, keys.length, ...keys, ...args]]);
  if (res.error) throw new Error(`Upstash EVAL failed: ${res.error}`);
  return res.result;
}
