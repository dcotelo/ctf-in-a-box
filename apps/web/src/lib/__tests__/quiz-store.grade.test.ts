// Unit tests for the quiz retry gate and grading. Upstash is mocked, so
// "correct"/"incorrect"/"already" verdicts from the Lua script are simulated
// via mocked upstashEval replies — the actual set-comparison and
// idempotency-guard behavior live in GRADE_SCRIPT (a Lua string this file
// can inspect but not execute), so those invariants are proven here by
// asserting on the script's own text and on the canonicalized args sent into
// it, the same way hint-store.test.ts proves REVEAL_SCRIPT's SADD ordering.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upstashEval: vi.fn<(script: string, keys: string[], args: (string | number)[]) => Promise<unknown>>(),
  upstashPipeline: vi.fn<(commands: (string | number)[][]) => Promise<{ result?: unknown; error?: string }[]>>(),
  getAdminSettings: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({
  upstashEval: mocks.upstashEval,
  upstashPipeline: mocks.upstashPipeline,
}));
vi.mock("@/lib/admin-store", async (orig) => ({
  // Real `effectivePaused` (pure logic over the settings object) — only
  // `getAdminSettings` (the Redis read) is mocked.
  ...(await orig<typeof import("@/lib/admin-store")>()),
  getAdminSettings: mocks.getAdminSettings,
}));

import {
  answerQuestion,
  quizGate,
  upsertQuestion,
  QUIZ_MAX_ATTEMPTS,
  QUIZ_RETRY_AFTER_MIN,
} from "@/lib/quiz-store";

type SettingsOverride = Partial<{
  paused: boolean;
  scoringStartsAt: string | null;
  scoringEndsAt: string | null;
  quizMaxAttempts: number | null;
  quizRetryAfterMin: number | null;
}>;

const settings = (over: SettingsOverride = {}) => ({
  paused: false,
  scoringStartsAt: null,
  scoringEndsAt: null,
  quizMaxAttempts: null,
  quizRetryAfterMin: null,
  ...over,
});

const answeredRow = (points: number, at: string) => JSON.stringify({ choices: ["a"], points, at });
const attemptRow = (attempts: number, lastAt: string) => JSON.stringify({ attempts, lastAt });

/** Mocks the gate's one pipeline call: HGET on the answers hash, then HGET
 *  on the attempts hash, in that order. */
function gateReads(answered: string | null, attempt: string | null) {
  mocks.upstashPipeline.mockResolvedValueOnce([{ result: answered }, { result: attempt }]);
}

beforeEach(() => {
  mocks.upstashEval.mockReset();
  mocks.upstashPipeline.mockReset();
  mocks.getAdminSettings.mockReset();
  mocks.getAdminSettings.mockResolvedValue(settings());
});

