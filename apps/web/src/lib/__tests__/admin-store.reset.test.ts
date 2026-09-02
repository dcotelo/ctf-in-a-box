import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upstashEval: vi.fn<(s: string, k: string[], a: (string | number)[]) => Promise<unknown>>(),
  upstashPipeline: vi.fn<(c: (string | number)[][]) => Promise<{ result?: unknown; error?: string }[]>>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({ upstashEval: mocks.upstashEval, upstashPipeline: mocks.upstashPipeline }));

import { resetEvent } from "@/lib/admin-store";

beforeEach(() => {
  mocks.upstashEval.mockReset();
  mocks.upstashPipeline.mockReset();
  mocks.upstashEval.mockResolvedValue([]);
});

// Route each pipeline command: SCAN returns [cursor, keys], DEL returns a count.
function pipelineImpl(scanKeys: (pattern: string) => string[][]) {
  const pages = new Map<string, string[][]>();
  return async (cmds: (string | number)[][]) => {
    const cmd = cmds[0];
    const verb = String(cmd[0]);
    if (verb === "SCAN") {
      const pattern = String(cmd[3]);
      if (!pages.has(pattern)) pages.set(pattern, scanKeys(pattern));
      const remaining = pages.get(pattern)!;
      const batch = remaining.shift() ?? [];
      const cursor = remaining.length > 0 ? "7" : "0";
      return [{ result: [cursor, batch] }];
    }
    if (verb === "DEL") return [{ result: cmd.length - 1 }];
    return [{ result: null }];
  };
}

