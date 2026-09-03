// Minimal Upstash REST / SRH client for the sync poller — same wire protocol
// as scorer/src/store.js and apps/web/src/lib/upstash.ts: POST /pipeline with
// a JSON array of command arrays, bearer token, positional { result } replies.
const SYNC_STATUS_KEY = "ctf:sync:status";
const ADMIN_SETTINGS_KEY = "ctf:admin:settings";

// Scheduled scoring window: true when `now` is before start / after end.
// Absent/unparseable bounds are ignored. Mirrors apps/web admin-store.ts
// and scorer/src/store.js — change all three together.
export function outsideWindow(nowMs, startsAt, endsAt) {
  const s = startsAt ? Date.parse(startsAt) : NaN;
  const e = endsAt ? Date.parse(endsAt) : NaN;
  if (Number.isFinite(s) && nowMs < s) return true;
  if (Number.isFinite(e) && nowMs > e) return true;
  return false;
}

// How long one /pipeline round trip may take before it is treated as a failed
// read. A backend that accepts the connection and never answers would
// otherwise stall the tick forever, and `restart: on-failure` cannot help a
// process that never exits. Well above any healthy SRH/Redis latency.
const PIPELINE_TIMEOUT_MS = 10_000;

/** The loggable part of a Redis error reply. Redis's unknown-command error
 *  echoes the command's own arguments ("…, with args beginning with: …");
 *  those are whatever the caller sent, so the tail is dropped and the rest
 *  capped before it can reach a log line. */
export function redisErrorText(error) {
  return String(error).replace(/,?\s*with args beginning with:.*$/s, "").slice(0, 200);
}

/** The poller's Redis client, or null when UPSTASH_REDIS_REST_URL/TOKEN are
 *  unset (a poller with no Redis still polls; it just cannot see the freeze
 *  or write its heartbeat). `fetchImpl`, `log` and `timeoutMs` are seams. */
export function makeRedis(env = process.env, fetchImpl = fetch, log = console.error, { timeoutMs = PIPELINE_TIMEOUT_MS } = {}) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const base = url.replace(/\/$/, "");

  /** One POST /pipeline round trip; throws on HTTP failure, timeout, or any
   *  per-command error, so callers only ever see results or an exception. */
  async function pipeline(commands) {
    const res = await fetchImpl(`${base}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`upstash pipeline: HTTP ${res.status}`);
    const results = await res.json();
    // A per-command failure (WRONGTYPE, NOAUTH, a command SRH does not
    // implement) comes back as { error } inside a 200. Left unchecked it
    // decodes as `undefined`, which every caller would silently read as
    // "not paused" / "no reset" / "written" — the same fail-open answer,
    // minus the log line that makes an outage visible. Throw, so each
    // caller's catch applies its documented direction AND says so.
    const bad = results.find((r) => r.error);
    if (bad) throw new Error(`upstash: ${redisErrorText(bad.error)}`);
    return results.map((r) => r.result);
  }

  return {
    async isPaused() {
      try {
        // Effective freeze = manual toggle OR scheduled scoring window.
        const [row] = await pipeline([
          ["HMGET", ADMIN_SETTINGS_KEY, "paused", "scoringStartsAt", "scoringEndsAt"],
        ]);
        const [paused, startsAt, endsAt] = Array.isArray(row) ? row : [];
        if (paused === "1") return true;
        return outsideWindow(Date.now(), startsAt, endsAt);
      } catch (err) {
        log(`redis isPaused: ${err.message}`);
        return false; // fail open: a Redis blip must not freeze ingestion
      }
    },
    // The master-reset epoch. The admin panel bumps `resetAt` in the settings
    // hash on a wipe; the poller compares it against its own last-seen value
    // and drops its cursor when it advances, so a poll-mode reset actually
    // sticks instead of being re-ingested from the same PR comments.
    async getResetAt() {
      try {
        const [v] = await pipeline([["HGET", ADMIN_SETTINGS_KEY, "resetAt"]]);
        return v ?? null;
      } catch (err) {
        log(`redis getResetAt: ${err.message}`);
        return null; // treat as "no reset" on error — retries next tick
      }
    },
    async writeStatus(s) {
      try {
        const fields = [
          "lastPollAt", s.lastPollAt,
          "ingested", String(s.ingested),
          // Comments consumed that will never become a score without a human.
          // Cumulative and monotonic like `ingested` — unlike `lastError`,
          // which describes only the tick that wrote it. A drop is not
          // self-healing, so it must not be cleared by the next quiet tick.
          "dropped", String(s.dropped ?? 0),
          "reposPolled", String(s.reposPolled),
          "paused", s.paused ? "1" : "0",
        ];
        if (s.lastError) fields.push("lastError", s.lastError);
        if (s.lastDrop) fields.push("lastDrop", s.lastDrop);
        const cmds = [["HSET", SYNC_STATUS_KEY, ...fields]];
        if (!s.lastError) cmds.push(["HDEL", SYNC_STATUS_KEY, "lastError"]);
        await pipeline(cmds);
      } catch (err) {
        log(`redis writeStatus: ${err.message}`);
      }
    },
  };
}
