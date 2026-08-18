// Unit tests for the quiz store — most importantly that the answer key
// (`ctf:quiz:key`) never reaches a caller that only asked for questions, and
// that the key always stores a sorted array regardless of question type.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upstashEval: vi.fn(), upstashPipeline: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({ upstashEval: mocks.upstashEval, upstashPipeline: mocks.upstashPipeline }));

import { deleteQuestion, getViewerQuiz, listQuestions, upsertQuestion } from "@/lib/quiz-store";

beforeEach(() => {
  mocks.upstashPipeline.mockReset();
  mocks.upstashEval.mockReset();
});

describe("listQuestions", () => {
  it("lists questions by order and never leaks the answer key", async () => {
    mocks.upstashPipeline.mockResolvedValue([
      {
        result: [
          "q2",
          JSON.stringify({ id: "q2", prompt: "B?", type: "single", choices: [{ id: "a", label: "A" }], points: 5, order: 2 }),
          "q1",
          JSON.stringify({ id: "q1", prompt: "A?", type: "multi", choices: [{ id: "a", label: "A" }], points: 10, order: 1 }),
        ],
      },
    ]);
    const qs = await listQuestions();
    expect(qs.map((q) => q.id)).toEqual(["q1", "q2"]);
    // The command list must never read the key hash.
    const cmds = JSON.stringify(mocks.upstashPipeline.mock.calls[0][0]);
    expect(cmds).not.toContain("ctf:quiz:key");
    expect(JSON.stringify(qs)).not.toMatch(/correct/i);
  });

  it("falls back to id order when order ties", async () => {
    mocks.upstashPipeline.mockResolvedValue([
      {
        result: [
          "qb",
          JSON.stringify({ id: "qb", prompt: "?", type: "single", choices: [{ id: "a", label: "A" }], points: 5, order: 1 }),
          "qa",
          JSON.stringify({ id: "qa", prompt: "?", type: "single", choices: [{ id: "a", label: "A" }], points: 5, order: 1 }),
        ],
      },
    ]);
    const qs = await listQuestions();
    expect(qs.map((q) => q.id)).toEqual(["qa", "qb"]);
  });

  it("drops unparseable rows instead of throwing", async () => {
    mocks.upstashPipeline.mockResolvedValue([
      {
        result: [
          "q1",
          JSON.stringify({ id: "q1", prompt: "A?", type: "single", choices: [{ id: "a", label: "A" }], points: 5, order: 1 }),
          "bad",
          "not json",
        ],
      },
    ]);
    const qs = await listQuestions();
    expect(qs.map((q) => q.id)).toEqual(["q1"]);
  });

  it("returns an empty list when the hash is empty", async () => {
    mocks.upstashPipeline.mockResolvedValue([{ result: [] }]);
    expect(await listQuestions()).toEqual([]);
  });
});

