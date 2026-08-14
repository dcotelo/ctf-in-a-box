// Unit tests for the team store's membership rules — most importantly that a
// GitHub user can only ever be on ONE team, and that a team caps at
// TEAM_MAX_MEMBERS players. Upstash and next/headers are mocked; the
// end-to-end Lua behavior is covered by team-store.upstash.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upstashEval: vi.fn<(script: string, keys: string[], args: (string | number)[]) => Promise<unknown>>(),
  upstashPipeline: vi.fn<(commands: (string | number)[][]) => Promise<{ result?: unknown; error?: string }[]>>(),
  cookieJar: new Map<string, string>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({
  upstashEval: mocks.upstashEval,
  upstashPipeline: mocks.upstashPipeline,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookieJar.has(name) ? { name, value: mocks.cookieJar.get(name) } : undefined),
    set: (name: string, value: string) => void mocks.cookieJar.set(name, value),
    delete: (name: string) => void mocks.cookieJar.delete(name),
  }),
}));

type TeamStore = typeof import("@/lib/team-store");

/** TEAM_WRITES_ENABLED is read at module load, so each test re-imports the
 *  store with the env it needs. */
async function loadStore(writesEnabled: boolean): Promise<TeamStore> {
  vi.resetModules();
  vi.stubEnv("TEAM_WRITES_ENABLED", writesEnabled ? "true" : "");
  return import("@/lib/team-store");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.cookieJar.clear();
});

describe("one team per player", () => {
  it("rejects joining a second team and tells the user why", async () => {
    const store = await loadStore(true);
    mocks.upstashEval.mockResolvedValueOnce("already-on-team");
    const result = await store.joinTeam("octocat", "red-team");
    expect(result).toEqual({ ok: false, error: "Leave your current team before joining another" });
  });

  it("rejects creating a team while already on one", async () => {
    const store = await loadStore(true);
    mocks.upstashEval.mockResolvedValueOnce("already-on-team");
    const result = await store.createTeam("octocat", "Blue Team");
    expect(result).toEqual({ ok: false, error: "Leave your current team before creating one" });
  });

  it("guards membership BEFORE any write inside the join script (atomic)", async () => {
    const store = await loadStore(true);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    await store.joinTeam("octocat", "red-team");
    const [script] = mocks.upstashEval.mock.calls[0];
    const guard = script.indexOf("already-on-team");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(script.indexOf("SADD"));
    expect(guard).toBeLessThan(script.indexOf("HSET"));
  });

  it("guards membership BEFORE any write inside the create script (atomic)", async () => {
    const store = await loadStore(true);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    await store.createTeam("octocat", "Red Team");
    const [script] = mocks.upstashEval.mock.calls[0];
    const guard = script.indexOf("already-on-team");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(script.indexOf("SADD"));
    expect(guard).toBeLessThan(script.indexOf("HSET"));
  });

  it("keys membership by the server-derived login, not client input", async () => {
    const store = await loadStore(true);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    await store.joinTeam("octocat", "red-team");
    const [, keys, args] = mocks.upstashEval.mock.calls[0];
    expect(keys).toEqual(["ctf:user:octocat", "ctf:team:red-team", "ctf:team:red-team:members"]);
    expect(args[0]).toBe("octocat");
  });
});

describe("team size cap", () => {
  it("rejects the fifth player with a clear message", async () => {
    const store = await loadStore(true);
    mocks.upstashEval.mockResolvedValueOnce("full");
    const result = await store.joinTeam("octocat", "red-team");
    expect(result).toEqual({ ok: false, error: 'Team "red-team" is full (4 players max)' });
  });

  it("passes TEAM_MAX_MEMBERS (4) into the atomic script", async () => {
    const store = await loadStore(true);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    await store.joinTeam("octocat", "red-team");
    const [script, , args] = mocks.upstashEval.mock.calls[0];
    expect(store.TEAM_MAX_MEMBERS).toBe(4);
    expect(args).toContain(4);
    expect(script).toContain("SCARD");
  });
});

