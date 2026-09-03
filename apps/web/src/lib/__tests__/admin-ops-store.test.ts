// Per-contestant and per-team support operations (issue #168).
//
// These are the only destructive controls in the kit that act on ONE person,
// so the things worth pinning are the blast radius (does it touch anybody
// else?), the aggregate bookkeeping (the counters are NOT all keyed the same
// way), and the refusals that keep a team administrable.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upstashEval: vi.fn<(script: string, keys: string[], args: (string | number)[]) => Promise<unknown>>(),
  upstashPipeline: vi.fn<(commands: (string | number)[][]) => Promise<{ result?: unknown }[]>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({
  upstashEval: mocks.upstashEval,
  upstashPipeline: mocks.upstashPipeline,
}));
vi.mock("@/lib/admin-store", () => ({ ADMIN_AUDIT_KEY: "ctf:admin:audit", AUDIT_CAP: 500 }));

import {
  OpsValidationError,
  deleteUser,
  forceDisbandTeam,
  forceRemoveFromTeam,
  forceTransferCaptain,
  lookupUser,
  resetUserProgress,
} from "@/lib/admin-ops-store";

/** Reply for a pipeline of N commands, all zero/empty unless overridden. */
const replies = (...results: unknown[]) => results.map((result) => ({ result }));

/** lookupUser's first command is one HMGET of [team, joinedAt, firstTeamAt],
 *  so its reply is an ARRAY, not a scalar. Building it here keeps every
 *  fixture honest about that — an accidental scalar makes the store read no
 *  team at all and silently skips the follow-up pipeline, which then eats the
 *  NEXT test's queued reply. */
const userHmget = (
  slug: string | null,
  joinedAt: string | null = null,
  firstTeamAt: string | null = null,
) => [slug, joinedAt, firstTeamAt];

/** The SCAN over `ctf:solves:*` that the secure-dev walk does first. Queues an
 *  empty sweep: cursor "0", no keys. */
function mockNoSecureDevKeys() {
  mocks.upstashPipeline.mockResolvedValueOnce(replies(["0", []]));
}

/** A single-page SCAN returning one solves hash whose fields are `fields`. */
function mockSecureDevKeys(key: string, fields: string[]) {
  mocks.upstashPipeline.mockResolvedValueOnce(replies(["0", [key]]));
  mocks.upstashPipeline.mockResolvedValueOnce(replies(fields));
}