describe("grading (all-or-nothing, order-insensitive)", () => {
  it("awards points only for an exact set match (all-or-nothing)", async () => {
    gateReads(null, null);
    mocks.upstashEval.mockResolvedValueOnce(["correct", "20"]);
    const result = await answerQuestion("octocat", "q1", ["a", "c"]);
    expect(result).toEqual({ ok: true, correct: true, points: 20 });
    const [, , args] = mocks.upstashEval.mock.calls[0];
    expect(args[1]).toBe(JSON.stringify(["a", "c"])); // sorted, canonical
  });

  it("scores a partial set 0 and spends an attempt", async () => {
    gateReads(null, null);
    mocks.upstashEval.mockResolvedValueOnce(["incorrect", "1"]);
    const result = await answerQuestion("octocat", "q1", ["a"]);
    expect(result).toEqual({ ok: true, correct: false });
    const [, , args] = mocks.upstashEval.mock.calls[0];
    expect(args[1]).toBe(JSON.stringify(["a"]));
  });

  it("scores a superset 0 and spends an attempt", async () => {
    gateReads(null, null);
    mocks.upstashEval.mockResolvedValueOnce(["incorrect", "1"]);
    const result = await answerQuestion("octocat", "q1", ["a", "b", "c"]);
    expect(result).toEqual({ ok: true, correct: false });
    const [, , args] = mocks.upstashEval.mock.calls[0];
    expect(args[1]).toBe(JSON.stringify(["a", "b", "c"]));
  });

  it("ignores choice order", async () => {
    gateReads(null, null);
    mocks.upstashEval.mockResolvedValueOnce(["correct", "20"]);
    const result = await answerQuestion("octocat", "q1", ["c", "a"]);
    expect(result).toEqual({ ok: true, correct: true, points: 20 });
    // The submission is canonicalized (sorted) before it ever reaches the
    // script, regardless of the order the caller submitted in.
    const [, , args] = mocks.upstashEval.mock.calls[0];
    expect(args[1]).toBe(JSON.stringify(["a", "c"]));
  });

  it("keys the grading call by the server-derived login, the question id, and every hash the script touches", async () => {
    gateReads(null, null);
    mocks.upstashEval.mockResolvedValueOnce(["correct", "20"]);
    await answerQuestion("octocat", "q1", ["a"]);
    const [, keys, args] = mocks.upstashEval.mock.calls[0];
    expect(keys).toEqual([
      "ctf:quiz:attempts:octocat",
      "ctf:quiz:answers:octocat",
      "ctf:quiz:key",
      "ctf:quiz:questions",
      "ctf:quiz:points",
      "ctf:quiz:answered",
    ]);
    expect(args[0]).toBe("q1");
    expect(args[3]).toBe("octocat");
  });

  it("treats a race that already banked a correct answer as correct, awarding nothing further", async () => {
    gateReads(null, null);
    mocks.upstashEval.mockResolvedValueOnce(["already"]);
    const result = await answerQuestion("octocat", "q1", ["a"]);
    expect(result).toEqual({ ok: true, correct: true, points: 0 });
  });

  it("guards the idempotency check before the answer write, re-checks the cap/cooldown before spending an attempt, and gates the aggregates behind the correctness check (one atomic script)", async () => {
    gateReads(null, null);
    mocks.upstashEval.mockResolvedValueOnce(["correct", "20"]);
    await answerQuestion("octocat", "q1", ["a"]);
    const [script] = mocks.upstashEval.mock.calls[0] as [string, string[], (string | number)[]];
    const missing = script.indexOf("'missing'");
    const guard = script.indexOf("HEXISTS");
    const exhaustedReturn = script.indexOf("'exhausted'");
    const cooldownReturn = script.indexOf("'cooldown'");
    const attemptsWrite = script.indexOf("HSET', KEYS[1]");
    const incorrectReturn = script.indexOf("'incorrect'");
    const answerWrite = script.indexOf("HSET', KEYS[2]");
    const pointsIncr = script.indexOf("HINCRBY', KEYS[5]");
    const answeredIncr = script.indexOf("HINCRBY', KEYS[6]");
    for (const idx of [
      missing,
      guard,
      exhaustedReturn,
      cooldownReturn,
      attemptsWrite,
      incorrectReturn,
      answerWrite,
      pointsIncr,
      answeredIncr,
    ]) {
      expect(idx).toBeGreaterThan(-1);
    }
    expect(missing).toBeLessThan(guard);
    // The authoritative cap/cooldown re-check happens after the idempotency
    // guard but strictly BEFORE any attempt is spent — a refusal here writes
    // nothing.
    expect(guard).toBeLessThan(exhaustedReturn);
    expect(exhaustedReturn).toBeLessThan(cooldownReturn);
    expect(cooldownReturn).toBeLessThan(attemptsWrite);
    expect(attemptsWrite).toBeLessThan(incorrectReturn);
    expect(incorrectReturn).toBeLessThan(answerWrite);
    expect(answerWrite).toBeLessThan(pointsIncr);
    expect(pointsIncr).toBeLessThan(answeredIncr);
  });

  it("anchors the attempts/lastAtMs/points pattern matches to a complete field (not an arbitrary digit run earlier in the blob)", async () => {
    gateReads(null, null);
    mocks.upstashEval.mockResolvedValueOnce(["correct", "20"]);
    await answerQuestion("octocat", "q1", ["a"]);
    const [script] = mocks.upstashEval.mock.calls[0] as [string, string[], (string | number)[]];
    expect(script).toContain(`'"attempts":(%d+)[,}]'`);
    expect(script).toContain(`'"lastAtMs":(%d+)[,}]'`);
    expect(script).toContain(`'"points":(%-?%d+)[,}]'`);
  });
});

