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
