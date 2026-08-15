// Solve store: one Redis hash per target, one field per (author, challenge).
// Writes are monotonic — HSETNX semantics keep the FIRST solve timestamp and
// make replays no-ops. Reads are one HGETALL per known target. The memory
// store mirrors the same contract for tests/dev.

export const solvesKey = (target) => `ctf:solves:${target}`;
const solveField = (author, id) => `${author}:${id}`;
// Same key/field the app (admin-store.ts) writes and the sync poller
// (sync/src/redis.js) reads — "1" means paused, anything else does not.
const ADMIN_SETTINGS_KEY = "ctf:admin:settings";

export function createMemoryStore() {
  const hashes = new Map(); // key -> Map(field -> ISO timestamp)
  let paused = false; // test seam mirroring ctf:admin:settings.paused
  return {
    async recordSolves(target, author, ids, at) {
      let hash = hashes.get(solvesKey(target));
      if (!hash) hashes.set(solvesKey(target), (hash = new Map()));
      for (const id of ids) {
        const field = solveField(author, id);
        if (!hash.has(field)) hash.set(field, at); // HSETNX: replays no-op
      }
    },
    async getSolves(target) {
      return Object.fromEntries(hashes.get(solvesKey(target)) ?? []);
    },
    async isPaused() {
      return paused;
    },
    __setPaused(v) {
      paused = v;
    },
  };
}

// Upstash REST / SRH client — same wire protocol as apps/web/src/lib/upstash.ts:
// POST /pipeline with a JSON array of command arrays, bearer token; results
// come back positionally as { result } or { error }. Only HSETNX + HGETALL are
// used, a subset SRH's env mode supports.
export function createRedisStore({
  url = process.env.UPSTASH_REDIS_REST_URL,
  token = process.env.UPSTASH_REDIS_REST_TOKEN,
  fetchImpl = fetch,
} = {}) {
  if (!url || !token) throw new Error("UPSTASH_REDIS_REST_URL/TOKEN are not set");
  const base = url.replace(/\/$/, "");

  async function pipeline(commands) {
    const res = await fetchImpl(`${base}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`upstash pipeline: HTTP ${res.status}`);
    const results = await res.json();
    const bad = results.find((r) => r.error);
    if (bad) throw new Error(`upstash: ${bad.error}`);
    return results.map((r) => r.result);
  }

  return {
    async recordSolves(target, author, ids, at) {
      if (ids.length === 0) return;
      await pipeline(ids.map((id) => ["HSETNX", solvesKey(target), solveField(author, id), at]));
    },
    async getSolves(target) {
      const [raw] = await pipeline([["HGETALL", solvesKey(target)]]);
      // REST HGETALL returns a flat [field, value, ...] array.
      const out = {};
      if (Array.isArray(raw)) {
        for (let i = 0; i < raw.length; i += 2) out[raw[i]] = raw[i + 1];
      } else if (raw && typeof raw === "object") {
        Object.assign(out, raw);
      }
      return out;
    },
    async isPaused() {
      try {
        const [v] = await pipeline([["HGET", ADMIN_SETTINGS_KEY, "paused"]]);
        return v === "1";
      } catch {
        // Fail OPEN, not closed: this is a live-scoring endpoint, not an
        // authz gate. A Redis blip must never silently drop real submissions
        // just because the pause check itself couldn't be answered — the
        // freeze is a deliberate organizer action, not the safe default.
        return false;
      }
    },
  };
}
