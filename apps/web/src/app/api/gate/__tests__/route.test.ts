// Route-level tests for the challenges gate.
//
// The store's own suite proves the conditional writes are atomic. What is
// tested HERE is the wiring, and specifically the ordering, because that is
// the whole of the fix: the attempt must be charged BEFORE the password is
// compared. A refactor that restores the old shape — read, decide, compare,
// then write — passes every store test and reintroduces the vulnerability.
//
// The store is mocked, so no AWS credentials are needed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeGateAttempt: vi.fn(),
  clearGateThrottle: vi.fn(),
  verifyGatePassword: vi.fn(),
  isGateActive: vi.fn(),
  /** Records call order across both modules. */
  calls: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/gate-store", () => ({
  consumeGateAttempt: (...args: unknown[]) => {
    mocks.calls.push("consume");
    return mocks.consumeGateAttempt(...args);
  },
  clearGateThrottle: (...args: unknown[]) => {
    mocks.calls.push("clear");
    return mocks.clearGateThrottle(...args);
  },
}));
vi.mock("@/lib/gate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gate")>()),
  isGateActive: () => mocks.isGateActive(),
  verifyGatePassword: (...args: unknown[]) => {
    mocks.calls.push("compare");
    return mocks.verifyGatePassword(...args);
  },
}));

import { POST } from "@/app/api/gate/route";

function post(password: unknown, ip = "203.0.113.9") {
  return new Request("http://localhost/api/gate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ password }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.isGateActive.mockReturnValue(true);
  mocks.consumeGateAttempt.mockResolvedValue({ allowed: true });
  mocks.clearGateThrottle.mockResolvedValue(true);
});

describe("POST /api/gate", () => {
  it("404s when the gate is switched off", async () => {
    mocks.isGateActive.mockReturnValue(false);
    expect((await POST(post("anything"))).status).toBe(404);
    expect(mocks.calls).toEqual([]);
  });

  it("charges the attempt BEFORE comparing the password", async () => {
    mocks.verifyGatePassword.mockReturnValue(false);
    await POST(post("guess"));
    // The assertion the fix exists for. Reversed, a burst of concurrent
    // requests all compare against the same unspent budget.
    expect(mocks.calls).toEqual(["consume", "compare"]);
  });

  it("rejects a wrong password with 401, having already spent the budget", async () => {
    mocks.verifyGatePassword.mockReturnValue(false);
    const res = await POST(post("guess"));
    expect(res.status).toBe(401);
    expect(mocks.consumeGateAttempt).toHaveBeenCalledTimes(1);
    // No second bookkeeping write: the charge above already counted it.
    expect(mocks.calls.filter((c) => c === "consume")).toHaveLength(1);
  });

  it("refuses a locked caller with 429 and never reaches the compare", async () => {
    mocks.consumeGateAttempt.mockResolvedValue({ allowed: false, retryAfterSeconds: 3600 });
    const res = await POST(post("correct"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
    // Holding the right password does not get you past a lock, and a locked
    // caller must not be able to use the endpoint as an oracle.
    expect(mocks.calls).toEqual(["consume"]);
    expect(mocks.verifyGatePassword).not.toHaveBeenCalled();
  });

  it("fails closed with 500 when the budget cannot be charged", async () => {
    mocks.consumeGateAttempt.mockRejectedValue(new Error("dynamo down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post("correct"));
    expect(res.status).toBe(500);
    // A store outage must never degrade into an unmetered guessing endpoint.
    expect(mocks.verifyGatePassword).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("issues the unlock cookie on success and refunds the budget", async () => {
    mocks.verifyGatePassword.mockReturnValue(true);
    const res = await POST(post("correct"));
    expect(res.status).toBe(200);
    expect(mocks.calls).toEqual(["consume", "compare", "clear"]);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("ctf-challenges-gate=");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
  });

  it("still issues the cookie when the refund fails, so a lost delete cannot strand the caller", async () => {
    mocks.verifyGatePassword.mockReturnValue(true);
    mocks.clearGateThrottle.mockResolvedValue(false);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post("correct"));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("ctf-challenges-gate=");
    consoleError.mockRestore();
  });

  it("rejects an empty password with 400 without spending budget", async () => {
    const res = await POST(post(""));
    expect(res.status).toBe(400);
    expect(mocks.calls).toEqual([]);
  });

  it("keys the throttle on the first x-forwarded-for hop", async () => {
    mocks.verifyGatePassword.mockReturnValue(false);
    const req = new Request("http://localhost/api/gate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.7, 10.0.0.1, 10.0.0.2",
      },
      body: JSON.stringify({ password: "guess" }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
    await POST(req);
    expect(mocks.consumeGateAttempt).toHaveBeenCalledWith("198.51.100.7", expect.any(Number));
  });
});