describe("resetEvent", () => {
  it("wipes every event-data prefix, then freezes + audits in one eval", async () => {
    // two keys for every prefix, single SCAN page each
    mocks.upstashPipeline.mockImplementation(pipelineImpl(() => [["k1", "k2"]]));

    const out = await resetEvent("alice");

    expect(out.cleared).toEqual({
      solves: 2,
      teams: 2,
      users: 2,
      joinCodes: 2,
      hints: 2,
      quizAnswers: 2,
      quizAttempts: 2,
      quizPoints: 2,
      quizAnswered: 2,
      classicSolves: 2,
      classicAttempts: 2,
      classicPoints: 2,
      classicSolved: 2,
      classicSolveCount: 2,
      aiSolves: 2,
      aiAttempts: 2,
      aiPoints: 2,
      aiSolved: 2,
      aiSolveCount: 2,
      aiNonces: 2,
      aiLaunchKey: 2,
      activity: 2,
    });
    expect(out.resetAt).toMatch(/^\d+$/);

    // one SCAN + one DEL per prefix (22 prefixes) = 44 pipeline calls
    const verbs = mocks.upstashPipeline.mock.calls.map((c) => c[0][0][0]);
    expect(verbs.filter((v) => v === "SCAN").length).toBe(22);
    expect(verbs.filter((v) => v === "DEL").length).toBe(22);
    // every wiped prefix, and NOT settings/audit/sync
    const patterns = mocks.upstashPipeline.mock.calls
      .filter((c) => c[0][0][0] === "SCAN")
      .map((c) => c[0][0][3]);
    expect(patterns).toEqual([
      "ctf:solves:*",
      "ctf:team:*",
      "ctf:user:*",
      "ctf:joincode:*",
      "ctf:hints:*",
      "ctf:quiz:answers:*",
      "ctf:quiz:attempts:*",
      "ctf:quiz:points",
      "ctf:quiz:answered",
      "ctf:classic:solves:*",
      "ctf:classic:attempts:*",
      "ctf:classic:points",
      "ctf:classic:solved",
      "ctf:classic:solvecount",
      "ctf:ai:solves:*",
      "ctf:ai:attempts:*",
      "ctf:ai:points",
      "ctf:ai:solved",
      "ctf:ai:solvecount",
      "ctf:ai:nonce:*",
      "ctf:ai:launchkey",
      "ctf:activity:log",
    ]);

    // the freeze + audit eval: settings + audit keys, and a reset audit line
    expect(mocks.upstashEval).toHaveBeenCalledTimes(1);
    const [script, keys, args] = mocks.upstashEval.mock.calls[0];
    expect(script).toContain("'paused', '1'");
    expect(keys).toEqual(["ctf:admin:settings", "ctf:admin:audit"]);
    expect(args[0]).toBe("alice"); // actor
    const auditLine = JSON.parse(String(args[3]));
    expect(auditLine).toMatchObject({ by: "alice", action: "reset", cleared: { solves: 2, teams: 2 } });
  });

  it("wipes quiz answers and attempts", async () => {
    mocks.upstashPipeline.mockImplementation(pipelineImpl(() => [["k1"]]));
    await resetEvent("alice");
    const patterns = mocks.upstashPipeline.mock.calls
      .filter((c) => c[0][0][0] === "SCAN")
      .map((c) => c[0][0][3]);
    expect(patterns).toContain("ctf:quiz:answers:*");
    expect(patterns).toContain("ctf:quiz:attempts:*");
  });

  it("KEEPS the question bank and the answer key across a reset", async () => {
    mocks.upstashPipeline.mockImplementation(pipelineImpl(() => [["k1"]]));
    await resetEvent("alice");
    const patterns = mocks.upstashPipeline.mock.calls
      .filter((c) => c[0][0][0] === "SCAN")
      .map((c) => c[0][0][3]);
    expect(patterns).not.toContain("ctf:quiz:questions");
    expect(patterns).not.toContain("ctf:quiz:key");
  });

  it("also clears the quiz aggregate totals", async () => {
    mocks.upstashPipeline.mockImplementation(pipelineImpl(() => [["k1"]]));
    const out = await resetEvent("alice");
    const patterns = mocks.upstashPipeline.mock.calls
      .filter((c) => c[0][0][0] === "SCAN")
      .map((c) => c[0][0][3]);
    expect(patterns).toContain("ctf:quiz:points");
    expect(patterns).toContain("ctf:quiz:answered");
    expect(out.cleared.quizPoints).toBe(1);
    expect(out.cleared.quizAnswered).toBe(1);
  });

  it("wipes classic solves and attempts", async () => {
    mocks.upstashPipeline.mockImplementation(pipelineImpl(() => [["k1"]]));
    await resetEvent("alice");
    const patterns = mocks.upstashPipeline.mock.calls
      .filter((c) => c[0][0][0] === "SCAN")
      .map((c) => c[0][0][3]);
    expect(patterns).toContain("ctf:classic:solves:*");
    expect(patterns).toContain("ctf:classic:attempts:*");
  });

  it("KEEPS the classic challenge bank, flag key, and categories across a reset", async () => {
    mocks.upstashPipeline.mockImplementation(pipelineImpl(() => [["k1"]]));
    await resetEvent("alice");
    const patterns = mocks.upstashPipeline.mock.calls
      .filter((c) => c[0][0][0] === "SCAN")
      .map((c) => c[0][0][3]);
    expect(patterns).not.toContain("ctf:classic:challenges");
    expect(patterns).not.toContain("ctf:classic:flag");
    expect(patterns).not.toContain("ctf:classic:flagnorm");
    expect(patterns).not.toContain("ctf:classic:categories");
  });

  it("also clears the classic aggregate totals", async () => {
    mocks.upstashPipeline.mockImplementation(pipelineImpl(() => [["k1"]]));
    const out = await resetEvent("alice");
    const patterns = mocks.upstashPipeline.mock.calls
      .filter((c) => c[0][0][0] === "SCAN")
      .map((c) => c[0][0][3]);
    expect(patterns).toContain("ctf:classic:points");
    expect(patterns).toContain("ctf:classic:solved");
    expect(patterns).toContain("ctf:classic:solvecount");
    expect(out.cleared.classicPoints).toBe(1);
    expect(out.cleared.classicSolved).toBe(1);
    expect(out.cleared.classicSolveCount).toBe(1);
  });

  it("wipes ai solves, attempts and nonces", async () => {
    mocks.upstashPipeline.mockImplementation(pipelineImpl(() => [["k1"]]));
    await resetEvent("alice");
    const patterns = mocks.upstashPipeline.mock.calls
      .filter((c) => c[0][0][0] === "SCAN")
      .map((c) => c[0][0][3]);
    expect(patterns).toContain("ctf:ai:solves:*");
    expect(patterns).toContain("ctf:ai:attempts:*");
    expect(patterns).toContain("ctf:ai:nonce:*");
  });

  it("also clears the ai aggregate totals and the per-challenge solvecount", async () => {
    mocks.upstashPipeline.mockImplementation(pipelineImpl(() => [["k1"]]));
    const out = await resetEvent("alice");
    const patterns = mocks.upstashPipeline.mock.calls
      .filter((c) => c[0][0][0] === "SCAN")
      .map((c) => c[0][0][3]);
    expect(patterns).toContain("ctf:ai:points");
    expect(patterns).toContain("ctf:ai:solved");
    expect(patterns).toContain("ctf:ai:solvecount");
    expect(out.cleared.aiPoints).toBe(1);
    expect(out.cleared.aiSolved).toBe(1);
    expect(out.cleared.aiSolveCount).toBe(1);
  });

  // The spec's explicit rule: a master reset MUST rotate the launch key — no
  // live launch token should survive an event starting over. This is the
  // opposite of `clearAiChallenges` (ai-store.ts), which is pinned NEVER to
  // touch `ctf:ai:launchkey` by `ai-store.authoring.test.ts`'s
  // "wipes every content key in one pipeline" test (its exact command list has
  // no `DEL ctf:ai:launchkey`) — that one backs a replace-all archive import,
  // not a reset. Not re-asserted here, just cited.
  it("DOES clear the launch keypair — a master reset must rotate it", async () => {
    mocks.upstashPipeline.mockImplementation(pipelineImpl(() => [["k1"]]));
    const out = await resetEvent("alice");
    const patterns = mocks.upstashPipeline.mock.calls
      .filter((c) => c[0][0][0] === "SCAN")
      .map((c) => c[0][0][3]);
    expect(patterns).toContain("ctf:ai:launchkey");
    expect(out.cleared.aiLaunchKey).toBe(1);
  });

  it("KEEPS the ai challenge bank, flag/flagnorm, hints, signing keys and categories across a reset", async () => {
    mocks.upstashPipeline.mockImplementation(pipelineImpl(() => [["k1"]]));
    await resetEvent("alice");
    const patterns = mocks.upstashPipeline.mock.calls
      .filter((c) => c[0][0][0] === "SCAN")
      .map((c) => c[0][0][3]);
    expect(patterns).not.toContain("ctf:ai:challenges");
    expect(patterns).not.toContain("ctf:ai:flag");
    expect(patterns).not.toContain("ctf:ai:flagnorm");
    expect(patterns).not.toContain("ctf:ai:hints");
    expect(patterns).not.toContain("ctf:ai:signkey");
    expect(patterns).not.toContain("ctf:ai:categories");
  });

  it("skips DEL for an empty prefix and paginates a multi-page prefix", async () => {
    mocks.upstashPipeline.mockImplementation(
      pipelineImpl((pattern) =>
        pattern === "ctf:solves:*" ? [["a"], ["b", "c"]] : pattern === "ctf:team:*" ? [[]] : [["x"]],
      ),
    );

    const out = await resetEvent("bob");

    expect(out.cleared.solves).toBe(3); // 1 + 2 across two SCAN pages
    expect(out.cleared.teams).toBe(0); // empty -> no DEL
    // teams issued a SCAN but no DEL
    const teamDels = mocks.upstashPipeline.mock.calls.filter(
      (c) => c[0][0][0] === "DEL" && (c[0][0] as unknown[]).includes("ctf:team:*"),
    );
    expect(teamDels.length).toBe(0);
  });
});
