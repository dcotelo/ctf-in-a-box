// Unit tests for the challenges-gate crypto and flag: the unlock cookie must
// be unforgeable and expiring, and the gate must stay OPEN when it is only
// half-configured (flag without password, or no signing secret).

import { afterEach, describe, expect, it, vi } from "vitest";

type Gate = typeof import("@/lib/gate");

/** Everything is read at module load, so each test re-imports with the env it
 *  needs. Defaults describe a fully configured, enabled gate. */
async function loadGate(env: Record<string, string> = {}): Promise<Gate> {
  vi.resetModules();
  vi.stubEnv("CHALLENGES_GATE_ENABLED", env.CHALLENGES_GATE_ENABLED ?? "true");
  vi.stubEnv("CHALLENGES_GATE_PASSWORD", env.CHALLENGES_GATE_PASSWORD ?? "hunter2");
  vi.stubEnv("BETTER_AUTH_SECRET", env.BETTER_AUTH_SECRET ?? "test-secret");
  return import("@/lib/gate");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isGateActive", () => {
  it("is active only when the flag, password, and secret are all present", async () => {
    expect((await loadGate()).isGateActive()).toBe(true);
    expect((await loadGate({ CHALLENGES_GATE_ENABLED: "" })).isGateActive()).toBe(false);
    expect((await loadGate({ CHALLENGES_GATE_ENABLED: "false" })).isGateActive()).toBe(false);
    expect((await loadGate({ CHALLENGES_GATE_PASSWORD: "" })).isGateActive()).toBe(false);
    expect((await loadGate({ BETTER_AUTH_SECRET: "" })).isGateActive()).toBe(false);
  });
});

describe("gate cookie", () => {
  it("round-trips a signed, unexpired cookie", async () => {
    const gate = await loadGate();
    const value = gate.signGateCookie(Date.now() + 60_000);
    expect(value.startsWith("v1.")).toBe(true);
    expect(gate.verifyGateCookie(value)).toBe(true);
  });

  it("rejects a tampered signature and a tampered expiry", async () => {
    const gate = await loadGate();
    const value = gate.signGateCookie(Date.now() + 60_000);
    const [v, exp, sig] = value.split(".");
    const flipped = sig!.endsWith("0") ? "1" : "0";
    expect(gate.verifyGateCookie(`${v}.${exp}.${sig!.slice(0, -1)}${flipped}`)).toBe(false);
    expect(gate.verifyGateCookie(`${v}.${Number(exp) + 1}.${sig}`)).toBe(false);
  });

  it("rejects a cookie signed with a different secret", async () => {
    const other = await loadGate({ BETTER_AUTH_SECRET: "other-secret" });
    const foreign = other.signGateCookie(Date.now() + 60_000);
    const gate = await loadGate();
    expect(gate.verifyGateCookie(foreign)).toBe(false);
  });

  it("rejects expired and malformed values", async () => {
    const gate = await loadGate();
    expect(gate.verifyGateCookie(gate.signGateCookie(Date.now() - 1))).toBe(false);
    expect(gate.verifyGateCookie(undefined)).toBe(false);
    expect(gate.verifyGateCookie("")).toBe(false);
    expect(gate.verifyGateCookie("v2.123.deadbeef")).toBe(false);
    expect(gate.verifyGateCookie("v1.not-a-number.deadbeef")).toBe(false);
    expect(gate.verifyGateCookie("v1.123")).toBe(false);
  });
});

describe("verifyGatePassword", () => {
  it("accepts the configured password and rejects everything else", async () => {
    const gate = await loadGate();
    expect(gate.verifyGatePassword("hunter2")).toBe(true);
    expect(gate.verifyGatePassword("hunter3")).toBe(false);
    expect(gate.verifyGatePassword("a-much-longer-guess-than-the-password")).toBe(false);
    expect(gate.verifyGatePassword("")).toBe(false);
  });

  it("never accepts when no password is configured", async () => {
    const gate = await loadGate({ CHALLENGES_GATE_PASSWORD: "" });
    expect(gate.verifyGatePassword("")).toBe(false);
  });
});
