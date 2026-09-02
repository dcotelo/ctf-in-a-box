// Route-level tests for the admin "Send test" surface: it mints a demo
// launch token for the ADMIN'S OWN login, signs a demo event body with the
// challenge's real signing key, and invokes the REAL `/api/ai/event` handler
// in-process with `dryRun: true` — so these tests deliberately do NOT mock
// `verifyLaunchToken`/`verifyEventSignature` (unlike event/route.test.ts,
// which mocks both to isolate the route from crypto). Here the crypto is the
// point: a REAL generated launch keypair is used so the event handler's own
// Ed25519 verification actually runs end to end.
//
// Everything the event handler reads from the store is mocked exactly as
// `src/app/api/ai/event/__tests__/route.test.ts` mocks it — both routes
// import `@/lib/ai-store`, so one mock covers both call sites.
//
// `signLaunchToken` is wrapped (not replaced) so the TTL assertion can
// inspect the exact claims minted, while the real Ed25519 signature still
// runs — the event handler's `verifyLaunchToken` call must see a genuine
// signature, not a stub.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiTokenClaims } from "@/lib/ai-token";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listAiChallenges: vi.fn(),
  getAiSigningKey: vi.fn(),
  getAiLaunchKeys: vi.fn(),
  getAiLaunchPublicKey: vi.fn(),
  awardAiEvent: vi.fn(),
  claimAiNonce: vi.fn(),
  releaseAiNonce: vi.fn(),
  consumeRateLimit: vi.fn(),
  hasTeam: vi.fn(),
  upstashPipeline: vi.fn(),
  signLaunchToken: vi.fn(),
  // Holds the REAL implementation, set once by the `@/lib/ai-token` mock
  // factory below and restored onto `signLaunchToken` after every reset — a
  // plain mutable slot, not a mock itself, so `vi.hoisted` is safe here.
  realSignLaunchToken: undefined as unknown as typeof import("@/lib/ai-token").signLaunchToken,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/ai-store", () => ({
  listAiChallenges: mocks.listAiChallenges,
  getAiSigningKey: mocks.getAiSigningKey,
  getAiLaunchKeys: mocks.getAiLaunchKeys,
  getAiLaunchPublicKey: mocks.getAiLaunchPublicKey,
  awardAiEvent: mocks.awardAiEvent,
  claimAiNonce: mocks.claimAiNonce,
  releaseAiNonce: mocks.releaseAiNonce,
}));
vi.mock("@/lib/ai-token", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai-token")>();
  // Wrap, don't replace: the real signature must still be produced so the
  // real event handler's real verification runs end to end.
  mocks.realSignLaunchToken = actual.signLaunchToken;
  mocks.signLaunchToken.mockImplementation(actual.signLaunchToken);
  return { ...actual, signLaunchToken: mocks.signLaunchToken };
});
vi.mock("@/lib/rate-limit-store", async (orig) => ({
  ...(await orig<typeof import("@/lib/rate-limit-store")>()),
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock("@/lib/team-store", () => ({ hasTeam: mocks.hasTeam }));
vi.mock("@/lib/admin-store", () => ({ ADMIN_AUDIT_KEY: "ctf:admin:audit", AUDIT_CAP: 500 }));
vi.mock("@/lib/upstash", () => ({ upstashPipeline: mocks.upstashPipeline }));

import { generateLaunchKeyPair } from "@/lib/ai-token";
import { POST } from "@/app/api/admin/ai/test/route";

const CHAL = "guardrail-cd34ef";
const CHALLENGE = {
  id: CHAL,
  title: "Guardrail Bypass",
  category: "AI",
  description: "d",
  points: 400,
  order: 1,
  mode: "event" as const,
  urlTemplate: "https://x/{token}",
};
const SIGNING_KEY = "aik_" + "a".repeat(43);
const KEYS = generateLaunchKeyPair();

const adminReq = (body: unknown = { challengeId: CHAL }) =>
  new Request("http://x/api/admin/ai/test", { method: "POST", body: JSON.stringify(body) });

function allGatesOpen() {
  mocks.requireAdmin.mockResolvedValue({ ok: true, login: "organizer" });
  mocks.listAiChallenges.mockResolvedValue([CHALLENGE]);
  mocks.getAiSigningKey.mockResolvedValue(SIGNING_KEY);
  mocks.getAiLaunchKeys.mockResolvedValue(KEYS);
  mocks.getAiLaunchPublicKey.mockResolvedValue(KEYS.publicKey);
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true });
  mocks.hasTeam.mockResolvedValue(true);
  mocks.claimAiNonce.mockResolvedValue(true);
  mocks.releaseAiNonce.mockResolvedValue(undefined);
  mocks.awardAiEvent.mockResolvedValue({ ok: true, correct: true, points: 0, dryRun: true });
  mocks.upstashPipeline.mockResolvedValue([{ result: 1 }, { result: "OK" }]);
}

beforeEach(() => {
  for (const m of Object.values(mocks)) if (vi.isMockFunction(m)) m.mockReset();
  // `mockReset()` above also clears the wrapped real implementation — restore
  // it so every test's mint still produces a genuinely verifiable signature.
  mocks.signLaunchToken.mockImplementation(mocks.realSignLaunchToken);
});

describe("POST /api/admin/ai/test", () => {
  it("refuses a non-admin before minting anything or touching the event handler", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    const res = await POST(adminReq());
    expect(res.status).toBe(403);
    expect(mocks.getAiLaunchKeys).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.getAiSigningKey).not.toHaveBeenCalled();
    expect(mocks.awardAiEvent).not.toHaveBeenCalled();
  });

  it("unknown challengeId reports 400 unknown-challenge", async () => {
    allGatesOpen();
    mocks.listAiChallenges.mockResolvedValue([]);
    const res = await POST(adminReq({ challengeId: "does-not-exist" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown-challenge" });
    expect(mocks.getAiLaunchKeys).not.toHaveBeenCalled();
    expect(mocks.awardAiEvent).not.toHaveBeenCalled();
  });

  it("a challenge with no signing key yet is reported as unknown-challenge", async () => {
    allGatesOpen();
    mocks.getAiSigningKey.mockResolvedValue(null);
    const res = await POST(adminReq());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown-challenge" });
    expect(mocks.getAiLaunchKeys).not.toHaveBeenCalled();
  });

  it("rate limits per admin login, before any mint or lookup", async () => {
    allGatesOpen();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const res = await POST(adminReq());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate-limited" });
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith("ai-admin-test", "organizer", 10, 60);
    expect(mocks.getAiLaunchKeys).not.toHaveBeenCalled();
    expect(mocks.awardAiEvent).not.toHaveBeenCalled();
  });

  it("relays the real event handler's dry-run verdict for an event-mode challenge", async () => {
    allGatesOpen();
    const res = await POST(adminReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe(200);
    expect(json.body).toMatchObject({ dryRun: true, wouldAward: true });
    // The dry run never claims a nonce and never awards for real.
    expect(mocks.claimAiNonce).not.toHaveBeenCalled();
    expect(mocks.awardAiEvent).toHaveBeenCalledWith("organizer", CHAL, { dryRun: true });
    // The private key must never leak into the response.
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain("aik_");
    expect(serialized).not.toContain("PRIVATE KEY");
  });

  it("relays the event route's own wrong-mode refusal for a flag-mode challenge, unmodified", async () => {
    allGatesOpen();
    mocks.listAiChallenges.mockResolvedValue([{ ...CHALLENGE, mode: "flag" as const }]);
    const res = await POST(adminReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe(409);
    expect(json.body).toEqual({ error: "wrong-mode" });
    expect(mocks.awardAiEvent).not.toHaveBeenCalled();
  });

  it("mints a token with exactly a 900-second TTL for the admin's own login", async () => {
    allGatesOpen();
    await POST(adminReq());
    expect(mocks.signLaunchToken).toHaveBeenCalledTimes(1);
    const claims = mocks.signLaunchToken.mock.calls[0][0] as AiTokenClaims;
    expect(claims.exp - claims.iat).toBe(900);
    expect(claims.sub).toBe("organizer");
    expect(claims.aud).toBe(CHAL);
    expect(claims.ctf).toEqual({
      module: "ai",
      challenge: { id: CHAL, title: CHALLENGE.title, points: CHALLENGE.points },
      points: 0,
      progress: [],
    });
  });

  it("writes an audit line naming the challenge id, never the token or key", async () => {
    allGatesOpen();
    await POST(adminReq());
    expect(mocks.upstashPipeline).toHaveBeenCalled();
    const call = mocks.upstashPipeline.mock.calls[0][0] as unknown[][];
    const serialized = JSON.stringify(call);
    expect(serialized).toContain("ai-send-test");
    expect(serialized).toContain(CHAL);
    expect(serialized).not.toContain("aik_");
    expect(serialized).not.toContain("PRIVATE KEY");
  });

  it("the signed event body actually verifies against the real signing key (real crypto end to end)", async () => {
    allGatesOpen();
    const res = await POST(adminReq());
    const json = await res.json();
    // If the admin route's HMAC or Ed25519 signing were wrong, the real event
    // handler would refuse with invalid-signature/invalid-token rather than
    // returning a dry-run verdict.
    expect(json.body).not.toMatchObject({ error: "invalid-signature" });
    expect(json.body).not.toMatchObject({ error: "invalid-token" });
    expect(json.status).toBe(200);
  });
});
