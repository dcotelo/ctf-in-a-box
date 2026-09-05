// Integration tests: exercises the REAL Lua scripts against a live Redis (srh
// in CI, Upstash or srh locally), because that's where the one-team-per-player,
// 4-player-cap and captain-must-transfer rules are actually enforced
// (atomically). Uses only run-unique throwaway keys and deletes them before
// and after. Gating comes from live-redis.ts: skipped without the env, a
// FAILURE when CTF_LUA_SUITES_REQUIRED is set.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RUN, liveConfigured } from "./live-redis";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => {
    throw new Error("the cookie fallback must not be used when TEAM_WRITES_ENABLED=true");
  },
}));

const NAME_A = `vt ${RUN} alpha`;
const SLUG_A = `vt-${RUN}-alpha`;
const NAME_B = `vt ${RUN} beta`;
const SLUG_B = `vt-${RUN}-beta`;
const PLAYERS = ["p1", "p2", "p3", "p4", "p5"].map((p) => `vt-${RUN}-${p}`);

const TEAM_KEYS = [
  `ctf:team:${SLUG_A}`,
  `ctf:team:${SLUG_A}:members`,
  `ctf:team:${SLUG_B}`,
  `ctf:team:${SLUG_B}:members`,
];
const USER_KEYS = PLAYERS.map((p) => `ctf:user:${p}`);
const KEYS = [...TEAM_KEYS, ...USER_KEYS];

describe.skipIf(!liveConfigured)("team store against a live Redis (throwaway keys)", () => {
  let store: typeof import("@/lib/team-store");
  let pipeline: (typeof import("@/lib/upstash"))["upstashPipeline"];
  // Join codes are generated at create time, so we can't know them up front —
  // collect them as we read them and clean them up alongside the fixed keys.
  const joinCodeKeys: string[] = [];

  /** Reads a team's captain-shared join code straight off its hash — the
   *  code-based join flow needs the real code, not the slug. */
  async function codeFor(slug: string): Promise<string> {
    const [res] = await pipeline([["HGET", `ctf:team:${slug}`, "joinCode"]]);
    const code = typeof res.result === "string" ? res.result : "";
    if (code) joinCodeKeys.push(`ctf:joincode:${code}`);
    return code;
  }

  beforeAll(async () => {
    vi.stubEnv("TEAM_WRITES_ENABLED", "true");
    store = await import("@/lib/team-store");
    ({ upstashPipeline: pipeline } = await import("@/lib/upstash"));
    await pipeline([["DEL", ...KEYS]]);
  });

  afterAll(async () => {
    await pipeline([["DEL", ...KEYS, ...joinCodeKeys]]);
    vi.unstubAllEnvs();
  });

  it("lets four players form a team and rejects the fifth as full", async () => {
    expect(await store.createTeam(PLAYERS[0], NAME_A)).toEqual({ ok: true, team: SLUG_A });
    const code = await codeFor(SLUG_A);
    for (const p of PLAYERS.slice(1, 4)) {
      expect(await store.joinTeam(p, code)).toEqual({ ok: true, team: SLUG_A });
    }
    expect(await store.joinTeam(PLAYERS[4], code)).toEqual({
      ok: false,
      error: "Team is full (4 players max)",
    });
  });

  it("does not allow a member of one team to join another", async () => {
    expect(await store.createTeam(PLAYERS[4], NAME_B)).toEqual({ ok: true, team: SLUG_B });
    const codeB = await codeFor(SLUG_B);
    expect(await store.joinTeam(PLAYERS[0], codeB)).toEqual({
      ok: false,
      error: "Leave your current team before joining another",
    });
    // Their membership is untouched by the rejected attempt.
    const team = await store.getViewerTeam(PLAYERS[0]);
    expect(team?.slug).toBe(SLUG_A);
  });

  it("does not allow a member to create another team", async () => {
    expect(await store.createTeam(PLAYERS[0], `vt ${RUN} gamma`)).toEqual({
      ok: false,
      error: "Leave your current team before creating one",
    });
  });

  it("keeps membership unique — re-joining your own team is rejected", async () => {
    const code = await codeFor(SLUG_A);
    expect(await store.joinTeam(PLAYERS[1], code)).toEqual({
      ok: false,
      error: "Leave your current team before joining another",
    });
    const [scard] = await pipeline([["SCARD", `ctf:team:${SLUG_A}:members`]]);
    expect(scard.result).toBe(4);
  });

  it("refuses to let the captain of a populated team leave — transfer or disband first", async () => {
    expect(await store.leaveTeam(PLAYERS[0])).toEqual({
      ok: false,
      error: "Transfer or disband before leaving",
    });
    // The refusal is a no-op: still four members, still captain, still on the team.
    const [scard, captain, team] = await pipeline([
      ["SCARD", `ctf:team:${SLUG_A}:members`],
      ["HGET", `ctf:team:${SLUG_A}`, "captain"],
      ["HGET", `ctf:user:${PLAYERS[0]}`, "team"],
    ]);
    expect(scard.result).toBe(4);
    expect(captain.result).toBe(PLAYERS[0]);
    expect(team.result).toBe(SLUG_A);
  });

  it("deletes team keys once the last member leaves", async () => {
    // Members leave freely; the captain hands over, then leaves; the new
    // captain, now alone, leaves last and the team goes with them. Team B's
    // captain is its only member, so the rule never applied there.
    for (const p of PLAYERS.slice(1, 3)) {
      expect(await store.leaveTeam(p)).toEqual({ ok: true, team: null });
    }
    expect(await store.transferCaptain(PLAYERS[0], SLUG_A, PLAYERS[3])).toEqual({ ok: true, team: SLUG_A });
    expect(await store.leaveTeam(PLAYERS[0])).toEqual({ ok: true, team: null });
    expect(await store.leaveTeam(PLAYERS[3])).toEqual({ ok: true, team: null });
    expect(await store.leaveTeam(PLAYERS[4])).toEqual({ ok: true, team: null });

    // Both teams' hashes, member sets and join-code reverse indexes are gone.
    // The join-code list is asserted non-empty first so the check cannot pass
    // by never having collected a code.
    expect(joinCodeKeys.length).toBeGreaterThan(0);
    const gone = [...TEAM_KEYS, ...joinCodeKeys];
    const results = await pipeline(gone.map((k) => ["EXISTS", k]));
    expect(results.map((r) => r.result)).toEqual(gone.map(() => 0));

    // Every player's membership is cleared, and every user hash SURVIVES —
    // `firstTeamAt` is a metric that outlives the team on purpose. Both halves
    // are asserted: a deleted hash also answers HEXISTS 0, so the membership
    // check alone would let a Lua regression that wipes profile data pass.
    const survivors = await pipeline(USER_KEYS.map((k) => ["EXISTS", k]));
    expect(survivors.map((r) => r.result)).toEqual(USER_KEYS.map(() => 1));
    const memberships = await pipeline(USER_KEYS.map((k) => ["HEXISTS", k, "team"]));
    expect(memberships.map((r) => r.result)).toEqual(USER_KEYS.map(() => 0));
  });
});