describe("authoritative cap/cooldown enforcement (the script, not just the JS pre-check)", () => {
  it("passes the CURRENT maxAttempts, cooldown (as a duration in ms), and now (epoch ms) into the script as ARGV, alongside the pre-check", async () => {
    mocks.getAdminSettings.mockResolvedValue(settings({ quizMaxAttempts: 3, quizRetryAfterMin: 5 }));
    gateReads(null, null);
    mocks.upstashEval.mockResolvedValueOnce(["correct", "20"]);
    const before = Date.now();
    await answerQuestion("octocat", "q1", ["a"]);
    const after = Date.now();
    const [, , args] = mocks.upstashEval.mock.calls[0];
    expect(args[4]).toBe(3); // maxAttempts
    expect(args[5]).toBe(5 * 60_000); // cooldown as a duration, not a stored cutoff
    expect(Number(args[6])).toBeGreaterThanOrEqual(before);
    expect(Number(args[6])).toBeLessThanOrEqual(after);
  });

  it("falls back to the baked defaults for the script's ARGV when no admin override is set", async () => {
    gateReads(null, null);
    mocks.upstashEval.mockResolvedValueOnce(["correct", "20"]);
    await answerQuestion("octocat", "q1", ["a"]);
    const [, , args] = mocks.upstashEval.mock.calls[0];
    expect(args[4]).toBe(QUIZ_MAX_ATTEMPTS);
    expect(args[5]).toBe(QUIZ_RETRY_AFTER_MIN * 60_000);
  });

  it("maps the script's authoritative 'exhausted' verdict onto the same AnswerResult shape as the pre-check's — this is what closes the parallel-submission race the pre-check alone cannot", async () => {
    // The pre-check (gateReads) sees 0 attempts spent and allows — simulating
    // N requests racing in with the same stale "0 attempts" read — but the
    // script (which re-reads fresh, one at a time) has already seen enough
    // OTHER concurrent submissions land to know the cap is now spent.
    gateReads(null, null);
    mocks.upstashEval.mockResolvedValueOnce(["exhausted"]);
    const result = await answerQuestion("octocat", "q1", ["a"]);
    expect(result).toEqual({ ok: false, reason: "exhausted" });
  });

  it("maps the script's authoritative 'cooldown' verdict onto retryAt, derived from the script's own fresh read", async () => {
    gateReads(null, null);
    const retryAtMs = Date.now() + 3 * 60_000;
    mocks.upstashEval.mockResolvedValueOnce(["cooldown", String(retryAtMs)]);
    const result = await answerQuestion("octocat", "q1", ["a"]);
    expect(result).toEqual({ ok: false, reason: "cooldown", retryAt: new Date(retryAtMs).toISOString() });
  });
});

describe("canonicalization identity (upsertQuestion's stored key vs. answerQuestion's submission)", () => {
  it("stores and submits byte-identical JSON for the same set, regardless of input order or duplicates — the whole string-compare-as-set-compare design depends on this", async () => {
    // upsertQuestion: correct ids given out of order, with a duplicate.
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: "OK" }, { result: "OK" }]);
    await upsertQuestion(
      {
        id: "q1",
        prompt: "?",
        type: "multi",
        choices: [
          { id: "a", label: "A" },
          { id: "c", label: "C" },
        ],
        points: 20,
        order: 1,
      },
      ["c", "a", "a"],
    );
    const upsertCmds = mocks.upstashPipeline.mock.calls[0][0] as string[][];
    const storedKey = upsertCmds.find((c) => c[1] === "ctf:quiz:key")![3];

    // answerQuestion: same set submitted in yet another order, also with a
    // duplicate.
    gateReads(null, null);
    mocks.upstashEval.mockResolvedValueOnce(["correct", "20"]);
    await answerQuestion("octocat", "q1", ["a", "c", "a"]);
    const [, , args] = mocks.upstashEval.mock.calls[0];
    const submitted = args[1];

    expect(storedKey).toBe(submitted);
    expect(storedKey).toBe(JSON.stringify(["a", "c"]));
  });
});