/** Every command issued across every pipeline call, flattened. */
function allCommands(): (string | number)[][] {
  return mocks.upstashPipeline.mock.calls.flatMap((c) => c[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("input validation", () => {
  it("refuses a login that is not a GitHub login", async () => {
    await expect(lookupUser("not a login!")).rejects.toBeInstanceOf(OpsValidationError);
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it("refuses a slug carrying a glob, before it can reach a key", async () => {
    // These keys are built by interpolation. An unvalidated slug is how a `*`
    // reaches a pattern or a `:` invents a key namespace.
    await expect(forceDisbandTeam("*", "admin")).rejects.toBeInstanceOf(OpsValidationError);
    await expect(forceDisbandTeam("a:b", "admin")).rejects.toBeInstanceOf(OpsValidationError);
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });
});

describe("lookupUser", () => {
  it("reports a contestant with no team and no data as unknown", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce(
      replies(userHmget(null), [], [], null, null, [], [], null, null, 0, null),
    );
    mockNoSecureDevKeys();
    const detail = await lookupUser("octocat");
    expect(detail.known).toBe(false);
    expect(detail.team).toBeNull();
  });

  it("counts only the target's fields in a shared secure-dev solves hash", async () => {
    // `ctf:solves:<target>` holds EVERY contestant's solves for that target,
    // keyed `<login>:<challengeId>`. Counting the whole hash would report
    // another team's work as this contestant's.
    mocks.upstashPipeline.mockResolvedValueOnce(
      replies(userHmget(null), [], [], null, null, [], [], null, null, 0, null),
    );
    mockSecureDevKeys("ctf:solves:dvwa", ["octocat:c1", "octocat:c2", "mallory:c1"]);
    const detail = await lookupUser("octocat");
    expect(detail.secureDev.solves).toBe(2);
    expect(detail.known).toBe(true);
  });

  it("does not mistake a login PREFIX for the login", async () => {
    // "octo" must not match "octocat:c1". The `:` separator is what makes the
    // prefix exact, and LOGIN_RE guarantees a login cannot contain one.
    mocks.upstashPipeline.mockResolvedValueOnce(
      replies(userHmget(null), [], [], null, null, [], [], null, null, 0, null),
    );
    mockSecureDevKeys("ctf:solves:dvwa", ["octocat:c1", "octo:c9"]);
    expect((await lookupUser("octo")).secureDev.solves).toBe(1);
  });

  it("sums attempts out of the JSON rows, not by coercing them to numbers", async () => {
    // The attempts hash stores a JSON OBJECT per item, not a count. Summing it
    // with `Number(value)` yields NaN — which, coerced through `|| 0`, made the
    // support tab report "Attempts 0" for every contestant on every event, and
    // report it confidently. Nothing caught it: while the demo seed wrote no
    // attempt rows at all, zero WAS the right answer for seeded data, so the
    // bug and the fixture agreed with each other.
    //
    // Upstash returns HGETALL as a flat [field, value, field, value] array.
    const quizAttempts = [
      "xss-basics",
      JSON.stringify({ attempts: 2, firstAt: "2026-08-22T10:00:00Z", lastAt: "2026-08-22T10:06:00Z" }),
      "csrf-defense",
      JSON.stringify({ attempts: 3, firstAt: "2026-08-22T11:00:00Z", lastAt: "2026-08-22T11:09:00Z" }),
    ];
    const classicAttempts = [
      "web-robots-only",
      JSON.stringify({ attempts: 4, firstAt: "2026-08-22T12:00:00Z", lastAt: "2026-08-22T12:20:00Z" }),
    ];
    mocks.upstashPipeline.mockResolvedValueOnce(
      replies(userHmget(null), [], quizAttempts, null, null, [], classicAttempts, null, null, 0, null),
    );
    mockNoSecureDevKeys();
    const detail = await lookupUser("octocat");
    expect(detail.quiz.attempts).toBe(5);
    expect(detail.classic.attempts).toBe(4);
  });

  it("treats an unreadable attempt row as no attempts rather than throwing", async () => {
    // A support lookup runs mid-event, on live data, when something has
    // already gone wrong. One corrupt row must not take the whole lookup down.
    const rows = ["good", JSON.stringify({ attempts: 2 }), "corrupt", "{not json", "empty", ""];
    mocks.upstashPipeline.mockResolvedValueOnce(
      replies(userHmget(null), [], rows, null, null, [], [], null, null, 0, null),
    );
    mockNoSecureDevKeys();
    expect((await lookupUser("octocat")).quiz.attempts).toBe(2);
  });

  it("marks the captain of their team", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce(
      replies(userHmget("red-team", "2026-08-22T10:00:00Z", "2026-08-20T09:00:00Z"), [], [], "10", "1", [], [], null, null, 0, null),
    );
    mocks.upstashPipeline.mockResolvedValueOnce(replies("Red Team", "Octocat"));
    mockNoSecureDevKeys();
    const detail = await lookupUser("octocat");
    // Captain comparison is case-insensitive: GitHub logins round-trip with
    // their original case, and the store lowercases.
    expect(detail.team).toEqual({
      slug: "red-team",
      name: "Red Team",
      captain: "Octocat",
      isCaptain: true,
      joinedAt: "2026-08-22T10:00:00Z",
    });
    // The funnel's conversion moment, and it is EARLIER than joinedAt here —
    // this contestant switched teams, and firstTeamAt is what must not move.
    expect(detail.firstTeamAt).toBe("2026-08-20T09:00:00Z");
  });
});

describe("resetUserProgress", () => {
  it("DECREMENTS the per-challenge solve counter instead of deleting by login", async () => {
    // ctf:classic:solvecount is HINCRBY'd by CHALLENGE ID, not by login —
    // unlike every other aggregate here. HDELing it by login would remove
    // nothing and leave each challenge still counting a contestant whose
    // solves are gone, so the per-challenge stats would drift up permanently,
    // once per reset.
    mockNoSecureDevKeys();
    mocks.upstashPipeline.mockResolvedValueOnce(replies(["sql-1", "xss-2"], []));
    mocks.upstashPipeline.mockResolvedValueOnce(
      replies(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0),
    );
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1)); // audit

    const result = await resetUserProgress("octocat", "admin");

    const cmds = allCommands();
    const decrements = cmds.filter((c) => c[0] === "HINCRBY" && c[1] === "ctf:classic:solvecount");
    expect(decrements).toEqual([
      ["HINCRBY", "ctf:classic:solvecount", "sql-1", -1],
      ["HINCRBY", "ctf:classic:solvecount", "xss-2", -1],
    ]);
    expect(cmds).not.toContainEqual(["HDEL", "ctf:classic:solvecount", "octocat"]);
    expect(result.cleared.classicSolveCountsDecremented).toBe(2);
  });

  it("DECREMENTS the ai per-challenge solve counter instead of deleting by login", async () => {
    // ctf:ai:solvecount has the exact same per-CHALLENGE shape as classic's
    // ctf:classic:solvecount above — HDELing it by login would leave every ai
    // challenge still counting a contestant whose solves are gone.
    mockNoSecureDevKeys();
    mocks.upstashPipeline.mockResolvedValueOnce(replies([], ["prompt-1", "jailbreak-2"]));
    mocks.upstashPipeline.mockResolvedValueOnce(
      replies(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0),
    );
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1)); // audit

    const result = await resetUserProgress("octocat", "admin");

    const cmds = allCommands();
    const decrements = cmds.filter((c) => c[0] === "HINCRBY" && c[1] === "ctf:ai:solvecount");
    expect(decrements).toEqual([
      ["HINCRBY", "ctf:ai:solvecount", "prompt-1", -1],
      ["HINCRBY", "ctf:ai:solvecount", "jailbreak-2", -1],
    ]);
    expect(cmds).not.toContainEqual(["HDEL", "ctf:ai:solvecount", "octocat"]);
    expect(result.cleared.aiSolveCountsDecremented).toBe(2);
  });

  it("clears every per-login key and nobody else's", async () => {
    mockNoSecureDevKeys();
    mocks.upstashPipeline.mockResolvedValueOnce(replies([], []));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1));

    await resetUserProgress("octocat", "admin");

    const touched = allCommands()
      .filter((c) => c[0] === "DEL" || c[0] === "HDEL")
      .map((c) => String(c[1]) + (c[0] === "HDEL" ? `#${c[2]}` : ""));
    expect(touched).toEqual([
      "ctf:quiz:answers:octocat",
      "ctf:quiz:attempts:octocat",
      "ctf:quiz:points#octocat",
      "ctf:quiz:answered#octocat",
      "ctf:classic:solves:octocat",
      "ctf:classic:attempts:octocat",
      "ctf:classic:points#octocat",
      "ctf:classic:solved#octocat",
      "ctf:user:octocat:hints",
      "ctf:hints:at:octocat",
      "ctf:hints:spent#octocat",
      "ctf:ai:solves:octocat",
      "ctf:ai:attempts:octocat",
      "ctf:ai:points#octocat",
      "ctf:ai:solved#octocat",
    ]);
  });

  it("clears the ai module's per-login progress — the gap this reset used to leave open", async () => {
    // Before this fix, resetUserProgress cleared quiz+classic+secure-dev+hints
    // but touched zero ctf:ai:* keys, so an ai solve silently survived the
    // "put them back to zero" lever. Assert the counts round-trip through
    // `cleared`, field-swapped from the classic assertions above.
    mockNoSecureDevKeys();
    mocks.upstashPipeline.mockResolvedValueOnce(replies([], ["prompt-1"]));
    mocks.upstashPipeline.mockResolvedValueOnce(
      replies(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 2, 40, 1, -1),
    );
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1));

    const result = await resetUserProgress("octocat", "admin");

    expect(result.cleared.aiSolves).toBe(3);
    expect(result.cleared.aiAttempts).toBe(2);
    expect(result.cleared.aiAggregates).toBe(41);
    expect(result.cleared.aiSolveCountsDecremented).toBe(1);

    const cmds = allCommands();
    expect(cmds).toContainEqual(["DEL", "ctf:ai:solves:octocat"]);
    expect(cmds).toContainEqual(["DEL", "ctf:ai:attempts:octocat"]);
    expect(cmds).toContainEqual(["HDEL", "ctf:ai:points", "octocat"]);
    expect(cmds).toContainEqual(["HDEL", "ctf:ai:solved", "octocat"]);
  });

  it("does not touch another login's ai progress", async () => {
    mockNoSecureDevKeys();
    mocks.upstashPipeline.mockResolvedValueOnce(replies([], []));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1));

    await resetUserProgress("octocat", "admin");

    const cmds = allCommands();
    expect(cmds).not.toContainEqual(["DEL", "ctf:ai:solves:mallory"]);
    expect(cmds).not.toContainEqual(["HDEL", "ctf:ai:points", "mallory"]);
  });

  it("never touches the module-wide launch keypair, nonces, or the ai catalogue", async () => {
    mockNoSecureDevKeys();
    mocks.upstashPipeline.mockResolvedValueOnce(replies([], ["prompt-1"]));
    mocks.upstashPipeline.mockResolvedValueOnce(
      replies(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0),
    );
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1));

    await resetUserProgress("octocat", "admin");

    const cmds = allCommands();
    expect(cmds.some((c) => String(c[1]).startsWith("ctf:ai:launchkey"))).toBe(false);
    expect(cmds.some((c) => String(c[1]).startsWith("ctf:ai:nonce:"))).toBe(false);
    expect(cmds.some((c) => String(c[1]) === "ctf:ai:challenges")).toBe(false);
  });

  it("leaves the account and team membership alone", async () => {
    mockNoSecureDevKeys();
    mocks.upstashPipeline.mockResolvedValueOnce(replies([], []));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1));

    await resetUserProgress("octocat", "admin");

    const cmds = allCommands();
    expect(cmds).not.toContainEqual(["DEL", "ctf:user:octocat"]);
    expect(cmds.some((c) => c[0] === "SREM")).toBe(false);
  });

  it("WARNS that secure-dev solves come back, rather than pretending", async () => {
    // The scorer writes them with HSETNX so replays no-op, and the poller
    // re-submits from PR comments — so these return on the next re-score.
    // Silence here would be a lie the organizer only discovers later.
    mockSecureDevKeys("ctf:solves:dvwa", ["octocat:c1"]);
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1)); // HDEL of those fields
    mocks.upstashPipeline.mockResolvedValueOnce(replies([], []));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1));

    const result = await resetUserProgress("octocat", "admin");
    expect(result.cleared.secureDevSolves).toBe(1);
    expect(result.warnings.join(" ")).toMatch(/HSETNX|re-ingest/i);
  });

  it("says nothing about secure-dev when there was none to clear", async () => {
    mockNoSecureDevKeys();
    mocks.upstashPipeline.mockResolvedValueOnce(replies([], []));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1));
    expect((await resetUserProgress("octocat", "admin")).warnings).toEqual([]);
  });

  it("writes an audit line naming the actor AND the target", async () => {
    mockNoSecureDevKeys();
    mocks.upstashPipeline.mockResolvedValueOnce(replies([], []));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1));

    await resetUserProgress("octocat", "alice");

    const push = allCommands().find((c) => c[0] === "LPUSH" && c[1] === "ctf:admin:audit");
    const line = JSON.parse(String(push?.[2])) as Record<string, unknown>;
    expect(line.by).toBe("alice");
    expect(line.login).toBe("octocat");
    expect(line.action).toBe("ops:user-reset");
  });
});

