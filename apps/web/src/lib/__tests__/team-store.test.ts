// Unit tests for the team store's membership rules — most importantly that a
// GitHub user can only ever be on ONE team, a team caps at TEAM_MAX_MEMBERS
// players, joining resolves a captain-shared join code to a team, and every
// captain-only roster action is guarded atomically inside its Lua script.
// Upstash and next/headers are mocked; the end-to-end Lua behavior is
// covered by team-store.upstash.test.ts.

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

/** Every live write path (create/join + captain roster actions, but NOT
 *  leave) reads the registration window first via HMGET
 *  [teamRegistrationOpen, registrationStartsAt, registrationEndsAt]. These
 *  queue that reply: [null,null,null] means open (defaults); a "0" toggle or
 *  an out-of-window date means closed. */
function mockRegistrationOpen() {
  mocks.upstashPipeline.mockResolvedValueOnce([{ result: [null, null, null] }]);
}
function mockRegistrationClosed() {
  mocks.upstashPipeline.mockResolvedValueOnce([{ result: ["0", null, null] }]);
}

/** Queues the pipeline response for joinTeam's join-code -> slug lookup. */
function mockCodeLookup(slug: string | null) {
  mocks.upstashPipeline.mockResolvedValueOnce([{ result: slug }]);
}

/** Queues the pipeline response for createTeam/regenerateCode's join-code
 *  collision check (generateUniqueJoinCode's EXISTS probe). */
function mockCodeCollisionCheck(exists: boolean) {
  mocks.upstashPipeline.mockResolvedValueOnce([{ result: exists ? 1 : 0 }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.cookieJar.clear();
});

describe("one team per player", () => {
  it("rejects joining a second team and tells the user why", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeLookup("red-team");
    mocks.upstashEval.mockResolvedValueOnce("already-on-team");
    const result = await store.joinTeam("octocat", "somecode");
    expect(result).toEqual({ ok: false, error: "Leave your current team before joining another" });
  });

  it("rejects creating a team while already on one", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeCollisionCheck(false);
    mocks.upstashEval.mockResolvedValueOnce("already-on-team");
    const result = await store.createTeam("octocat", "Blue Team");
    expect(result).toEqual({ ok: false, error: "Leave your current team before creating one" });
  });

  it("guards membership BEFORE any write inside the join script (atomic)", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeLookup("red-team");
    mocks.upstashEval.mockResolvedValueOnce("ok");
    await store.joinTeam("octocat", "somecode");
    const [script] = mocks.upstashEval.mock.calls[0];
    const guard = script.indexOf("already-on-team");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(script.indexOf("SADD"));
    expect(guard).toBeLessThan(script.indexOf("HSET"));
  });

  it("guards membership BEFORE any write inside the create script (atomic)", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeCollisionCheck(false);
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
    mockRegistrationOpen();
    mockCodeLookup("red-team");
    mocks.upstashEval.mockResolvedValueOnce("ok");
    await store.joinTeam("octocat", "somecode");
    const [, keys, args] = mocks.upstashEval.mock.calls[0];
    expect(keys).toEqual(["ctf:user:octocat", "ctf:team:red-team", "ctf:team:red-team:members"]);
    expect(args[0]).toBe("octocat");
  });
});

describe("team size cap", () => {
  it("rejects the fifth player with a clear message", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeLookup("red-team");
    mocks.upstashEval.mockResolvedValueOnce("full");
    const result = await store.joinTeam("octocat", "somecode");
    expect(result).toEqual({ ok: false, error: "Team is full (4 players max)" });
  });

  it("passes TEAM_MAX_MEMBERS (4) into the atomic script", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeLookup("red-team");
    mocks.upstashEval.mockResolvedValueOnce("ok");
    await store.joinTeam("octocat", "somecode");
    const [script, , args] = mocks.upstashEval.mock.calls[0];
    expect(store.TEAM_MAX_MEMBERS).toBe(4);
    expect(args).toContain(4);
    expect(script).toContain("SCARD");
  });
});

