// Integration tests: exercises the REAL reveal Lua script against the live
// Upstash DB, because that's where charge-once idempotency is actually
// enforced (atomically). Injects a run-unique field into hints:juice-shop and
// uses run-unique logins; everything is cleaned up before and after. Skips
// entirely when Upstash credentials are not available (e.g. CI without
// secrets).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Credentials come from the environment, falling back to .env.local locally.
for (const file of [path.resolve(process.cwd(), ".env.local")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1 || line.trimStart().startsWith("#")) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key.startsWith("UPSTASH_REDIS_REST_") && !process.env[key]) process.env[key] = value;
  }
}
const configured = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
// The suite exercises the reveal Lua script, not the HINTS_ENABLED gate — the
// gate has its own unit tests. Opt in explicitly so the store loads enabled.
if (configured) process.env.HINTS_ENABLED = "true";

const RUN = Date.now().toString(36);
const PLAYER = `vt-${RUN}-hints-p1`;
const HINT_ID = `vt-${RUN}-challenge`;
const HINT_TEXT = `throwaway hint for test run ${RUN}`;
const HINT_HASH = "hints:juice-shop";

describe.skipIf(!configured)("hint store against live Upstash (throwaway keys)", () => {
  let store: typeof import("@/lib/hint-store");
  let pipeline: (typeof import("@/lib/upstash"))["upstashPipeline"];

  async function cleanup() {
    await pipeline([
      ["HDEL", HINT_HASH, HINT_ID],
      ["HDEL", "ctf:hints:spent", PLAYER],
      ["DEL", `ctf:user:${PLAYER}:hints`],
    ]);
  }

  beforeAll(async () => {
    store = await import("@/lib/hint-store");
    ({ upstashPipeline: pipeline } = await import("@/lib/upstash"));
    await cleanup();
    await pipeline([["HSET", HINT_HASH, HINT_ID, HINT_TEXT]]);
  });

  afterAll(async () => {
    await cleanup();
  });

  it("charges the first reveal", async () => {
    const result = await store.revealHint(PLAYER, "juice-shop", HINT_ID);
    expect(result).toEqual({
      ok: true,
      hint: HINT_TEXT,
      alreadyOwned: false,
      spent: store.HINT_COST,
    });
  });

  it("returns the second reveal for free — spent is unchanged", async () => {
    const result = await store.revealHint(PLAYER, "juice-shop", HINT_ID);
    expect(result).toEqual({
      ok: true,
      hint: HINT_TEXT,
      alreadyOwned: true,
      spent: store.HINT_COST,
    });
    const [spent] = await pipeline([["HGET", "ctf:hints:spent", PLAYER]]);
    expect(Number(spent.result)).toBe(store.HINT_COST);
  });

  it("reports the purchase in the viewer state and penalty map", async () => {
    const viewer = await store.getViewerHints(PLAYER);
    expect(viewer.purchased["juice-shop"]?.[HINT_ID]).toBe(HINT_TEXT);
    expect(viewer.spent).toBe(store.HINT_COST);
    expect(viewer.count).toBe(1);

    const penalties = await store.getHintPenalties();
    expect(penalties.get(PLAYER)).toBe(store.HINT_COST);
  });

  it("refuses to charge for a hint that does not exist", async () => {
    const result = await store.revealHint(PLAYER, "juice-shop", `vt-${RUN}-no-such-hint`);
    expect(result).toEqual({ ok: false, missing: true, error: "No hint available for this challenge" });
    const [spent] = await pipeline([["HGET", "ctf:hints:spent", PLAYER]]);
    expect(Number(spent.result)).toBe(store.HINT_COST);
  });
});
