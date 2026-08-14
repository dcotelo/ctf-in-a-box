// Unit tests for the challenges-gate throttle. Three things matter here: the
// lock math (5 attempts, 24h window, an expired window starts over), that the
// budget is charged atomically through a single Lua EVAL rather than a
// read-then-write, and that a concurrent burst cannot buy more than the
// budget allows. Upstash is mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upstashEval: vi.fn<(script: string, keys: string[], args: (string | number)[]) => Promise<unknown>>(),
  upstashPipeline: vi.fn<(commands: (string | number)[][]) => Promise<{ result?: unknown; error?: string }[]>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({
  upstashEval: mocks.upstashEval,
  upstashPipeline: mocks.upstashPipeline,
}));

import {
  GATE_LOCK_MS,
  GATE_MAX_FAILURES,
  GATE_TTL_SECONDS,
  clearGateThrottle,
  consumeGateAttempt,
  gateLockRemainingSeconds,
  getGateThrottle,
} from "@/lib/gate-store";

const NOW = 1_800_000_000_000;
const IP = "203.0.113.9";
const KEY = `gate:attempts:${IP}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getGateThrottle", () => {
  it("reads the IP's throttle fields via HMGET", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: ["3", String(NOW)] }]);
    expect(await getGateThrottle(IP)).toEqual({ failures: 3, lastFailAt: NOW });
    expect(mocks.upstashPipeline).toHaveBeenCalledWith([["HMGET", KEY, "failures", "lastFailAt"]]);
  });

  it("returns null for an unseen IP and throws on transport errors (caller fails closed)", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: [null, null] }]);
    expect(await getGateThrottle(IP)).toBeNull();
    mocks.upstashPipeline.mockRejectedValueOnce(new Error("upstash down"));
    await expect(getGateThrottle(IP)).rejects.toThrow("upstash down");
  });
});

describe("gateLockRemainingSeconds", () => {
  it("locks only at the failure cap", () => {
    expect(gateLockRemainingSeconds(null, NOW)).toBe(0);
    expect(gateLockRemainingSeconds({ failures: GATE_MAX_FAILURES - 1, lastFailAt: NOW }, NOW)).toBe(0);
    expect(gateLockRemainingSeconds({ failures: GATE_MAX_FAILURES, lastFailAt: NOW }, NOW)).toBe(GATE_LOCK_MS / 1000);
  });

  it("lifts after the 24h window passes", () => {
    const stale = { failures: GATE_MAX_FAILURES, lastFailAt: NOW - GATE_LOCK_MS };
    expect(gateLockRemainingSeconds(stale, NOW)).toBe(0);
    const nearlyOver = { failures: GATE_MAX_FAILURES, lastFailAt: NOW - GATE_LOCK_MS + 1000 };
    expect(gateLockRemainingSeconds(nearlyOver, NOW)).toBe(1);
  });
});

describe("GATE_TTL_SECONDS", () => {
  it("is 30 days, and strictly longer than the lock window so a lock can never outlive its key", () => {
    expect(GATE_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(GATE_TTL_SECONDS * 1000).toBeGreaterThan(GATE_LOCK_MS);
  });
});

describe("consumeGateAttempt", () => {
  it("starts a fresh counter for an unseen IP", async () => {
    mocks.upstashEval.mockResolvedValueOnce([1, 1, NOW]);
    expect(await consumeGateAttempt(IP, NOW)).toEqual({ allowed: true });

    const [script, keys, args] = mocks.upstashEval.mock.calls[0];
    expect(keys).toEqual([KEY]);
    expect(args).toEqual([NOW, NOW - GATE_LOCK_MS, GATE_MAX_FAILURES, GATE_TTL_SECONDS]);
    // The whole point: one EVAL, not a read followed by a separate write.
    expect(mocks.upstashEval).toHaveBeenCalledTimes(1);
    expect(script).toContain("HSET");
    expect(script).toContain("EXPIRE");
  });

  it("puts the restart boundary exactly one lock window behind now", async () => {
    mocks.upstashEval.mockResolvedValueOnce([1, 1, NOW]);
    await consumeGateAttempt(IP, NOW);
    const [, , args] = mocks.upstashEval.mock.calls[0];
    expect(args[1]).toBe(NOW - GATE_LOCK_MS);
  });

  it("increments inside a live window, guarded by the cap", async () => {
    mocks.upstashEval.mockResolvedValueOnce([1, 3, NOW]);
    expect(await consumeGateAttempt(IP, NOW)).toEqual({ allowed: true });
  });

  it("refuses at the cap and reports the remaining lock time", async () => {
    mocks.upstashEval.mockResolvedValueOnce([0, GATE_MAX_FAILURES, NOW]);
    expect(await consumeGateAttempt(IP, NOW)).toEqual({
      allowed: false,
      retryAfterSeconds: GATE_LOCK_MS / 1000,
    });
  });

  it("never reports Retry-After: 0 even at the window's edge", async () => {
    // The script only denies inside a live window, so the remaining time is
    // always > 0 in practice — this clamp guards the arithmetic regardless.
    mocks.upstashEval.mockResolvedValueOnce([0, GATE_MAX_FAILURES, NOW - GATE_LOCK_MS + 1]);
    const verdict = await consumeGateAttempt(IP, NOW);
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("rethrows transport errors so the caller fails closed", async () => {
    mocks.upstashEval.mockRejectedValueOnce(new Error("upstash down"));
    await expect(consumeGateAttempt(IP, NOW)).rejects.toThrow("upstash down");
  });

  // The finding this whole redesign exists for. A stateful fake enforces
  // Redis's single-threaded script execution; the assertion is on how many
  // callers were cleared to reach the password compare.
  it("caps a concurrent burst at the budget instead of letting all of it through", async () => {
    let failures = 0;
    let lastFailAt = 0;

    mocks.upstashEval.mockImplementation(async (_script, _keys, args) => {
      const [now, windowStart, max] = args as [number, number, number];
      if (lastFailAt <= windowStart) failures = 0;
      if (failures >= max) return [0, failures, lastFailAt];
      failures += 1;
      lastFailAt = now;
      return [1, failures, now];
    });

    const verdicts = await Promise.all(
      Array.from({ length: 50 }, () => consumeGateAttempt(IP, NOW)),
    );

    const allowed = verdicts.filter((v) => v.allowed).length;
    expect(allowed).toBe(GATE_MAX_FAILURES);
    expect(verdicts).toHaveLength(50);
    expect(failures).toBe(GATE_MAX_FAILURES);
  });
});

describe("clearGateThrottle", () => {
  it("deletes the throttle key", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: 1 }]);
    expect(await clearGateThrottle(IP)).toBe(true);
    expect(mocks.upstashPipeline).toHaveBeenCalledWith([["DEL", KEY]]);
  });

  it("retries once, because a lost refund strands a caller at the cap", async () => {
    mocks.upstashPipeline.mockRejectedValueOnce(new Error("throttled")).mockResolvedValueOnce([{ result: 1 }]);
    expect(await clearGateThrottle(IP)).toBe(true);
    expect(mocks.upstashPipeline).toHaveBeenCalledTimes(2);
  });

  it("reports failure without throwing, so the unlock cookie still ships", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.upstashPipeline.mockRejectedValue(new Error("boom"));
    await expect(clearGateThrottle(IP)).resolves.toBe(false);
    expect(mocks.upstashPipeline).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});
