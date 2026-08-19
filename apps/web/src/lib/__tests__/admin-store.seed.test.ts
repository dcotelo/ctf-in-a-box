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
  mocks.upstashPipeline.mockResolvedValue([]);
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

  it("seeds demo questions and answers so DEMO_MODE shows two scoring modules", async () => {
    await seedDemoData("alice");
    const cmds = mocks.upstashPipeline.mock.calls[0][0];

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
    const cmds = mocks.upstashPipeline.mock.calls[0][0];
    expect(cmds.some((c) => String(c[1]).startsWith("ctf:quiz:"))).toBe(false);
  });

  it("seeds classic challenges + both flag hashes, with NO flag in the public record", async () => {
    await seedDemoData("alice");
    const cmds = mocks.upstashPipeline.mock.calls[0][0];

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
    const cmds = mocks.upstashPipeline.mock.calls[0][0];

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
    const cmds = mocks.upstashPipeline.mock.calls[0][0];
    expect(cmds.some((c) => String(c[1]).startsWith("ctf:classic:"))).toBe(false);
  });
});
