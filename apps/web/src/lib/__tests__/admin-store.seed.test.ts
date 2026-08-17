import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upstashEval: vi.fn(),
  upstashPipeline: vi.fn<(c: (string | number)[][]) => Promise<{ result?: unknown }[]>>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({ upstashEval: mocks.upstashEval, upstashPipeline: mocks.upstashPipeline }));

import { seedDemoData } from "@/lib/admin-store";
import { DEMO_CONTESTANTS, DEMO_TEAMS } from "@/lib/demo-fixture";

beforeEach(() => {
  mocks.upstashPipeline.mockReset();
  mocks.upstashPipeline.mockResolvedValue([]);
});

describe("seedDemoData", () => {
  it("writes solves, teams, membership + a seed audit line in one pipeline", async () => {
    const out = await seedDemoData("alice");

    const expectedSolves = DEMO_CONTESTANTS.reduce(
      (n, c) => n + Object.values(c.solves).reduce((m, ids) => m + ids.length, 0),
      0,
    );
    expect(out).toEqual({ contestants: DEMO_CONTESTANTS.length, teams: DEMO_TEAMS.length, solves: expectedSolves });

    expect(mocks.upstashPipeline).toHaveBeenCalledOnce();
    const cmds = mocks.upstashPipeline.mock.calls[0][0];

    // one HSET per solve, into ctf:solves:<target>
    const solveCmds = cmds.filter((c) => c[0] === "HSET" && String(c[1]).startsWith("ctf:solves:"));
    expect(solveCmds.length).toBe(expectedSolves);
    // real challenge-id fields shaped "<login>:<id>"
    expect(String(solveCmds[0][2])).toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/);

    // a team hash + a members SADD per team
    expect(cmds.filter((c) => c[0] === "HSET" && String(c[1]).startsWith("ctf:team:")).length).toBe(DEMO_TEAMS.length);
    expect(cmds.filter((c) => c[0] === "SADD").length).toBe(DEMO_TEAMS.length);

    // audit line records the seed
    const lpush = cmds.find((c) => c[0] === "LPUSH");
    expect(lpush).toBeTruthy();
    expect(JSON.parse(String(lpush![2]))).toMatchObject({ by: "alice", action: "seed" });
  });

  it("spreads EACH contestant's solves across the window so lines interleave", async () => {
    await seedDemoData("bob");
    const cmds = mocks.upstashPipeline.mock.calls[0][0];
    // pick the contestant with the most solves and check their own timestamps
    // span most of the ~6h window (not a narrow per-contestant block).
    const top = [...DEMO_CONTESTANTS].sort(
      (a, b) =>
        Object.values(b.solves).reduce((m, i) => m + i.length, 0) -
        Object.values(a.solves).reduce((m, i) => m + i.length, 0),
    )[0];
    const times = cmds
      .filter((c) => c[0] === "HSET" && String(c[1]).startsWith("ctf:solves:") && String(c[2]).startsWith(`${top.login}:`))
      .map((c) => Date.parse(String(c[3])))
      .sort((a, b) => a - b);
    const windowMs = 6 * 60 * 60 * 1000;
    expect(times[times.length - 1] - times[0]).toBeGreaterThan(windowMs * 0.5);
  });

  it("puts every demo contestant on a team (no soloists left off the team board)", () => {
    const teamed = new Set(DEMO_TEAMS.flatMap((t) => t.members));
    for (const c of DEMO_CONTESTANTS) expect(teamed.has(c.login)).toBe(true);
    // and every team's captain is one of its members
    for (const t of DEMO_TEAMS) expect(t.members).toContain(t.captain);
  });
});