describe("deleteUser", () => {
  it("refuses to delete a captain, naming the way out", async () => {
    // Deleting the captain would leave a team nobody can administer: rename,
    // remove, regenerate and disband are all captain-only.
    mocks.upstashPipeline.mockResolvedValueOnce(
      replies(userHmget("red-team"), [], [], null, null, [], [], null, null, 0, null),
    );
    mocks.upstashPipeline.mockResolvedValueOnce(replies("Red Team", "octocat"));
    mockNoSecureDevKeys();

    await expect(deleteUser("octocat", "admin")).rejects.toThrow(/captain/i);
    // and nothing was cleared on the way to that refusal
    expect(allCommands().some((c) => c[0] === "DEL")).toBe(false);
  });

  it("removes the membership and the account record", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce(
      replies(userHmget("red-team"), [], [], null, null, [], [], null, null, 0, null),
    );
    mocks.upstashPipeline.mockResolvedValueOnce(replies("Red Team", "alice"));
    mockNoSecureDevKeys();
    mockNoSecureDevKeys(); // the reset's own sweep
    mocks.upstashPipeline.mockResolvedValueOnce(replies([], []));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1)); // reset audit
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1)); // SREM + DEL
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1)); // delete audit

    const result = await deleteUser("octocat", "admin");
    expect(result.leftTeam).toBe("red-team");
    const cmds = allCommands();
    expect(cmds).toContainEqual(["SREM", "ctf:team:red-team:members", "octocat"]);
    expect(cmds).toContainEqual(["DEL", "ctf:user:octocat"]);
  });
});

