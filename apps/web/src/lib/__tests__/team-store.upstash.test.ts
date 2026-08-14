// Integration tests: exercises the REAL Lua scripts against the live Upstash
// DB, because that's where the one-team-per-player and 4-player-cap rules are
// actually enforced (atomically). Uses only run-unique throwaway keys and
// deletes them before and after. Skips entirely when Upstash credentials are
// not available (e.g. CI without secrets).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => {
    throw new Error("the cookie fallback must not be used when TEAM_WRITES_ENABLED=true");
  },
}));

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

const RUN = Date.now().toString(36);
const NAME_A = `vt ${RUN} alpha`;
const SLUG_A = `vt-${RUN}-alpha`;
const NAME_B = `vt ${RUN} beta`;
const SLUG_B = `vt-${RUN}-beta`;
const PLAYERS = ["p1", "p2", "p3", "p4", "p5"].map((p) => `vt-${RUN}-${p}`);

const KEYS = [
  `ctf:team:${SLUG_A}`,
  `ctf:team:${SLUG_A}:members`,
  `ctf:team:${SLUG_B}`,
  `ctf:team:${SLUG_B}:members`,
  ...PLAYERS.map((p) => `ctf:user:${p}`),
];

describe.skipIf(!configured)("team store against live Upstash (throwaway keys)", () => {
  let store: typeof import("@/lib/team-store");
  let pipeline: (typeof import("@/lib/upstash"))["upstashPipeline"];

  beforeAll(async () => {
    vi.stubEnv("TEAM_WRITES_ENABLED", "true");
    store = await import("@/lib/team-store");
    ({ upstashPipeline: pipeline } = await import("@/lib/upstash"));
    await pipeline([["DEL", ...KEYS]]);
  });

  afterAll(async () => {
    await pipeline([["DEL", ...KEYS]]);
    vi.unstubAllEnvs();
  });

  it("lets four players form a team and rejects the fifth as full", async () => {
    expect(await store.createTeam(PLAYERS[0], NAME_A)).toEqual({ ok: true, team: SLUG_A });
    for (const p of PLAYERS.slice(1, 4)) {
      expect(await store.joinTeam(p, SLUG_A)).toEqual({ ok: true, team: SLUG_A });
    }
    expect(await store.joinTeam(PLAYERS[4], SLUG_A)).toEqual({
      ok: false,
      error: `Team "${SLUG_A}" is full (4 players max)`,
    });
  });

  it("does not allow a member of one team to join another", async () => {
    expect(await store.createTeam(PLAYERS[4], NAME_B)).toEqual({ ok: true, team: SLUG_B });
    expect(await store.joinTeam(PLAYERS[0], SLUG_B)).toEqual({
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
    expect(await store.joinTeam(PLAYERS[1], SLUG_A)).toEqual({
      ok: false,
      error: "Leave your current team before joining another",
    });
    const [scard] = await pipeline([["SCARD", `ctf:team:${SLUG_A}:members`]]);
    expect(scard.result).toBe(4);
  });

  it("deletes team keys once the last member leaves", async () => {
    for (const p of PLAYERS) {
      expect(await store.leaveTeam(p)).toEqual({ ok: true, team: null });
    }
    const results = await pipeline(KEYS.map((k) => ["EXISTS", k]));
    expect(results.map((r) => r.result)).toEqual(KEYS.map(() => 0));
  });
});