describe("quizGate", () => {
  it("refuses a question already answered correctly, without spending an attempt", async () => {
    gateReads(answeredRow(20, "2026-01-01T00:00:00.000Z"), null);
    expect(await quizGate("octocat", "q1")).toEqual({ allowed: false, reason: "answered" });
  });

  it("refuses once attempts are exhausted", async () => {
    mocks.getAdminSettings.mockResolvedValue(settings({ quizMaxAttempts: 3 }));
    gateReads(null, attemptRow(3, "2026-01-01T00:00:00.000Z"));
    expect(await quizGate("octocat", "q1")).toEqual({ allowed: false, reason: "exhausted", attemptsLeft: 0 });
  });

  it("refuses inside the cooldown and reports retryAt", async () => {
    mocks.getAdminSettings.mockResolvedValue(settings({ quizMaxAttempts: 3, quizRetryAfterMin: 5 }));
    const lastAt = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    gateReads(null, attemptRow(1, lastAt));
    const gate = await quizGate("octocat", "q1");
    expect(gate).toEqual({
      allowed: false,
      reason: "cooldown",
      retryAt: new Date(Date.parse(lastAt) + 5 * 60_000).toISOString(),
    });
  });

  it("derives lockedUntil from the CURRENT cooldown setting, not a stored one", async () => {
    const lastAt = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago, unchanged
    // First: 5-minute cooldown still active.
    mocks.getAdminSettings.mockResolvedValue(settings({ quizMaxAttempts: 3, quizRetryAfterMin: 5 }));
    gateReads(null, attemptRow(1, lastAt));
    expect(await quizGate("octocat", "q1")).toMatchObject({ allowed: false, reason: "cooldown" });

    // Same lastAt, but the organizer lowers the cooldown to 1 minute — since
    // lockedUntil is derived at read time (lastAt + current setting), the
    // lock lifts immediately with no stored value to reconcile.
    mocks.getAdminSettings.mockResolvedValue(settings({ quizMaxAttempts: 3, quizRetryAfterMin: 1 }));
    gateReads(null, attemptRow(1, lastAt));
    expect(await quizGate("octocat", "q1")).toEqual({ allowed: true });
  });

  it("refuses while scoring is paused, before ever looking up attempts", async () => {
    mocks.getAdminSettings.mockResolvedValue(settings({ paused: true }));
    expect(await quizGate("octocat", "q1")).toEqual({ allowed: false, reason: "paused" });
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it("fails CLOSED when the attempt lookup errors, with its OWN reason distinct from exhausted", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.upstashPipeline.mockRejectedValueOnce(new Error("upstash down"));
    const gate = await quizGate("octocat", "q1");
    // Must be refused, but NOT misreported as "exhausted" — a contestant
    // with zero attempts spent must never be told they have none left just
    // because the lookup that would prove otherwise blew up.
    expect(gate).toEqual({ allowed: false, reason: "unavailable" });
    consoleError.mockRestore();
  });

  it("falls back to the baked defaults when no admin override is set", async () => {
    expect(QUIZ_MAX_ATTEMPTS).toBe(3);
    expect(QUIZ_RETRY_AFTER_MIN).toBe(5);
    gateReads(null, attemptRow(3, new Date().toISOString()));
    expect(await quizGate("octocat", "q1")).toMatchObject({ allowed: false, reason: "exhausted" });
  });

  it("allows a fresh question with no prior attempts", async () => {
    gateReads(null, null);
    expect(await quizGate("octocat", "q1")).toEqual({ allowed: true });
  });
});

describe("answerQuestion refusals", () => {
  it("never reaches the grading script when the gate refuses (paused)", async () => {
    mocks.getAdminSettings.mockResolvedValue(settings({ paused: true }));
    const result = await answerQuestion("octocat", "q1", ["a"]);
    expect(result).toEqual({ ok: false, reason: "paused" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("never reaches the grading script when already answered", async () => {
    gateReads(answeredRow(20, "2026-01-01T00:00:00.000Z"), null);
    const result = await answerQuestion("octocat", "q1", ["a"]);
    expect(result).toEqual({ ok: false, reason: "answered" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("never reaches the grading script when attempts are exhausted", async () => {
    mocks.getAdminSettings.mockResolvedValue(settings({ quizMaxAttempts: 3 }));
    gateReads(null, attemptRow(3, "2026-01-01T00:00:00.000Z"));
    const result = await answerQuestion("octocat", "q1", ["a"]);
    expect(result).toEqual({ ok: false, reason: "exhausted" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("never reaches the grading script when inside the cooldown, and surfaces retryAt", async () => {
    mocks.getAdminSettings.mockResolvedValue(settings({ quizMaxAttempts: 3, quizRetryAfterMin: 5 }));
    const lastAt = new Date(Date.now() - 60_000).toISOString();
    gateReads(null, attemptRow(1, lastAt));
    const result = await answerQuestion("octocat", "q1", ["a"]);
    expect(result).toEqual({
      ok: false,
      reason: "cooldown",
      retryAt: new Date(Date.parse(lastAt) + 5 * 60_000).toISOString(),
    });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("fails CLOSED (refuses) when the gate's lookup errors, reports 'unavailable' (not 'exhausted'), and never reaches the grading script", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.upstashPipeline.mockRejectedValueOnce(new Error("upstash down"));
    const result = await answerQuestion("octocat", "q1", ["a"]);
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("rejects a malformed question id before touching Upstash", async () => {
    const result = await answerQuestion("octocat", "bad id", ["a"]);
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("rejects an empty choice set before touching Upstash", async () => {
    const result = await answerQuestion("octocat", "q1", []);
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it("reports a missing/deleted question without spending an attempt row", async () => {
    gateReads(null, null);
    mocks.upstashEval.mockResolvedValueOnce(["missing"]);
    const result = await answerQuestion("octocat", "ghost-question", ["a"]);
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("degrades to a friendly error when the grading script itself fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    gateReads(null, null);
    mocks.upstashEval.mockRejectedValueOnce(new Error("upstash down"));
    const result = await answerQuestion("octocat", "q1", ["a"]);
    expect(result).toEqual({ ok: false, reason: "error" });
    consoleError.mockRestore();
  });
});
