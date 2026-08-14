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

// The DynamoDB half is mocked as a module so these tests stay hermetic; its own
// behavior is covered by dynamo-team-store.test.ts. mirrorTeamOp still invokes
// the runner (like the real one) so dual-mode tests can assert what would run.
const dynamoMocks = vi.hoisted(() => ({
  dynamoCreateTeam: vi.fn<(...args: unknown[]) => Promise<string>>().mockResolvedValue("ok"),
  dynamoJoinTeam: vi.fn<(...args: unknown[]) => Promise<string>>().mockResolvedValue("ok"),
  dynamoLeaveTeam: vi.fn<(...args: unknown[]) => Promise<string>>().mockResolvedValue("ok"),
  dynamoGetUserTeamSlug: vi.fn<(login: string) => Promise<string | null>>().mockResolvedValue(null),
  dynamoGetViewerTeam: vi.fn<(login: string) => Promise<unknown>>().mockResolvedValue(null),
  dynamoListTeams: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  mirrorTeamOp: vi.fn(async (_op: string, run: () => Promise<unknown>) => {
    await run().catch(() => {});
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({
  upstashEval: mocks.upstashEval,
  upstashPipeline: mocks.upstashPipeline,
}));
vi.mock("@/lib/dynamo-team-store", () => dynamoMocks);
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookieJar.has(name) ? { name, value: mocks.cookieJar.get(name) } : undefined),
    set: (name: string, value: string) => void mocks.cookieJar.set(name, value),
    delete: (name: string) => void mocks.cookieJar.delete(name),
  }),
}));

type TeamStore = typeof import("@/lib/team-store");

/** TEAM_WRITES_ENABLED and CTF_DATA_BACKEND are read at module load, so each
 *  test re-imports the store with the env it needs. No backend = "dual". */
async function loadStore(writesEnabled: boolean, backend?: "dual" | "upstash" | "dynamo"): Promise<TeamStore> {
  vi.resetModules();
  vi.stubEnv("TEAM_WRITES_ENABLED", writesEnabled ? "true" : "");
  if (backend) vi.stubEnv("CTF_DATA_BACKEND", backend);
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

describe("data backend dispatch (CTF_DATA_BACKEND)", () => {
  it("dual (default) mirrors a successful create into DynamoDB", async () => {
    const store = await loadStore(true); // no backend env = dual
    mocks.upstashEval.mockResolvedValueOnce("ok");
    const result = await store.createTeam("octocat", "Red Team");
    expect(result).toEqual({ ok: true, team: "red-team" });
    expect(dynamoMocks.mirrorTeamOp).toHaveBeenCalledWith("team:create", expect.any(Function));
    expect(dynamoMocks.dynamoCreateTeam).toHaveBeenCalledWith("octocat", "red-team", "Red Team", expect.any(String));
  });

  it("dual mirrors join and leave with the same identity Upstash used", async () => {
    const store = await loadStore(true);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    await store.joinTeam("octocat", "red-team");
    expect(dynamoMocks.dynamoJoinTeam).toHaveBeenCalledWith("octocat", "red-team", 4);

    mocks.upstashPipeline.mockResolvedValueOnce([{ result: "red-team" }]);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    await store.leaveTeam("octocat");
    expect(dynamoMocks.dynamoLeaveTeam).toHaveBeenCalledWith("octocat", "red-team");
  });

  it("dual skips the mirror when Upstash rejects the write", async () => {
    const store = await loadStore(true);
    mocks.upstashEval.mockResolvedValueOnce("name-taken");
    await store.createTeam("octocat", "Red Team");
    expect(dynamoMocks.mirrorTeamOp).not.toHaveBeenCalled();
    expect(dynamoMocks.dynamoCreateTeam).not.toHaveBeenCalled();
  });

  it("upstash mode never touches DynamoDB", async () => {
    const store = await loadStore(true, "upstash");
    mocks.upstashEval.mockResolvedValueOnce("ok");
    const result = await store.joinTeam("octocat", "red-team");
    expect(result).toEqual({ ok: true, team: "red-team" });
    expect(dynamoMocks.mirrorTeamOp).not.toHaveBeenCalled();
    expect(dynamoMocks.dynamoJoinTeam).not.toHaveBeenCalled();
  });

  it("dynamo mode writes through DynamoDB and skips Upstash entirely", async () => {
    const store = await loadStore(true, "dynamo");
    dynamoMocks.dynamoJoinTeam.mockResolvedValueOnce("ok");
    const result = await store.joinTeam("octocat", "red-team");
    expect(result).toEqual({ ok: true, team: "red-team" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
    expect(dynamoMocks.mirrorTeamOp).not.toHaveBeenCalled(); // it IS the store, not a mirror
  });

  it("dynamo mode maps verdicts to the same user-facing messages", async () => {
    const store = await loadStore(true, "dynamo");
    dynamoMocks.dynamoJoinTeam.mockResolvedValueOnce("full");
    expect(await store.joinTeam("octocat", "red-team")).toEqual({
      ok: false,
      error: 'Team "red-team" is full (4 players max)',
    });
    dynamoMocks.dynamoJoinTeam.mockResolvedValueOnce("not-found");
    expect(await store.joinTeam("octocat", "ghost-team")).toEqual({
      ok: false,
      error: 'No team "ghost-team". Check the slug or create it',
    });
    dynamoMocks.dynamoCreateTeam.mockResolvedValueOnce("already-on-team");
    expect(await store.createTeam("octocat", "Blue Team")).toEqual({
      ok: false,
      error: "Leave your current team before creating one",
    });
    dynamoMocks.dynamoCreateTeam.mockResolvedValueOnce("error");
    expect(await store.createTeam("octocat", "Blue Team")).toEqual({
      ok: false,
      error: "Team update failed. Try again",
    });
  });

  it("dynamo mode leave treats a stale membership as already left", async () => {
    const store = await loadStore(true, "dynamo");
    dynamoMocks.dynamoGetUserTeamSlug.mockResolvedValueOnce("red-team");
    dynamoMocks.dynamoLeaveTeam.mockResolvedValueOnce("stale");
    expect(await store.leaveTeam("octocat")).toEqual({ ok: true, team: null });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("dynamo mode reads the viewer team and team list from DynamoDB", async () => {
    const store = await loadStore(true, "dynamo");
    const team = { slug: "red-team", name: "Red Team", members: ["octocat"] };
    dynamoMocks.dynamoGetViewerTeam.mockResolvedValueOnce(team);
    expect(await store.getViewerTeam("octocat")).toEqual(team);
    dynamoMocks.dynamoListTeams.mockResolvedValueOnce([team]);
    expect(await store.listTeams()).toEqual([team]);
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it("cookie mock ignores the backend flag when writes are disabled", async () => {
    const store = await loadStore(false, "dynamo");
    const result = await store.joinTeam("octocat", "Red Team");
    expect(result).toEqual({ ok: true, team: "red-team" });
    expect(mocks.cookieJar.get("ctf-mock-team")).toBe("red-team");
    expect(dynamoMocks.dynamoJoinTeam).not.toHaveBeenCalled();
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
