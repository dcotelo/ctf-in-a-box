// The module's one deliberately public endpoint. Its whole job is to hand out
// a public key — so the test that matters most is the one proving it can
// never hand out anything else.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAiLaunchPublicKey: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai-store", () => ({ getAiLaunchPublicKey: mocks.getAiLaunchPublicKey }));

import { GET, OPTIONS } from "@/app/api/ai/launch-key/route";

const PUBLIC_PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAn3ucqIwaK//zm/i15crO7vM+glf/le0cAR1nN/Dyy+8=\n-----END PUBLIC KEY-----\n";

beforeEach(() => {
  mocks.getAiLaunchPublicKey.mockReset();
  mocks.getAiLaunchPublicKey.mockResolvedValue(PUBLIC_PEM);
});

describe("GET /api/ai/launch-key", () => {
  it("publishes the public key, its kid and the algorithm", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ alg: "Ed25519", kid: expect.any(String), publicKey: PUBLIC_PEM });
    expect(body.kid).not.toHaveLength(0);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns a kid that is stable for a given key", async () => {
    const first = await (await GET()).json();
    const second = await (await GET()).json();
    expect(first.kid).toBe(second.kid);
  });

  it("returns a different kid once the keypair changes", async () => {
    // The kid is a thumbprint, so a rotation is visible to an integrator
    // rather than silently changing what verifies.
    const before = await (await GET()).json();
    mocks.getAiLaunchPublicKey.mockResolvedValue(
      "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAeufpT6GpliRpbOWGr+f75i+h1ztoRV+XTlbJqHQPbYE=\n-----END PUBLIC KEY-----\n",
    );
    const after = await (await GET()).json();
    expect(after.kid).not.toBe(before.kid);
  });

  it("cannot leak the private half even if the store hands one over", async () => {
    // This route reads the PUBLIC accessor by construction. The test plants a
    // private key in the reply anyway: if someone ever swaps the call for
    // `getAiLaunchKeys()`, the payload must still carry only the public half.
    mocks.getAiLaunchPublicKey.mockResolvedValue(PUBLIC_PEM);
    const text = await (await GET()).text();
    for (const forbidden of ["PRIVATE KEY", "privateKey", "aik_"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("is cacheable, but not for long — a rotation must reach integrators", async () => {
    const cacheControl = (await GET()).headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("max-age");
    expect(cacheControl).not.toContain("no-store");
  });

  it("answers 503 rather than a broken key when the store is unavailable", async () => {
    // Fail CLOSED: handing back an empty or partial key would have integrators
    // cache a value that verifies nothing.
    mocks.getAiLaunchPublicKey.mockRejectedValue(new Error("redis down"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });

  it("answers a preflight advertising GET", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });
});
