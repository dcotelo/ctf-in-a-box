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

export function makeRedis(env = process.env, fetchImpl = fetch, log = console.error) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const base = url.replace(/\/$/, "");

  async function pipeline(commands) {
    const res = await fetchImpl(`${base}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`upstash pipeline: HTTP ${res.status}`);
    return (await res.json()).map((r) => r.result);
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
    async writeStatus(s) {
      try {
        const fields = [
          "lastPollAt", s.lastPollAt,
          "ingested", String(s.ingested),
          "reposPolled", String(s.reposPolled),
          "paused", s.paused ? "1" : "0",
        ];
        if (s.lastError) fields.push("lastError", s.lastError);
        const cmds = [["HSET", SYNC_STATUS_KEY, ...fields]];
        if (!s.lastError) cmds.push(["HDEL", SYNC_STATUS_KEY, "lastError"]);
        await pipeline(cmds);
      } catch (err) {
        log(`redis writeStatus: ${err.message}`);
      }
    },
  };
}
