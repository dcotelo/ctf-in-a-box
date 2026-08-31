// Grading for both ai solve paths. Needs a PARTIAL @/lib/admin-store mock
// (real `effectivePaused`, mocked `getAdminSettings`), which is why it is not
// in ai-store.test.ts.
//
// ANTI-VACUOUS: every refusal below is paired with the accepting case built
// from the same fixture — a refusal test whose fixture never worked proves
// nothing about the refusal.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upstashEval: vi.fn(),
  upstashPipeline: vi.fn(),
  getAdminSettings: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({ upstashEval: mocks.upstashEval, upstashPipeline: mocks.upstashPipeline }));
vi.mock("@/lib/admin-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin-store")>()),
  getAdminSettings: mocks.getAdminSettings,
}));

import { awardAiEvent, submitAiFlag } from "@/lib/ai-store";

/** The settings object `effectivePaused` (real, not mocked) reads. Every field
 *  it looks at must be present, or a missing key reads as a different event
 *  state than the test intends. */
type SettingsOverride = Partial<{ paused: boolean; scoringStartsAt: string | null; scoringEndsAt: string | null }>;
const settings = (over: SettingsOverride = {}) =>
  ({ paused: false, scoringStartsAt: null, scoringEndsAt: null, ...over }) as never;

/** No prior solve, no prior attempt — the gate's own pre-check reads. */
function cleanGateReply() {
  mocks.upstashPipeline.mockResolvedValueOnce([{ result: null }, { result: null }]);
}

beforeEach(() => {
  mocks.upstashEval.mockReset();
  mocks.upstashPipeline.mockReset();
  mocks.getAdminSettings.mockReset();
  mocks.getAdminSettings.mockResolvedValue(settings());
});

describe("submitAiFlag", () => {
  it("awards a correct flag", async () => {
    cleanGateReply();
    mocks.upstashEval.mockResolvedValueOnce(["correct", "300"]);

    expect(await submitAiFlag("alice", "prompt-leak-ab12cd", " CTF{leak} ")).toEqual({
      ok: true,
      correct: true,
      points: 300,
    });
  });

  it("hands BOTH comparison forms to the script and normalizes in JS, never Lua", async () => {
    cleanGateReply();
    mocks.upstashEval.mockResolvedValueOnce(["incorrect", "1"]);

    await submitAiFlag("alice", "prompt-leak-ab12cd", " CTF{Leak} ");

    const [, , argv] = mocks.upstashEval.mock.calls[0] as [string, string[], (string | number)[]];
    expect(argv[1]).toBe("ctf{leak}");   // case-insensitive form
    expect(argv[6]).toBe("CTF{Leak}");   // case-preserved form
    expect(argv[7]).toBe("1");           // grade = yes
    expect(argv[8]).toBe("flag");        // solve source
  });

  it("reports a wrong flag without awarding", async () => {
    cleanGateReply();
    mocks.upstashEval.mockResolvedValueOnce(["incorrect", "2"]);
    expect(await submitAiFlag("alice", "prompt-leak-ab12cd", "nope")).toEqual({ ok: true, correct: false });
  });

  it("returns already for an idempotent resubmission", async () => {
    cleanGateReply();
    mocks.upstashEval.mockResolvedValueOnce(["already"]);
    expect(await submitAiFlag("alice", "prompt-leak-ab12cd", "CTF{leak}")).toEqual({
      ok: true,
      correct: true,
      points: 0,
      already: true,
    });
  });

  it("refuses while the event is paused, without touching Redis", async () => {
    mocks.getAdminSettings.mockResolvedValue(settings({ paused: true }));
    expect(await submitAiFlag("alice", "prompt-leak-ab12cd", "CTF{leak}")).toEqual({
      ok: false,
      reason: "paused",
    });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("treats scoring as LIVE when the settings read fails — fail open", async () => {
    mocks.getAdminSettings.mockRejectedValue(new Error("redis down"));
    cleanGateReply();
    mocks.upstashEval.mockResolvedValueOnce(["correct", "300"]);
    expect(await submitAiFlag("alice", "prompt-leak-ab12cd", "CTF{leak}")).toEqual({
      ok: true,
      correct: true,
      points: 300,
    });
  });

  it("fails CLOSED with its own reason when the solve/attempt lookup fails", async () => {
    mocks.upstashPipeline.mockRejectedValueOnce(new Error("redis down"));
    expect(await submitAiFlag("alice", "prompt-leak-ab12cd", "CTF{leak}")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("surfaces the script's cooldown verdict with a retryAt", async () => {
    cleanGateReply();
    mocks.upstashEval.mockResolvedValueOnce(["cooldown", "1756636805000"]);
    expect(await submitAiFlag("alice", "prompt-leak-ab12cd", "CTF{leak}")).toEqual({
      ok: false,
      reason: "cooldown",
      retryAt: new Date(1_756_636_805_000).toISOString(),
    });
  });

  it("rejects a malformed id or empty flag before any Redis call", async () => {
    expect(await submitAiFlag("alice", "bad id!", "CTF{leak}")).toEqual({ ok: false, reason: "invalid" });
    expect(await submitAiFlag("alice", "prompt-leak-ab12cd", "   ")).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });
});

describe("awardAiEvent", () => {
  it("awards without a flag and marks the solve as event-sourced", async () => {
    cleanGateReply();
    mocks.upstashEval.mockResolvedValueOnce(["correct", "400"]);

    expect(await awardAiEvent("alice", "guardrail-cd34ef")).toEqual({ ok: true, correct: true, points: 400 });

    const [, , argv] = mocks.upstashEval.mock.calls[0] as [string, string[], (string | number)[]];
    expect(argv[7]).toBe("0");      // grade = no
    expect(argv[8]).toBe("event");  // solve source
  });

  it("is idempotent for a repeated event", async () => {
    cleanGateReply();
    mocks.upstashEval.mockResolvedValueOnce(["already"]);
    expect(await awardAiEvent("alice", "guardrail-cd34ef")).toEqual({
      ok: true,
      correct: true,
      points: 0,
      already: true,
    });
  });

  it("dryRun runs every gate and writes NOTHING", async () => {
    cleanGateReply();
    expect(await awardAiEvent("alice", "guardrail-cd34ef", { dryRun: true })).toEqual({
      ok: true,
      correct: true,
      points: 0,
      dryRun: true,
    });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("dryRun still reports a refusal — paused", async () => {
    mocks.getAdminSettings.mockResolvedValue(settings({ paused: true }));
    expect(await awardAiEvent("alice", "guardrail-cd34ef", { dryRun: true })).toEqual({
      ok: false,
      reason: "paused",
    });
  });

  it("dryRun reports an already-solved challenge without writing", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([
      { result: JSON.stringify({ points: 400, at: "2026-08-31T11:00:00.000Z" }) },
      { result: null },
    ]);
    expect(await awardAiEvent("alice", "guardrail-cd34ef", { dryRun: true })).toEqual({
      ok: false,
      reason: "solved",
    });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });
});
