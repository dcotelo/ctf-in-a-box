import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upstashEval: vi.fn(),
  upstashPipeline: vi.fn<(c: (string | number)[][]) => Promise<{ result?: unknown }[]>>(),
  isModuleEnabled: vi.fn<(id: string) => boolean>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({ upstashEval: mocks.upstashEval, upstashPipeline: mocks.upstashPipeline }));
vi.mock("@/lib/modules", () => ({ isModuleEnabled: mocks.isModuleEnabled }));

import { seedDemoData } from "@/lib/admin-store";
import { upsertQuestion } from "@/lib/quiz-store";
import { normalizeFlag } from "@/lib/classic-keys";
import {
  DEMO_CONTESTANTS,
  DEMO_TEAMS,
  DEMO_QUESTIONS,
  DEMO_QUIZ_ANSWERS,
  DEMO_CHALLENGES,
  DEMO_CLASSIC_CATEGORIES,
  DEMO_CLASSIC_SOLVES,
} from "@/lib/demo-fixture";

beforeEach(() => {
  mocks.upstashPipeline.mockReset();
  // Answers BOTH pipelines the seed now runs: the settings read (HGETALL,
  // which the clamp consumes — empty hash = no schedule = unclamped) and the
  // write batch (whose return is unused).
  mocks.upstashPipeline.mockResolvedValue([{ result: [] }]);
  mocks.isModuleEnabled.mockReset();
  mocks.isModuleEnabled.mockImplementation((id) => id === "quiz" || id === "classic");
});

