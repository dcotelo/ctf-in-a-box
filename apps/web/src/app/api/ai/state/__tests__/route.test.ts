// The read-only progress snapshot an external challenge polls. Two properties
// carry the weight: it writes nothing, and it leaks nothing — this is a
// CORS `*` endpoint returning per-user data.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyLaunchToken: vi.fn(),
  decodeTokenUnverified: vi.fn(),
  getAiLaunchPublicKey: vi.fn(),
  listAiChallenges: vi.fn(),
  getViewerAi: vi.fn(),
  consumeRateLimit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai-token", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai-token")>()),
  verifyLaunchToken: mocks.verifyLaunchToken,
  decodeTokenUnverified: mocks.decodeTokenUnverified,
}));
vi.mock("@/lib/ai-store", () => ({
  getAiLaunchPublicKey: mocks.getAiLaunchPublicKey,
  listAiChallenges: mocks.listAiChallenges,
  getViewerAi: mocks.getViewerAi,
}));
vi.mock("@/lib/rate-limit-store", async (orig) => ({
  ...(await orig<typeof import("@/lib/rate-limit-store")>()),
  consumeRateLimit: mocks.consumeRateLimit,
}));

import { GET, OPTIONS } from "@/app/api/ai/state/route";

const CHAL = "prompt-leak-ab12cd";
const OTHER = "guardrail-cd34ef";

const bearer = (token: string) =>
  new Request("http://x/api/ai/state", { headers: { authorization: `Bearer ${token}` } });
const query = (token: string) => new Request(`http://x/api/ai/state?t=${encodeURIComponent(token)}`);

function tokenIsGood(sub = "alice") {
  mocks.decodeTokenUnverified.mockReturnValue({ sub, aud: CHAL });
  mocks.getAiLaunchPublicKey.mockResolvedValue("-----BEGIN PUBLIC KEY-----test");
  mocks.verifyLaunchToken.mockReturnValue({ ok: true, claims: { sub, aud: CHAL } });
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true });
  mocks.listAiChallenges.mockResolvedValue([
    { id: CHAL, points: 300, mode: "both", title: "Prompt leak" },
    { id: OTHER, points: 400, mode: "event", title: "Guardrail" },
  ]);
  mocks.getViewerAi.mockResolvedValue({
    // Deliberately less than the challenge's current 300: this pins that the
    // top-level total sums the SOLVE-TIME price (200), not today's re-priced
    // value, while the progress row below still reflects the CURRENT price.
    solved: { [CHAL]: { points: 200, at: "2026-08-31T11:00:00.000Z", source: "flag" } },
    attempts: {},
  });
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

describe("GET /api/ai/state", () => {
  it("returns the live snapshot for the token's subject", async () => {
    tokenIsGood();
    const res = await GET(bearer("t"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sub: "alice",
      // The total honours history: it is the solve-time price (200), not the
      // challenge's current price (300).
      points: 200,
      progress: [
        // The board shows today's price: the CHAL row's points is 300 (the
        // challenge's current value), even though the solve banked 200.
        { id: CHAL, points: 300, solved: true, solvedAt: "2026-08-31T11:00:00.000Z" },
        { id: OTHER, points: 400, solved: false, solvedAt: null },
      ],
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("accepts the token in the query string too, for a SPA that cannot set headers", async () => {
    tokenIsGood();
    expect((await GET(query("t"))).status).toBe(200);
  });

  it("prefers the header when both are present", async () => {
    tokenIsGood();
    const req = new Request("http://x/api/ai/state?t=from-query", {
      headers: { authorization: "Bearer from-header" },
    });
    await GET(req);
    expect(mocks.verifyLaunchToken).toHaveBeenCalledWith("from-header", expect.any(String), {
      audience: CHAL,
    });
  });

  it("is never cached by a shared cache — this is per-user data on a public endpoint", async () => {
    tokenIsGood();
    expect((await GET(bearer("t"))).headers.get("cache-control")).toContain("no-store");
  });

  it("carries no secret, even when a poisoned record reaches the lister", async () => {
    tokenIsGood();
    mocks.listAiChallenges.mockResolvedValue([
      { id: CHAL, points: 300, mode: "both", flag: "CTF{leak}", flagnorm: "ctf{leak}", signingKey: "aik_x" },
    ]);
    const text = await (await GET(bearer("t"))).text();
    for (const secret of ["CTF{leak}", "ctf{leak}", "aik_x", "flagnorm", "signingKey"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("refuses a missing, malformed, unverifiable or expired token", async () => {
    expect((await GET(new Request("http://x/api/ai/state"))).status).toBe(401);

    tokenIsGood();
    mocks.decodeTokenUnverified.mockReturnValue(null);
    expect((await GET(bearer("garbage"))).status).toBe(401);

    for (const [error, body] of [
      ["invalid-signature", "invalid-token"],
      ["malformed", "invalid-token"],
      ["audience", "invalid-token"],
      ["expired", "expired"],
    ] as const) {
      tokenIsGood();
      mocks.verifyLaunchToken.mockReturnValue({ ok: false, error });
      const res = await GET(bearer("t"));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: body });
    }
  });

  it("rate limits per token subject", async () => {
    tokenIsGood();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 12 });
    const res = await GET(bearer("t"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("12");
    expect(mocks.getViewerAi).not.toHaveBeenCalled();
  });

  it("answers a preflight advertising GET", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });
});
