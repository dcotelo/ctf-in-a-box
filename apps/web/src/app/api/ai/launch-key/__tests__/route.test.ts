// The module's one deliberately public endpoint. Its whole job is to hand out
// a public key — so the test that matters most is the one proving it can
// never hand out anything else.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAiLaunchPublicKey: vi.fn(),
  getAiLaunchKeys: vi.fn(),
}));

vi.mock("server-only", () => ({}));
// BOTH accessors are on the mocked module on purpose — see the leak test
// below. The private half must be REACHABLE from here, or the assertions that
// it never reaches the wire cannot fail under the mutation they name.
vi.mock("@/lib/ai-store", () => ({
  getAiLaunchPublicKey: mocks.getAiLaunchPublicKey,
  getAiLaunchKeys: mocks.getAiLaunchKeys,
}));

import { GET, OPTIONS } from "@/app/api/ai/launch-key/route";

const PUBLIC_PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAn3ucqIwaK//zm/i15crO7vM+glf/le0cAR1nN/Dyy+8=\n-----END PUBLIC KEY-----\n";
/** A fixture planted so the leak test below has something to leak — an
 *  obviously fake marker rather than a structurally valid PKCS8 body, so it
 *  cannot trip a secret scanner. It only needs to look like private key
 *  material to a substring check; nothing here ever parses it as one. The
 *  launch private key mints identity itself and can name anybody, so it is
 *  the worst secret in the module to publish. */
const PRIVATE_PEM =
  "-----BEGIN PRIVATE KEY-----\nNOT-A-REAL-KEY-launch-private-half-fixture\n-----END PRIVATE KEY-----\n";

beforeEach(() => {
  mocks.getAiLaunchPublicKey.mockReset();
  mocks.getAiLaunchKeys.mockReset();
  mocks.getAiLaunchPublicKey.mockResolvedValue(PUBLIC_PEM);
  mocks.getAiLaunchKeys.mockResolvedValue({ publicKey: PUBLIC_PEM, privateKey: PRIVATE_PEM });
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
    // This route reads the PUBLIC accessor by construction. The private half is
    // genuinely REACHABLE from here anyway: the mocked `@/lib/ai-store` also
    // exposes `getAiLaunchKeys()` returning a real-looking private PEM (see
    // the mock above). So if someone ever swaps the call — or spreads the pair
    // into the payload — the private key really does flow and these assertions
    // bite. Anti-vacuous check first: there really is private material to leak.
    expect(PRIVATE_PEM).toContain("PRIVATE KEY");

    const text = await (await GET()).text();
    for (const forbidden of ["PRIVATE KEY", "privateKey", "aik_", PRIVATE_PEM]) {
      expect(text).not.toContain(forbidden);
    }
    // And the pair was never even fetched: the public accessor is the only one
    // this route touches.
    expect(mocks.getAiLaunchPublicKey).toHaveBeenCalled();
    expect(mocks.getAiLaunchKeys).not.toHaveBeenCalled();
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