describe("seedDemoData", () => {
  it("writes solves, teams, membership + a seed audit line in one pipeline", async () => {
    const out = await seedDemoData("alice");

    const expectedSolves = DEMO_CONTESTANTS.reduce(
      (n, c) => n + Object.values(c.solves).reduce((m, ids) => m + ids.length, 0),
      0,
    );
    expect(out).toEqual({ contestants: DEMO_CONTESTANTS.length, teams: DEMO_TEAMS.length, solves: expectedSolves });

    // Two pipeline calls now: the schedule read (for the timestamp clamp),
    // then every write in ONE batch — the writes stay a single pipeline.
    expect(mocks.upstashPipeline).toHaveBeenCalledTimes(2);
    const cmds = mocks.upstashPipeline.mock.calls.at(-1)![0];

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
    const cmds = mocks.upstashPipeline.mock.calls.at(-1)![0];
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

  // The clamp: seeded history must agree with the phase line. A seed clicked
  // two hours into a scheduled event must not stamp solves before "scoring
  // opens" — that put a full race on the chart dated before the schedule
  // said scoring existed.
  it("clamps every seeded timestamp inside the scoring window when one is set", async () => {
    const startMs = Date.now() - 2 * 60 * 60 * 1000; // opened 2h ago
    const endMs = Date.now() + 24 * 60 * 60 * 1000; // closes tomorrow
    mocks.upstashPipeline.mockResolvedValueOnce([
      {
        result: [
          "scoringStartsAt",
          new Date(startMs).toISOString(),
          "scoringEndsAt",
          new Date(endMs).toISOString(),
        ],
      },
    ]);
    await seedDemoData("alice");
    const cmds = mocks.upstashPipeline.mock.calls.at(-1)![0];
    const stamps = cmds
      .filter(
        (c) =>
          c[0] === "HSET" &&
          (String(c[1]).startsWith("ctf:solves:") || String(c[1]).startsWith("ctf:quiz:answers:")),
      )
      .map((c) => Date.parse(String(c[3]).startsWith("{") ? (JSON.parse(String(c[3])) as { at: string }).at : String(c[3])));
    expect(stamps.length).toBeGreaterThan(0);
    for (const t of stamps) {
      expect(t).toBeGreaterThanOrEqual(startMs);
      expect(t).toBeLessThanOrEqual(Date.now());
    }
  });

  it("falls back to the unclamped window when the schedule is entirely in the future", async () => {
    const startMs = Date.now() + 60 * 60 * 1000; // opens in an hour
    mocks.upstashPipeline.mockResolvedValueOnce([
      { result: ["scoringStartsAt", new Date(startMs).toISOString()] },
    ]);
    await seedDemoData("alice");
    const cmds = mocks.upstashPipeline.mock.calls.at(-1)![0];
    const stamps = cmds
      .filter((c) => c[0] === "HSET" && String(c[1]).startsWith("ctf:solves:"))
      .map((c) => Date.parse(String(c[3])));
    expect(stamps.length).toBeGreaterThan(0);
    // Never future-dated — the fallback is yesterday's now-minus-6h window.
    for (const t of stamps) expect(t).toBeLessThanOrEqual(Date.now());
  });

  it("puts every demo contestant on a team (no soloists left off the team board)", () => {
    const teamed = new Set(DEMO_TEAMS.flatMap((t) => t.members));
    for (const c of DEMO_CONTESTANTS) expect(teamed.has(c.login)).toBe(true);
    // and every team's captain is one of its members
    for (const t of DEMO_TEAMS) expect(t.members).toContain(t.captain);
  });

  it("seeds demo questions and answers so DEMO_MODE shows two scoring modules", async () => {
    await seedDemoData("alice");
    const cmds = mocks.upstashPipeline.mock.calls.at(-1)![0];

    // a mix of single and multi questions
    expect(DEMO_QUESTIONS.some((q) => q.type === "single")).toBe(true);
    expect(DEMO_QUESTIONS.some((q) => q.type === "multi")).toBe(true);
    expect(DEMO_QUESTIONS.length).toBeGreaterThanOrEqual(5);

    // one HSET per question into the public questions hash, with NO `correct`
    // field leaked into the stored value
    const questionCmds = cmds.filter((c) => c[0] === "HSET" && c[1] === "ctf:quiz:questions");
    expect(questionCmds.length).toBe(DEMO_QUESTIONS.length);
    for (const c of questionCmds) {
      const stored = JSON.parse(String(c[3]));
      expect(stored.correct).toBeUndefined();
    }

    // one HSET per question into the answer-key hash, each a sorted, deduped
    // JSON array of correct choice ids — proven by driving quiz-store's OWN
    // upsertQuestion with the same `correct` set and asserting the seed's
    // stored value is byte-identical to what upsertQuestion itself writes.
    // This must fail if quiz-store's canonicalization ever changes and the
    // seed doesn't follow, rather than the test re-deriving the formula
    // (which would drift in lockstep with a bug instead of catching it).
    const keyCmds = cmds.filter((c) => c[0] === "HSET" && c[1] === "ctf:quiz:key");
    expect(keyCmds.length).toBe(DEMO_QUESTIONS.length);
    for (const q of DEMO_QUESTIONS) {
      await upsertQuestion(
        { id: q.id, prompt: q.prompt, type: q.type, choices: q.choices, points: q.points, order: q.order },
        q.correct,
      );
      const realCall = mocks.upstashPipeline.mock.calls.at(-1)![0];
      const realKeyCmd = realCall.find((c) => c[0] === "HSET" && c[1] === "ctf:quiz:key")!;

      const seededCmd = keyCmds.find((c) => c[2] === q.id)!;
      expect(seededCmd[3]).toBe(realKeyCmd[3]); // byte-identical to quiz-store's own output

      const stored = JSON.parse(String(seededCmd[3]));
      expect(stored).toEqual([...stored].sort()); // sorted
      expect(new Set(stored).size).toBe(stored.length); // deduped
    }

    // answers are spread across more than one demo contestant, each written
    // into that login's own answers hash
    const answerCmds = cmds.filter((c) => c[0] === "HSET" && String(c[1]).startsWith("ctf:quiz:answers:"));
    expect(answerCmds.length).toBe(DEMO_QUIZ_ANSWERS.length);
    const logins = new Set(answerCmds.map((c) => String(c[1]).replace("ctf:quiz:answers:", "")));
    expect(logins.size).toBeGreaterThan(1);

    // each stored answer row is well-formed and timestamped inside the same
    // ~6h window as the seeded solves
    const windowMs = 6 * 60 * 60 * 1000;
    for (const c of answerCmds) {
      const row = JSON.parse(String(c[3]));
      expect(Array.isArray(row.choices)).toBe(true);
      expect(typeof row.points).toBe("number");
      const ageMs = Date.now() - Date.parse(row.at);
      expect(ageMs).toBeGreaterThanOrEqual(0);
      expect(ageMs).toBeLessThanOrEqual(windowMs + 1000);
    }

    // the two aggregate hashes are updated so the leaderboard overlay picks
    // up quiz points for every login that answered something
    const pointsCmds = cmds.filter((c) => c[0] === "HSET" && c[1] === "ctf:quiz:points");
    const answeredCmds = cmds.filter((c) => c[0] === "HSET" && c[1] === "ctf:quiz:answered");
    expect(pointsCmds.length).toBe(logins.size);
    expect(answeredCmds.length).toBe(logins.size);
    for (const login of logins) {
      const expectedAnswers = DEMO_QUIZ_ANSWERS.filter((a) => a.login === login);
      const expectedPoints = expectedAnswers.reduce(
        (sum, a) => sum + DEMO_QUESTIONS.find((q) => q.id === a.questionId)!.points,
        0,
      );
      const pointsCmd = pointsCmds.find((c) => c[2] === login)!;
      const answeredCmd = answeredCmds.find((c) => c[2] === login)!;
      expect(Number(pointsCmd[3])).toBe(expectedPoints);
      expect(Number(answeredCmd[3])).toBe(expectedAnswers.length);
    }
  });

  it("writes no ctf:quiz:* keys when the quiz module is disabled", async () => {
    mocks.isModuleEnabled.mockImplementation((id) => id === "classic");
    await seedDemoData("alice");
    const cmds = mocks.upstashPipeline.mock.calls.at(-1)![0];
    expect(cmds.some((c) => String(c[1]).startsWith("ctf:quiz:"))).toBe(false);
  });

  it("seeds classic challenges + both flag hashes, with NO flag in the public record", async () => {
    await seedDemoData("alice");
    const cmds = mocks.upstashPipeline.mock.calls.at(-1)![0];

    expect(DEMO_CHALLENGES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(DEMO_CHALLENGES.map((c) => c.category)).size).toBeGreaterThanOrEqual(3);

    // one HSET per challenge into the public challenges hash, with NO flag
    // field anywhere in the stored value
    const challengeCmds = cmds.filter((c) => c[0] === "HSET" && c[1] === "ctf:classic:challenges");
    expect(challengeCmds.length).toBe(DEMO_CHALLENGES.length);
    for (const c of challengeCmds) {
      const stored = JSON.parse(String(c[3]));
      expect(stored.flag).toBeUndefined();
      expect(JSON.stringify(stored)).not.toMatch(/ctfbox/i);
    }

    // the authored flag hash holds the flag verbatim
    const flagCmds = cmds.filter((c) => c[0] === "HSET" && c[1] === "ctf:classic:flag");
    expect(flagCmds.length).toBe(DEMO_CHALLENGES.length);
    for (const dc of DEMO_CHALLENGES) {
      const cmd = flagCmds.find((c) => c[2] === dc.id)!;
      expect(cmd[3]).toBe(dc.flag);
    }

    // the normalized flag hash is EXACTLY normalizeFlag(authored) — proven
    // against classic-keys.ts's own function, never a re-derived formula
    const flagnormCmds = cmds.filter((c) => c[0] === "HSET" && c[1] === "ctf:classic:flagnorm");
    expect(flagnormCmds.length).toBe(DEMO_CHALLENGES.length);
    for (const dc of DEMO_CHALLENGES) {
      const cmd = flagnormCmds.find((c) => c[2] === dc.id)!;
      expect(cmd[3]).toBe(normalizeFlag(dc.flag));
    }

    // the categories key is a JSON array, in the fixture's display order
    const categoriesCmd = cmds.find((c) => c[0] === "SET" && c[1] === "ctf:classic:categories");
    expect(categoriesCmd).toBeTruthy();
    expect(JSON.parse(String(categoriesCmd![2]))).toEqual(DEMO_CLASSIC_CATEGORIES);
  });

  it("seeds classic solves so aggregates agree with the per-login rows and solvecount", async () => {
    await seedDemoData("alice");
    const cmds = mocks.upstashPipeline.mock.calls.at(-1)![0];

    expect(DEMO_CLASSIC_SOLVES.length).toBeGreaterThan(0);

    // one HSET per solve into that login's own solves hash
    const solveCmds = cmds.filter((c) => c[0] === "HSET" && String(c[1]).startsWith("ctf:classic:solves:"));
    expect(solveCmds.length).toBe(DEMO_CLASSIC_SOLVES.length);
    const logins = new Set(solveCmds.map((c) => String(c[1]).replace("ctf:classic:solves:", "")));
    expect(logins.size).toBeGreaterThan(1);

    // each stored solve row is well-formed and timestamped inside the same
    // ~6h window as the other seeded activity
    const windowMs = 6 * 60 * 60 * 1000;
    for (const c of solveCmds) {
      const row = JSON.parse(String(c[3]));
      expect(typeof row.points).toBe("number");
      const ageMs = Date.now() - Date.parse(row.at);
      expect(ageMs).toBeGreaterThanOrEqual(0);
      expect(ageMs).toBeLessThanOrEqual(windowMs + 1000);
    }

    // aggregate points/solved MUST equal what the per-login solve rows imply
    const pointsCmds = cmds.filter((c) => c[0] === "HSET" && c[1] === "ctf:classic:points");
    const solvedCmds = cmds.filter((c) => c[0] === "HSET" && c[1] === "ctf:classic:solved");
    expect(pointsCmds.length).toBe(logins.size);
    expect(solvedCmds.length).toBe(logins.size);
    for (const login of logins) {
      const rowsForLogin = DEMO_CLASSIC_SOLVES.filter((s) => s.login === login);
      const expectedPoints = rowsForLogin.reduce(
        (sum, s) => sum + DEMO_CHALLENGES.find((c) => c.id === s.challengeId)!.points,
        0,
      );
      const pointsCmd = pointsCmds.find((c) => c[2] === login)!;
      const solvedCmd = solvedCmds.find((c) => c[2] === login)!;
      expect(Number(pointsCmd[3])).toBe(expectedPoints);
      expect(Number(solvedCmd[3])).toBe(rowsForLogin.length);
    }

    // solvecount per challenge MUST equal the number of DISTINCT logins that
    // solved it (the fixture has no duplicate (login, challengeId) pairs, so
    // this is just a row count per challenge)
    const solveCountCmds = cmds.filter((c) => c[0] === "HSET" && c[1] === "ctf:classic:solvecount");
    const solvedChallengeIds = new Set(DEMO_CLASSIC_SOLVES.map((s) => s.challengeId));
    expect(solveCountCmds.length).toBe(solvedChallengeIds.size);
    for (const challengeId of solvedChallengeIds) {
      const expectedCount = DEMO_CLASSIC_SOLVES.filter((s) => s.challengeId === challengeId).length;
      const cmd = solveCountCmds.find((c) => c[2] === challengeId)!;
      expect(Number(cmd[3])).toBe(expectedCount);
    }
  });

  it("writes no ctf:classic:* keys when the classic module is disabled", async () => {
    mocks.isModuleEnabled.mockImplementation((id) => id === "quiz");
    await seedDemoData("alice");
    const cmds = mocks.upstashPipeline.mock.calls.at(-1)![0];
    expect(cmds.some((c) => String(c[1]).startsWith("ctf:classic:"))).toBe(false);
  });

  // --- attempt rows -----------------------------------------------------
  //
  // The seed banks earned rows directly, so it used to produce an event in
  // which nobody had ever TRIED anything. Insights then reported a 100% solve
  // rate, "1.0" average tries and a blank median time on every challenge —
  // numbers that are each individually well-formed and collectively a lie.
  // These pin the attempt rows that make those figures mean something.

  for (const [module, prefix, earnedPrefix] of [
    ["quiz", "ctf:quiz:attempts:", "ctf:quiz:answers:"],
    ["classic", "ctf:classic:attempts:", "ctf:classic:solves:"],
  ] as const) {
    it(`records how many tries each seeded ${module} item took`, async () => {
      await seedDemoData("alice");
      const cmds = mocks.upstashPipeline.mock.calls.at(-1)![0];

      const attemptCmds = cmds.filter((c) => c[0] === "HSET" && String(c[1]).startsWith(prefix));
      const earnedCmds = cmds.filter((c) => c[0] === "HSET" && String(c[1]).startsWith(earnedPrefix));
      expect(earnedCmds.length).toBeGreaterThan(0);

      // EVERY earned row has an attempt row for the same (login, id). Without
      // this the average-tries column silently falls back to 1.0.
      const attemptKeys = new Set(attemptCmds.map((c) => `${c[1]}|${c[2]}`));
      for (const c of earnedCmds) {
        const login = String(c[1]).replace(earnedPrefix, "");
        expect(attemptKeys.has(`${prefix}${login}|${c[2]}`)).toBe(true);
      }

      const windowMs = 6 * 60 * 60 * 1000;
      for (const c of attemptCmds) {
        const row = JSON.parse(String(c[3]));
        // The live shape, field for field — a row metrics-store cannot parse
        // is the same as no row at all, but fails silently instead of loudly.
        expect(typeof row.attempts).toBe("number");
        expect(row.attempts).toBeGreaterThanOrEqual(1);
        expect(row.lastAtMs).toBe(Date.parse(row.lastAt));
        // firstAt at or before lastAt, and inside the seeded window. The
        // metrics fold DROPS a duration whose start is after its end, so a
        // reversed pair here would show up as a blank median, not an error.
        const firstMs = Date.parse(row.firstAt);
        expect(firstMs).toBeLessThanOrEqual(row.lastAtMs);
        expect(Date.now() - firstMs).toBeLessThanOrEqual(windowMs + 60 * 60 * 1000);
      }
    });
  }

  it("leaves some items attempted but never earned, so solve rates are not all 100%", async () => {
    await seedDemoData("alice");
    const cmds = mocks.upstashPipeline.mock.calls.at(-1)![0];

    // At least one (login, id) pair that has an attempt row and NO earned row.
    // This is the pair that makes a solve rate fall below 100%: the metrics
    // denominator counts everyone who tried, so with no failures recorded
    // every rate pins to exactly 100% no matter how hard the challenge was.
    const unearned = (attemptPrefix: string, earnedPrefix: string) => {
      const earned = new Set(
        cmds
          .filter((c) => c[0] === "HSET" && String(c[1]).startsWith(earnedPrefix))
          .map((c) => `${String(c[1]).replace(earnedPrefix, "")}|${c[2]}`),
      );
      return cmds
        .filter((c) => c[0] === "HSET" && String(c[1]).startsWith(attemptPrefix))
        .filter((c) => !earned.has(`${String(c[1]).replace(attemptPrefix, "")}|${c[2]}`));
    };

    expect(unearned("ctf:quiz:attempts:", "ctf:quiz:answers:").length).toBeGreaterThan(0);
    expect(unearned("ctf:classic:attempts:", "ctf:classic:solves:").length).toBeGreaterThan(0);
  });

  it("gives every attempt row a nonzero duration, one-try rows included", async () => {
    // Deriving firstAt from the gaps BETWEEN tries alone leaves a one-try row
    // with firstAt === lastAt, and Insights then reported a median
    // time-to-solve of "0s" — arithmetically honest and factually impossible.
    // A first try is not the moment the contestant met the challenge; the
    // reading came first.
    await seedDemoData("alice");
    const rows = mocks.upstashPipeline.mock.calls.at(-1)![0]
      .filter((c) => c[0] === "HSET" && /^ctf:(quiz|classic):attempts:/.test(String(c[1])))
      .map((c) => JSON.parse(String(c[3])) as { attempts: number; firstAt: string; lastAtMs: number });

    expect(rows.length).toBeGreaterThan(0);
    // The one-try rows are the ones that regress, so fail loudly if the
    // fixture ever stops producing any and this test goes quietly vacuous.
    expect(rows.some((r) => r.attempts === 1)).toBe(true);
    for (const r of rows) {
      expect(r.lastAtMs - Date.parse(r.firstAt)).toBeGreaterThan(0);
    }
  });

  it("takes more than one try on some items, so average tries is not a flat 1.0", async () => {
    await seedDemoData("alice");
    const cmds = mocks.upstashPipeline.mock.calls.at(-1)![0];
    const tries = cmds
      .filter((c) => c[0] === "HSET" && /^ctf:(quiz|classic):attempts:/.test(String(c[1])))
      .map((c) => JSON.parse(String(c[3])).attempts as number);
    expect(tries.some((t) => t > 1)).toBe(true);
  });

  it("keeps the same attempt rows on a re-seed (absolute HSET, never an increment)", async () => {
    // The seed is documented as idempotent and the aggregates are written as
    // absolute totals for that reason. An attempt row written with HINCRBY, or
    // with a time derived from Date.now() per-run, would break that quietly:
    // the second seed would double the tries instead of replacing them.
    await seedDemoData("alice");
    const first = mocks.upstashPipeline.mock.calls.at(-1)![0].filter(
      (c) => /^ctf:(quiz|classic):attempts:/.test(String(c[1])),
    );
    // Non-empty FIRST. Both assertions below are `.every()`, which is
    // vacuously true over an empty array — without this line the test passed
    // against a seed that wrote no attempt rows at all, which is precisely the
    // bug it exists to catch.
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((c) => c[0] === "HSET")).toBe(true);
    expect(first.every((c) => JSON.parse(String(c[3])).attempts >= 1)).toBe(true);
  });
});