describe("join by code", () => {
  it("resolves the code to a team and joins it", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeLookup("red-team");
    mocks.upstashEval.mockResolvedValueOnce("ok");
    const result = await store.joinTeam("octocat", "somecode");
    expect(result).toEqual({ ok: true, team: "red-team" });
  });

  it("normalizes the code's case before resolving it", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeLookup("red-team");
    mocks.upstashEval.mockResolvedValueOnce("ok");
    const result = await store.joinTeam("octocat", "  ABC123  ");
    expect(result).toEqual({ ok: true, team: "red-team" });
    // calls[0] is the registration HGET; the code lookup is the next call.
    expect(mocks.upstashPipeline.mock.calls[1][0]).toEqual([["GET", "ctf:joincode:abc123"]]);
  });

  it("rejects an unknown join code without touching the join script", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeLookup(null);
    const result = await store.joinTeam("octocat", "ghostcode");
    expect(result).toEqual({ ok: false, error: "Invalid or expired join code" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("requires a non-empty code", async () => {
    const store = await loadStore(true);
    const result = await store.joinTeam("octocat", "   ");
    expect(result).toEqual({ ok: false, error: "Join code is required" });
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("maps a stale team (resolved but since removed) to a friendly error", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeLookup("ghost-team");
    mocks.upstashEval.mockResolvedValueOnce("not-found");
    const result = await store.joinTeam("octocat", "somecode");
    expect(result).toEqual({ ok: false, error: "That team no longer exists" });
  });
});

describe("create input handling", () => {
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

  it("stores the display name, a slugified id, and a generated join code", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeCollisionCheck(false);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    const result = await store.createTeam("octocat", "The A-Team!!!");
    expect(result).toEqual({ ok: true, team: "the-a-team" });
    const [, keys, args] = mocks.upstashEval.mock.calls[0];
    expect(keys[1]).toBe("ctf:team:the-a-team");
    expect(keys[3]).toMatch(/^ctf:joincode:[a-z0-9]{6}$/);
    expect(args).toContain("The A-Team!!!");
    expect(args).toContain("the-a-team");
    expect(args[4]).toMatch(/^[a-z0-9]{6}$/);
  });

  it("retries join code generation on a collision", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeCollisionCheck(true); // first candidate collides
    mockCodeCollisionCheck(false); // second candidate is free
    mocks.upstashEval.mockResolvedValueOnce("ok");
    await store.createTeam("octocat", "Red Team");
    // registration read + two collision probes.
    expect(mocks.upstashPipeline).toHaveBeenCalledTimes(3);
  });
});

