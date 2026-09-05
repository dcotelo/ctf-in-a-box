// Integration tests: exercises the REAL reveal Lua script against a live Redis
// (srh in CI, Upstash or srh locally), because that's where charge-once
// idempotency is actually enforced (atomically). Injects a run-unique field
// into hints:juice-shop, a run-unique solve into ctf:solves:juice-shop and
// uses a run-unique login; everything is cleaned up before and after.
//
// The reveal path reads the organizer's runtime settings (ctf:admin:settings,
// via resolveHintConfig/hintGate) before it ever reaches the script: hints
// on/off, the price, the anti-burner gate (solves on the target before its
// hints can be bought) and the unlock-after phase. This suite writes those
// four explicitly, through the store's own updateAdminSettings, so it pins
// what the reveal does under a KNOWN policy rather than whatever the previous
// run (or the admin-store suite, which writes hintCost 25) left behind — and
// then EARNS its way through the gate by seeding a solve, so the gate is
// exercised, not switched off. That is what rotted the previous version of
// this suite (#235): it seeded no solve and no settings, and every reveal was
// refused by the default one-solve gate.
//
// Gating comes from live-redis.ts: skipped without the env, a FAILURE when
// CTF_LUA_SUITES_REQUIRED is set. The suite shares ctf:admin:settings with
// the admin-store suite, so the live run is serial (see ci.yml).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RUN, liveConfigured } from "./live-redis";

vi.mock("server-only", () => ({}));

const PLAYER = `vt-${RUN}-hints-p1`;
const TARGET = "juice-shop";
const HINT_ID = `vt-${RUN}-challenge`;
const HINT_TEXT = `throwaway hint for test run ${RUN}`;
const HINT_HASH = `hints:${TARGET}`;
const SOLVES_HASH = `ctf:solves:${TARGET}`;
// The scorer's solve row shape: `<author>:<challengeId>`; only the field
// name is read by the gate, so the value is a placeholder.
const SOLVE_FIELD = `${PLAYER}:vt-${RUN}-solved`;
/** Deliberately NOT the baked HINT_COST, and not the 25 the admin-store suite
 *  writes: the assertions below hold only if the organizer's configured price
 *  is what the script actually charges. */
const COST = 15;
const HINT_SETTINGS = ["hintsEnabled", "hintCost", "hintsMinSolves", "hintsUnlockAfterMin"];

describe.skipIf(!liveConfigured)("hint store against a live Redis (throwaway keys)", () => {
  let store: typeof import("@/lib/hint-store");
  let admin: typeof import("@/lib/admin-store");
  let pipeline: (typeof import("@/lib/upstash"))["upstashPipeline"];

  async function cleanup() {
    await pipeline([
      ["HDEL", HINT_HASH, HINT_ID],
      ["HDEL", SOLVES_HASH, SOLVE_FIELD],
      ["HDEL", "ctf:hints:spent", PLAYER],
      ["DEL", `ctf:user:${PLAYER}:hints`],
      ["DEL", `ctf:hints:at:${PLAYER}`],
    ]);
  }

  beforeAll(async () => {
    store = await import("@/lib/hint-store");
    admin = await import("@/lib/admin-store");
    ({ upstashPipeline: pipeline } = await import("@/lib/upstash"));
    await cleanup();
    await admin.updateAdminSettings(
      { hintsEnabled: true, hintCost: COST, hintsMinSolves: 1, hintsUnlockAfterMin: 0 },
      `vitest-${RUN}`,
    );
    await pipeline([["HSET", HINT_HASH, HINT_ID, HINT_TEXT]]);
  });

  afterAll(async () => {
    await cleanup();
    // Back to "no override" — the neutral state, not the values we chose.
    await pipeline([["HDEL", "ctf:admin:settings", ...HINT_SETTINGS]]);
  });

  it("resolves the seeded policy, not the baked defaults", async () => {
    const config = await store.resolveHintConfig();
    expect(config).toMatchObject({ enabled: true, cost: COST, minSolves: 1, unlockAfterMin: 0 });
  });

  it("refuses a player with no solves on the target and charges nothing", async () => {
    const result = await store.revealHint(PLAYER, TARGET, HINT_ID);
    expect(result).toEqual({
      ok: false,
      forbidden: true,
      error: "Solve 1 challenge on this target before buying its hints (you have 0)",
    });
    const [spent, owned] = await pipeline([
      ["HGET", "ctf:hints:spent", PLAYER],
      ["SCARD", `ctf:user:${PLAYER}:hints`],
    ]);
    expect(spent.result).toBeNull();
    expect(owned.result).toBe(0);
  });

  it("charges the first reveal once the gate is earned", async () => {
    await pipeline([["HSET", SOLVES_HASH, SOLVE_FIELD, new Date().toISOString()]]);
    const result = await store.revealHint(PLAYER, TARGET, HINT_ID);
    expect(result).toEqual({
      ok: true,
      hint: HINT_TEXT,
      alreadyOwned: false,
      spent: COST,
    });
  });

  it("returns the second reveal for free — spent is unchanged", async () => {
    const result = await store.revealHint(PLAYER, TARGET, HINT_ID);
    expect(result).toEqual({
      ok: true,
      hint: HINT_TEXT,
      alreadyOwned: true,
      spent: COST,
    });
    const [spent] = await pipeline([["HGET", "ctf:hints:spent", PLAYER]]);
    expect(Number(spent.result)).toBe(COST);
  });

  it("reports the purchase in the viewer state and penalty map", async () => {
    const viewer = await store.getViewerHints(PLAYER);
    expect(viewer.purchased[TARGET]?.[HINT_ID]).toBe(HINT_TEXT);
    expect(viewer.spent).toBe(COST);
    expect(viewer.count).toBe(1);

    const penalties = await store.getHintPenalties();
    expect(penalties.get(PLAYER)).toBe(COST);
  });

  it("refuses to charge for a hint that does not exist", async () => {
    const result = await store.revealHint(PLAYER, TARGET, `vt-${RUN}-no-such-hint`);
    expect(result).toEqual({ ok: false, missing: true, error: "No hint available for this challenge" });
    const [spent] = await pipeline([["HGET", "ctf:hints:spent", PLAYER]]);
    expect(Number(spent.result)).toBe(COST);
  });
});