describe("join/create input handling", () => {
  it("rejects joining a team that does not exist", async () => {
    const store = await loadStore(true);
    mocks.upstashEval.mockResolvedValueOnce("not-found");
    const result = await store.joinTeam("octocat", "ghost-team");
    expect(result).toEqual({ ok: false, error: 'No team "ghost-team". Check the slug or create it' });
  });

  it("normalizes the slug before joining", async () => {
    const store = await loadStore(true);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    const result = await store.joinTeam("octocat", "  Red Team!  ");
    expect(result).toEqual({ ok: true, team: "red-team" });
  });

  it("requires a team name to create", async () => {
    const store = await loadStore(true);
    const result = await store.createTeam("octocat", "   ");
    expect(result).toEqual({ ok: false, error: "Team name is required" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("caps the team name length", async () => {
    const store = await loadStore(true);
    const result = await store.createTeam("octocat", "x".repeat(33));
    expect(result.ok).toBe(false);
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("stores the display name and a slugified id", async () => {
    const store = await loadStore(true);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    const result = await store.createTeam("octocat", "The A-Team!!!");
    expect(result).toEqual({ ok: true, team: "the-a-team" });
    const [, keys, args] = mocks.upstashEval.mock.calls[0];
    expect(keys[1]).toBe("ctf:team:the-a-team");
    expect(args).toContain("The A-Team!!!");
    expect(args).toContain("the-a-team");
  });
});

describe("leaveTeam", () => {
  it("leaves the current team", async () => {
    const store = await loadStore(true);
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: "red-team" }]);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    const result = await store.leaveTeam("octocat");
    expect(result).toEqual({ ok: true, team: null });
    expect(mocks.upstashEval.mock.calls[0][1]).toEqual([
      "ctf:user:octocat",
      "ctf:team:red-team",
      "ctf:team:red-team:members",
    ]);
  });

  it("is a no-op when the player has no team", async () => {
    const store = await loadStore(true);
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: null }]);
    const result = await store.leaveTeam("octocat");
    expect(result).toEqual({ ok: true, team: null });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });
});

describe("getViewerTeam", () => {
  it("returns slug, display name, and sorted members", async () => {
    const store = await loadStore(true);
    mocks.upstashPipeline
      .mockResolvedValueOnce([{ result: "red-team" }])
      .mockResolvedValueOnce([{ result: "Red Team" }, { result: ["zed", "abe"] }]);
    const team = await store.getViewerTeam("octocat");
    expect(team).toEqual({ slug: "red-team", name: "Red Team", members: ["abe", "zed"] });
  });

  it("returns null when the player has no team", async () => {
    const store = await loadStore(true);
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: null }]);
    expect(await store.getViewerTeam("octocat")).toBeNull();
  });
});

describe("listTeams", () => {
  it("walks the SCAN cursor and resolves each team's name and members", async () => {
    const store = await loadStore(true);
    mocks.upstashPipeline
      // Two SCAN pages, then one HGET+SMEMBERS pair per team.
      .mockResolvedValueOnce([{ result: ["7", ["ctf:team:red:members"]] }])
      .mockResolvedValueOnce([{ result: ["0", ["ctf:team:blue:members"]] }])
      .mockResolvedValueOnce([
        { result: "Red Team" },
        { result: ["zed", "abe"] },
        { result: null },
        { result: ["solo"] },
      ]);
    const teams = await store.listTeams();
    expect(teams).toEqual([
      { slug: "red", name: "Red Team", members: ["abe", "zed"] },
      { slug: "blue", name: "blue", members: ["solo"] }, // name falls back to slug
    ]);
    const scanCalls = mocks.upstashPipeline.mock.calls.slice(0, 2).map(([cmds]) => cmds[0]);
    expect(scanCalls[0]).toEqual(["SCAN", "0", "MATCH", "ctf:team:*:members", "COUNT", "1000"]);
    expect(scanCalls[1][1]).toBe("7");
  });

  it("returns [] without touching Upstash when writes are disabled", async () => {
    const store = await loadStore(false);
    expect(await store.listTeams()).toEqual([]);
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it("returns [] when no team keys exist", async () => {
    const store = await loadStore(true);
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: ["0", []] }]);
    expect(await store.listTeams()).toEqual([]);
    expect(mocks.upstashPipeline).toHaveBeenCalledTimes(1);
  });
});

describe("mock mode (TEAM_WRITES_ENABLED unset)", () => {
  it("persists to the per-browser cookie and never touches Upstash", async () => {
    const store = await loadStore(false);
    const result = await store.joinTeam("octocat", "Red Team");
    expect(result).toEqual({ ok: true, team: "red-team" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
    expect(mocks.cookieJar.get("ctf-mock-team")).toBe("red-team");
  });

  it("reads the viewer's team back from the cookie", async () => {
    const store = await loadStore(false);
    mocks.cookieJar.set("ctf-mock-team", "red-team");
    expect(await store.getViewerTeam("octocat")).toEqual({
      slug: "red-team",
      name: "red-team",
      members: ["octocat"],
    });
  });

  it("leave clears the cookie", async () => {
    const store = await loadStore(false);
    mocks.cookieJar.set("ctf-mock-team", "red-team");
    expect(await store.leaveTeam("octocat")).toEqual({ ok: true, team: null });
    expect(mocks.cookieJar.has("ctf-mock-team")).toBe(false);
  });
});