describe("registration window", () => {
  it("rejects createTeam when registration is closed, without mutating", async () => {
    const store = await loadStore(true);
    mockRegistrationClosed();
    const result = await store.createTeam("octocat", "Red Team");
    expect(result).toEqual({ ok: false, error: "Team registration is closed" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("rejects joinTeam when registration is closed, without mutating", async () => {
    const store = await loadStore(true);
    mockRegistrationClosed();
    const result = await store.joinTeam("octocat", "somecode");
    expect(result).toEqual({ ok: false, error: "Team registration is closed" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("rejects createTeam when the scheduled window has ended (toggle open, date past)", async () => {
    const store = await loadStore(true);
    // teamRegistrationOpen absent (=open), but registrationEndsAt is in the past.
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: [null, null, "2000-01-01T00:00:00.000Z"] }]);
    const result = await store.createTeam("octocat", "Red Team");
    expect(result).toEqual({ ok: false, error: "Team registration is closed" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("rejects roster-growth captain actions when registration is closed", async () => {
    const store = await loadStore(true);
    const closed = { ok: false, error: "Team registration is closed" };
    for (const call of [
      () => store.removeMember("captain", "red-team", "member2"),
      () => store.renameTeam("captain", "red-team", "New Name"),
      () => store.regenerateCode("captain", "red-team"),
    ]) {
      mockRegistrationClosed();
      expect(await call()).toEqual(closed);
    }
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("still allows transfer and disband when registration is closed (a captain must never be trapped)", async () => {
    const store = await loadStore(true);
    // Neither reads the registration window, so no mockRegistration* is queued.
    mocks.upstashEval.mockResolvedValueOnce("ok"); // transfer
    expect(await store.transferCaptain("captain", "red-team", "member2")).toEqual({ ok: true, team: "red-team" });
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: "abc123" }]); // disband's joinCode HGET
    mocks.upstashEval.mockResolvedValueOnce("ok"); // disband
    expect(await store.disbandTeam("captain", "red-team")).toEqual({ ok: true, team: null });
  });

  it("allows createTeam when registration is open (field absent)", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeCollisionCheck(false);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    expect(await store.createTeam("octocat", "Red Team")).toEqual({ ok: true, team: "red-team" });
  });

  it("never blocks leaveTeam — players can always leave", async () => {
    const store = await loadStore(true);
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: "red-team" }]); // getUserTeamSlug
    mocks.upstashEval.mockResolvedValueOnce("ok");
    const result = await store.leaveTeam("captain");
    expect(result).toEqual({ ok: true, team: null });
    // Only the membership lookup ran — no registration HGET was issued.
    expect(mocks.upstashPipeline).toHaveBeenCalledOnce();
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

  it("deletes the orphan join code when the last member leaves", async () => {
    const store = await loadStore(true);
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: "red-team" }]);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    await store.leaveTeam("captain");
    const [script] = mocks.upstashEval.mock.calls[0];
    // When the roster empties, the team hash's joinCode is read and its
    // reverse index deleted so no code is left pointing at a dead team.
    expect(script).toContain("joinCode");
    expect(script).toContain("ctf:joincode:");
    const emptied = script.indexOf("SCARD");
    const readCode = script.indexOf("'joinCode'");
    const delCode = script.indexOf("'ctf:joincode:'");
    expect(readCode).toBeGreaterThan(emptied);
    expect(delCode).toBeGreaterThan(readCode);
  });

  it("is a no-op when the player has no team", async () => {
    const store = await loadStore(true);
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: null }]);
    const result = await store.leaveTeam("octocat");
    expect(result).toEqual({ ok: true, team: null });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("blocks the captain from leaving a populated team", async () => {
    const store = await loadStore(true);
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: "red-team" }]);
    mocks.upstashEval.mockResolvedValueOnce("captain-must-transfer");
    const result = await store.leaveTeam("captain");
    expect(result).toEqual({ ok: false, error: "Transfer or disband before leaving" });
  });

  it("lets the old captain leave after transferring captaincy", async () => {
    const store = await loadStore(true);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    const transferResult = await store.transferCaptain("captain", "red-team", "member2");
    expect(transferResult).toEqual({ ok: true, team: "red-team" });

    mocks.upstashPipeline.mockResolvedValueOnce([{ result: "red-team" }]);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    const leaveResult = await store.leaveTeam("captain");
    expect(leaveResult).toEqual({ ok: true, team: null });
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

describe("captain guard", () => {
  it("rejects removeMember from a non-captain", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mocks.upstashEval.mockResolvedValueOnce("not-captain");
    const result = await store.removeMember("intruder", "red-team", "victim");
    expect(result).toEqual({ ok: false, error: "Only the team captain can do that" });
  });

  it("rejects renameTeam from a non-captain", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mocks.upstashEval.mockResolvedValueOnce("not-captain");
    const result = await store.renameTeam("intruder", "red-team", "New Name");
    expect(result).toEqual({ ok: false, error: "Only the team captain can do that" });
  });

  it("rejects transferCaptain from a non-captain", async () => {
    const store = await loadStore(true);
    mocks.upstashEval.mockResolvedValueOnce("not-captain");
    const result = await store.transferCaptain("intruder", "red-team", "member2");
    expect(result).toEqual({ ok: false, error: "Only the team captain can do that" });
  });

  it("rejects disbandTeam from a non-captain", async () => {
    const store = await loadStore(true);
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: "abc123" }]);
    mocks.upstashEval.mockResolvedValueOnce("not-captain");
    const result = await store.disbandTeam("intruder", "red-team");
    expect(result).toEqual({ ok: false, error: "Only the team captain can do that" });
  });

  it("rejects regenerateCode from a non-captain", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: "old123" }]);
    mockCodeCollisionCheck(false);
    mocks.upstashEval.mockResolvedValueOnce("not-captain");
    const result = await store.regenerateCode("intruder", "red-team");
    expect(result).toEqual({ ok: false, error: "Only the team captain can do that" });
  });
});