describe("team overrides", () => {
  it("refuses to remove the captain", async () => {
    mocks.upstashEval.mockResolvedValueOnce("is-captain");
    await expect(forceRemoveFromTeam("red-team", "octocat", "admin")).rejects.toThrow(/captain/i);
  });

  it("refuses to remove someone who is not on the team", async () => {
    mocks.upstashEval.mockResolvedValueOnce("not-member");
    await expect(forceRemoveFromTeam("red-team", "octocat", "admin")).rejects.toThrow(/not on/i);
  });

  it("clears the user's team pointer in the SAME script as the SREM", async () => {
    // A member set and the ctf:user:<login> hash that points at it must not be
    // able to disagree, so the two writes are one atomic step — the same rule
    // team-store's own captain actions follow.
    mocks.upstashEval.mockResolvedValueOnce("ok");
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1));
    await forceRemoveFromTeam("red-team", "octocat", "admin");
    const [script] = mocks.upstashEval.mock.calls[0];
    expect(script).toContain("SREM");
    expect(script).toContain("HDEL");
  });

  it("will not hand a team to someone who is not a member", async () => {
    mocks.upstashEval.mockResolvedValueOnce("not-member");
    await expect(forceTransferCaptain("red-team", "outsider", "admin")).rejects.toThrow(/not on/i);
  });

  it("checks membership INSIDE the transfer script, not before it", async () => {
    mocks.upstashEval.mockResolvedValueOnce("ok");
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1));
    await forceTransferCaptain("red-team", "bob", "admin");
    const [script, keys] = mocks.upstashEval.mock.calls[0];
    expect(script).toContain("SISMEMBER");
    expect(keys).toEqual(["ctf:team:red-team", "ctf:team:red-team:members"]);
  });

  it("disband releases every member and kills the join code", async () => {
    // A surviving reverse index keeps resolving to a team that no longer
    // exists, and /join/<code> would render a card for a ghost.
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, ["alice", "bob"], "ABC123"));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1, 1, 1));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1));

    const result = await forceDisbandTeam("red-team", "admin");
    expect(result.members).toBe(2);
    const cmds = allCommands();
    expect(cmds).toContainEqual(["HDEL", "ctf:user:alice", "team", "joinedAt"]);
    expect(cmds).toContainEqual(["HDEL", "ctf:user:bob", "team", "joinedAt"]);
    expect(cmds).toContainEqual(["DEL", "ctf:joincode:abc123"]);
  });

  it("disband does NOT delete anyone's progress", async () => {
    // Solves are per login, so a disbanded team's players keep what they
    // earned and can regroup. Deleting their work because the team was wrong
    // would turn an admin convenience into a scoring incident.
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, ["alice"], "ABC123"));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1, 1));
    mocks.upstashPipeline.mockResolvedValueOnce(replies(1, 1));

    await forceDisbandTeam("red-team", "admin");
    const cmds = allCommands();
    expect(cmds.some((c) => String(c[1]).startsWith("ctf:classic:solves:"))).toBe(false);
    expect(cmds.some((c) => String(c[1]).startsWith("ctf:quiz:answers:"))).toBe(false);
  });

  it("refuses to disband a team that does not exist", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce(replies(0, [], null));
    await expect(forceDisbandTeam("ghost", "admin")).rejects.toThrow(/No team/);
  });
});