describe("upsertQuestion", () => {
  it("stores the correct set sorted, in the key hash, separate from the question", async () => {
    mocks.upstashPipeline.mockResolvedValue([{ result: "OK" }, { result: "OK" }]);
    await upsertQuestion(
      {
        id: "q1",
        prompt: "Which are injection flaws?",
        type: "multi",
        choices: [
          { id: "a", label: "SQLi" },
          { id: "b", label: "XSS" },
          { id: "c", label: "LDAP" },
        ],
        points: 20,
        order: 1,
      },
      ["c", "a"],
    );
    const cmds = mocks.upstashPipeline.mock.calls[0][0] as string[][];
    const keyCmd = cmds.find((c) => c[1] === "ctf:quiz:key")!;
    expect(JSON.parse(keyCmd[3])).toEqual(["a", "c"]); // sorted
    const qCmd = cmds.find((c) => c[1] === "ctf:quiz:questions")!;
    expect(qCmd[3]).not.toContain('"a","c"'); // the question record carries no answer
    expect(qCmd[3]).not.toMatch(/correct/i);
  });

  it("stores a single-element sorted array for a single-choice question", async () => {
    mocks.upstashPipeline.mockResolvedValue([{ result: "OK" }, { result: "OK" }]);
    await upsertQuestion(
      {
        id: "q2",
        prompt: "Pick one",
        type: "single",
        choices: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        points: 5,
        order: 2,
      },
      ["b"],
    );
    const cmds = mocks.upstashPipeline.mock.calls[0][0] as string[][];
    const keyCmd = cmds.find((c) => c[1] === "ctf:quiz:key")!;
    expect(JSON.parse(keyCmd[3])).toEqual(["b"]);
  });

  it("writes both hashes in a single pipeline call", async () => {
    mocks.upstashPipeline.mockResolvedValue([{ result: "OK" }, { result: "OK" }]);
    await upsertQuestion(
      { id: "q1", prompt: "?", type: "single", choices: [{ id: "a", label: "A" }], points: 5, order: 1 },
      ["a"],
    );
    expect(mocks.upstashPipeline).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed question id before touching Upstash", async () => {
    await expect(
      upsertQuestion(
        { id: "bad/id", prompt: "?", type: "single", choices: [{ id: "a", label: "A" }], points: 5, order: 1 },
        ["a"],
      ),
    ).rejects.toThrow(/invalid question id/i);
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it("rejects a malformed choice id before touching Upstash", async () => {
    await expect(
      upsertQuestion(
        { id: "q1", prompt: "?", type: "single", choices: [{ id: "bad id", label: "A" }], points: 5, order: 1 },
        ["bad id"],
      ),
    ).rejects.toThrow(/invalid choice id/i);
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it("rejects a correct id that isn't among the question's choices", async () => {
    await expect(
      upsertQuestion(
        { id: "q1", prompt: "?", type: "single", choices: [{ id: "a", label: "A" }], points: 5, order: 1 },
        ["z"],
      ),
    ).rejects.toThrow(/not among choices/i);
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it("rejects non-integer points before touching Upstash", async () => {
    await expect(
      upsertQuestion(
        { id: "q1", prompt: "?", type: "single", choices: [{ id: "a", label: "A" }], points: 5.5, order: 1 },
        ["a"],
      ),
    ).rejects.toThrow(/points must be a non-negative integer/i);
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it("rejects negative points before touching Upstash", async () => {
    await expect(
      upsertQuestion(
        { id: "q1", prompt: "?", type: "single", choices: [{ id: "a", label: "A" }], points: -5, order: 1 },
        ["a"],
      ),
    ).rejects.toThrow(/points must be a non-negative integer/i);
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it('rejects a "single" question with more than one correct choice', async () => {
    await expect(
      upsertQuestion(
        {
          id: "q1",
          prompt: "?",
          type: "single",
          choices: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
          points: 5,
          order: 1,
        },
        ["a", "b"],
      ),
    ).rejects.toThrow(/"single" question must have exactly one correct choice/i);
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it('rejects a "single" question whose two correct entries dedupe down to one (still not what "exactly one" means going in)', async () => {
    // Deduping ["a","a"] down to one unique id is fine on its own (see the
    // dedupe test below) — this checks the OTHER direction: two genuinely
    // different ids on a "single" question must still be rejected even
    // though dedup doesn't collapse them.
    await expect(
      upsertQuestion(
        {
          id: "q1",
          prompt: "?",
          type: "single",
          choices: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
            { id: "c", label: "C" },
          ],
          points: 5,
          order: 1,
        },
        ["a", "b", "c"],
      ),
    ).rejects.toThrow(/"single" question must have exactly one correct choice/i);
  });

  it("dedupes the correct set before storing it, so a duplicate id can't create an unanswerable question", async () => {
    mocks.upstashPipeline.mockResolvedValue([{ result: "OK" }, { result: "OK" }]);
    await upsertQuestion(
      {
        id: "q1",
        prompt: "?",
        type: "multi",
        choices: [
          { id: "a", label: "A" },
          { id: "c", label: "C" },
        ],
        points: 5,
        order: 1,
      },
      ["a", "a", "c"],
    );
    const cmds = mocks.upstashPipeline.mock.calls[0][0] as string[][];
    const keyCmd = cmds.find((c) => c[1] === "ctf:quiz:key")!;
    expect(JSON.parse(keyCmd[3])).toEqual(["a", "c"]);
  });
});

describe("deleteQuestion", () => {
  it("deletes from both the questions hash and the key hash", async () => {
    mocks.upstashPipeline.mockResolvedValue([{ result: 1 }, { result: 1 }]);
    await deleteQuestion("q1");
    const cmds = mocks.upstashPipeline.mock.calls[0][0] as string[][];
    expect(cmds).toEqual([
      ["HDEL", "ctf:quiz:questions", "q1"],
      ["HDEL", "ctf:quiz:key", "q1"],
    ]);
  });

  it("rejects a malformed id before touching Upstash", async () => {
    await expect(deleteQuestion("../etc")).rejects.toThrow(/invalid question id/i);
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });
});

describe("getViewerQuiz", () => {
  it("reads only the caller's per-login hashes, never the key hash", async () => {
    mocks.upstashPipeline.mockResolvedValue([
      { result: ["q1", JSON.stringify({ choices: ["a"], points: 10, at: "2026-01-01T00:00:00.000Z" })] },
      { result: ["q1", JSON.stringify({ attempts: 2, lastAt: "2026-01-01T00:00:00.000Z" })] },
    ]);
    const progress = await getViewerQuiz("octocat");
    expect(progress).toEqual({
      answered: { q1: { points: 10, at: "2026-01-01T00:00:00.000Z" } },
      attempts: { q1: { attempts: 2, lastAt: "2026-01-01T00:00:00.000Z" } },
    });
    const cmds = mocks.upstashPipeline.mock.calls[0][0] as string[][];
    expect(cmds).toEqual([
      ["HGETALL", "ctf:quiz:answers:octocat"],
      ["HGETALL", "ctf:quiz:attempts:octocat"],
    ]);
  });

  it("returns empty records when both hashes are empty", async () => {
    mocks.upstashPipeline.mockResolvedValue([{ result: [] }, { result: [] }]);
    expect(await getViewerQuiz("octocat")).toEqual({ answered: {}, attempts: {} });
  });

  it("drops unparseable or malformed rows instead of throwing", async () => {
    mocks.upstashPipeline.mockResolvedValue([
      { result: ["q1", "not json", "q2", JSON.stringify({ points: 5, at: "x" })] },
      { result: ["q1", JSON.stringify({ attempts: "nope" })] },
    ]);
    const progress = await getViewerQuiz("octocat");
    expect(progress).toEqual({ answered: { q2: { points: 5, at: "x" } }, attempts: {} });
  });
});