describe("captain roster actions", () => {
  it("removes a member from the roster", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mocks.upstashEval.mockResolvedValueOnce("ok");
    const result = await store.removeMember("captain", "red-team", "member2");
    expect(result).toEqual({ ok: true, team: "red-team" });
    const [script, keys, args] = mocks.upstashEval.mock.calls[0];
    expect(keys).toEqual(["ctf:team:red-team", "ctf:team:red-team:members", "ctf:user:member2"]);
    expect(args).toEqual(["captain", "member2"]);
    expect(script).toContain("SREM");
  });

  it("rejects removing the captain", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mocks.upstashEval.mockResolvedValueOnce("cannot-remove-captain");
    const result = await store.removeMember("captain", "red-team", "captain");
    expect(result).toEqual({
      ok: false,
      error: "The captain can't remove themselves — transfer captaincy or disband instead",
    });
  });

  it("rejects removing someone not on the team", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mocks.upstashEval.mockResolvedValueOnce("not-member");
    const result = await store.removeMember("captain", "red-team", "ghost");
    expect(result).toEqual({ ok: false, error: '"ghost" is not on this team' });
  });

  it("renames the team", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mocks.upstashEval.mockResolvedValueOnce("ok");
    const result = await store.renameTeam("captain", "red-team", "Crimson Squad");
    expect(result).toEqual({ ok: true, team: "red-team" });
    const [, keys, args] = mocks.upstashEval.mock.calls[0];
    expect(keys).toEqual(["ctf:team:red-team", "ctf:team:crimson-squad"]);
    expect(args).toEqual(["captain", "Crimson Squad"]);
  });

  it("rejects a name collision with another team", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mocks.upstashEval.mockResolvedValueOnce("name-taken");
    const result = await store.renameTeam("captain", "red-team", "Blue Team");
    expect(result).toEqual({ ok: false, error: 'Team "blue-team" already exists. Choose another name' });
  });

  it("caps the new name length without calling Upstash", async () => {
    const store = await loadStore(true);
    const result = await store.renameTeam("captain", "red-team", "x".repeat(33));
    expect(result.ok).toBe(false);
    expect(mocks.upstashEval).not.toHaveBeenCalled();
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it("transfers captaincy to a current member", async () => {
    const store = await loadStore(true);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    const result = await store.transferCaptain("captain", "red-team", "member2");
    expect(result).toEqual({ ok: true, team: "red-team" });
    const [, keys, args] = mocks.upstashEval.mock.calls[0];
    expect(keys).toEqual(["ctf:team:red-team", "ctf:team:red-team:members"]);
    expect(args).toEqual(["captain", "member2"]);
  });

  it("rejects transferring to someone not on the team", async () => {
    const store = await loadStore(true);
    mocks.upstashEval.mockResolvedValueOnce("not-member");
    const result = await store.transferCaptain("captain", "red-team", "ghost");
    expect(result).toEqual({ ok: false, error: '"ghost" is not on this team' });
  });

  it("disbands the team and clears its join code", async () => {
    const store = await loadStore(true);
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: "abc123" }]);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    const result = await store.disbandTeam("captain", "red-team");
    expect(result).toEqual({ ok: true, team: null });
    const [script, keys] = mocks.upstashEval.mock.calls[0];
    expect(keys).toEqual(["ctf:team:red-team", "ctf:team:red-team:members", "ctf:joincode:abc123"]);
    expect(script).toContain("SMEMBERS");
  });

  it("issues a new join code and clears the old one", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: "old123" }]);
    mockCodeCollisionCheck(false);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    const result = await store.regenerateCode("captain", "red-team");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.team).toBe("red-team");
      expect(result.code).toMatch(/^[a-z0-9]{6}$/);
    }
    const [, keys, args] = mocks.upstashEval.mock.calls[0];
    expect(keys[0]).toBe("ctf:team:red-team");
    expect(keys[2]).toBe("ctf:joincode:old123");
    expect(args[0]).toBe("captain");
  });

  it("rejects every captain action when writes are disabled", async () => {
    const store = await loadStore(false);
    const denied = { ok: false, error: "Not available in demo mode" };
    expect(await store.removeMember("captain", "red-team", "member2")).toEqual(denied);
    expect(await store.renameTeam("captain", "red-team", "New Name")).toEqual(denied);
    expect(await store.transferCaptain("captain", "red-team", "member2")).toEqual(denied);
    expect(await store.disbandTeam("captain", "red-team")).toEqual(denied);
    expect(await store.regenerateCode("captain", "red-team")).toEqual(denied);
    expect(mocks.upstashEval).not.toHaveBeenCalled();
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
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

// --- the configurable member cap (issue #99) --------------------------------
//
// ADR 31's lesson from the hint toggle is that a split-brain comes from
// surfaces reading a constant while the override lives elsewhere. The cap is
// enforced INSIDE the Lua join transaction, so what matters is the value that
// reaches the script — not what any UI says.

/** Queues the resolver's HGET of `teamMaxMembers`. */
function mockTeamCap(value: string | null) {
  mocks.upstashPipeline.mockResolvedValueOnce([{ result: value }]);
}

describe("team member cap", () => {
  it("hands the ORGANIZER'S override to the join script, not the default", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeLookup("red-team");
    mockTeamCap("6");
    mocks.upstashEval.mockResolvedValueOnce("ok");
    await store.joinTeam("octocat", "somecode");
    const [, , argv] = mocks.upstashEval.mock.calls[0];
    expect(argv[1]).toBe(6);
  });

  it("falls back to the default when no override is stored", async () => {
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeLookup("red-team");
    mockTeamCap(null);
    mocks.upstashEval.mockResolvedValueOnce("ok");
    await store.joinTeam("octocat", "somecode");
    const [, , argv] = mocks.upstashEval.mock.calls[0];
    expect(argv[1]).toBe(store.TEAM_MAX_MEMBERS);
  });

  it("quotes the RESOLVED cap when the team is full", async () => {
    // The message a contestant reads has to match the number that refused
    // them, or the support question writes itself.
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeLookup("red-team");
    mockTeamCap("2");
    mocks.upstashEval.mockResolvedValueOnce("full");
    const result = await store.joinTeam("octocat", "somecode");
    expect(result).toEqual({ ok: false, error: "Team is full (2 players max)" });
  });

  it("fails OPEN to the default when the store read throws", async () => {
    // Deliberately the opposite of the admin access check: a Redis blip must
    // not make every team look full and wedge registration. The Lua script
    // still enforces whatever value it is handed, atomically.
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeLookup("red-team");
    mocks.upstashPipeline.mockRejectedValueOnce(new Error("redis down"));
    mocks.upstashEval.mockResolvedValueOnce("ok");
    await store.joinTeam("octocat", "somecode");
    const [, , argv] = mocks.upstashEval.mock.calls[0];
    expect(argv[1]).toBe(store.TEAM_MAX_MEMBERS);
  });

  it("ignores a junk or out-of-range stored value", async () => {
    const store = await loadStore(true);
    for (const junk of ["0", "-3", "abc", ""]) {
      vi.clearAllMocks();
      mockRegistrationOpen();
      mockCodeLookup("red-team");
      mockTeamCap(junk);
      mocks.upstashEval.mockResolvedValueOnce("ok");
      await store.joinTeam("octocat", "somecode");
      const [, , argv] = mocks.upstashEval.mock.calls[0];
      expect(argv[1]).toBe(store.TEAM_MAX_MEMBERS);
    }
  });

  it("never evicts: lowering the cap leaves an over-sized team intact", async () => {
    // The cap is a JOIN guard. The script only ever SADDs after an SCARD
    // check, so there is no path here that removes a member — this pins that
    // the join flow does not grow one.
    const store = await loadStore(true);
    mockRegistrationOpen();
    mockCodeLookup("red-team");
    mockTeamCap("2");
    mocks.upstashEval.mockResolvedValueOnce("full");
    await store.joinTeam("octocat", "somecode");
    const [script] = mocks.upstashEval.mock.calls[0];
    expect(script).not.toContain("SREM");
    expect(script).toContain("SCARD");
  });
});
