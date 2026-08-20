// Unit tests for requireGatePassed — the module-API pre-event gate check
// used by quiz/answer, classic/submit, and hints/reveal (see
// docs/modules.md §5.8). It delegates to @/lib/gate's isGateActive() and
// verifyGateCookie() (both real here, not mocked) and reads the incoming
// cookie via next/headers' cookies() (mocked, since there's no live Next.js
// request scope in a unit test). Neither isGateActive() nor verifyGateCookie
// does I/O, so there is no fail-open/fail-closed case to test here, unlike
// the store-backed gates a route also runs.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const cookieMocks = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieMocks.cookieJar.has(name) ? { name, value: cookieMocks.cookieJar.get(name) } : undefined,
  }),
}));

type GateRequest = typeof import("@/lib/gate-request");
type Gate = typeof import("@/lib/gate");

/** Both gate.ts and gate-request.ts read env at module load (via gate.ts),
 *  so each test re-imports with the env it needs — mirroring gate.test.ts's
 *  own loadGate helper. Importing both from the same reset epoch keeps them
 *  pointed at the same underlying gate.ts module instance. */
async function loadGateRequest(env: Record<string, string> = {}): Promise<{ gateRequest: GateRequest; gate: Gate }> {
  vi.resetModules();
  vi.stubEnv("CHALLENGES_GATE_ENABLED", env.CHALLENGES_GATE_ENABLED ?? "true");
  vi.stubEnv("CHALLENGES_GATE_PASSWORD", env.CHALLENGES_GATE_PASSWORD ?? "hunter2");
  vi.stubEnv("BETTER_AUTH_SECRET", env.BETTER_AUTH_SECRET ?? "test-secret");
  const [gateRequest, gate] = await Promise.all([import("@/lib/gate-request"), import("@/lib/gate")]);
  return { gateRequest, gate };
}

afterEach(() => {
  vi.unstubAllEnvs();
  cookieMocks.cookieJar.clear();
});

describe("requireGatePassed", () => {
  it("passes when the gate is inactive, regardless of any cookie", async () => {
    const { gateRequest } = await loadGateRequest({ CHALLENGES_GATE_ENABLED: "" });
    expect(await gateRequest.requireGatePassed()).toBe(true);
  });

  it("refuses when the gate is active and no cookie is present", async () => {
    const { gateRequest } = await loadGateRequest();
    expect(await gateRequest.requireGatePassed()).toBe(false);
  });

  it("refuses when the gate is active and the cookie is malformed/invalid", async () => {
    const { gateRequest, gate } = await loadGateRequest();
    cookieMocks.cookieJar.set(gate.GATE_COOKIE, "v1.123.deadbeef");
    expect(await gateRequest.requireGatePassed()).toBe(false);
  });

  it("refuses when the gate is active and the cookie is expired", async () => {
    const { gateRequest, gate } = await loadGateRequest();
    cookieMocks.cookieJar.set(gate.GATE_COOKIE, gate.signGateCookie(Date.now() - 1));
    expect(await gateRequest.requireGatePassed()).toBe(false);
  });

  it("passes when the gate is active and the cookie is a valid unlock", async () => {
    const { gateRequest, gate } = await loadGateRequest();
    cookieMocks.cookieJar.set(gate.GATE_COOKIE, gate.signGateCookie(Date.now() + 60_000));
    expect(await gateRequest.requireGatePassed()).toBe(true);
  });
});
