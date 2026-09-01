// Route-level tests for the ai module's signed solve-assertion endpoint —
// the most security-sensitive surface in the module.
//
// `withinSkew` is deliberately NOT mocked: it is pure, and the stale/future
// timestamp tests are only meaningful if the real one runs. Time is pinned
// with fake timers instead.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyLaunchToken: vi.fn(),
  verifyEventSignature: vi.fn(),
  getAiSigningKey: vi.fn(),
  getAiLaunchPublicKey: vi.fn(),
  listAiChallenges: vi.fn(),
  awardAiEvent: vi.fn(),
  claimAiNonce: vi.fn(),
  consumeRateLimit: vi.fn(),
  hasTeam: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai-token", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai-token")>()),
  verifyLaunchToken: mocks.verifyLaunchToken,
  verifyEventSignature: mocks.verifyEventSignature,
}));
vi.mock("@/lib/ai-store", () => ({
  getAiSigningKey: mocks.getAiSigningKey,
  getAiLaunchPublicKey: mocks.getAiLaunchPublicKey,
  listAiChallenges: mocks.listAiChallenges,
  awardAiEvent: mocks.awardAiEvent,
  claimAiNonce: mocks.claimAiNonce,
}));
vi.mock("@/lib/rate-limit-store", async (orig) => ({
  ...(await orig<typeof import("@/lib/rate-limit-store")>()),
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock("@/lib/team-store", () => ({ hasTeam: mocks.hasTeam }));

import { OPTIONS, POST } from "@/app/api/ai/event/route";

const CHAL = "guardrail-cd34ef";
const NOW_MS = 1_756_636_800_000; // 2026-08-31T12:00:00Z
const NOW_SEC = NOW_MS / 1000;

/** A signed event request. `raw` is sent verbatim so the test can assert the
 *  route hashed exactly these bytes. */
function signed(raw: string, ts: number = NOW_SEC, headers: Record<string, string> = {}) {
  return new Request("http://x/api/ai/event", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-ctf-timestamp": String(ts),
      "x-ctf-signature": "sha256=deadbeef",
      ...headers,
    },
  });
}

const bodyFor = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ token: "t", challengeId: CHAL, solvedAt: "2026-08-31T11:59:00Z", ...over });

/** Every gate open: a real backend, a real token, a fresh nonce. */
function allGatesOpen(sub = "alice") {
  mocks.listAiChallenges.mockResolvedValue([{ id: CHAL, mode: "event", points: 400 }]);
  mocks.getAiSigningKey.mockResolvedValue("aik_key");
  mocks.getAiLaunchPublicKey.mockResolvedValue("-----BEGIN PUBLIC KEY-----test");
  mocks.verifyEventSignature.mockReturnValue(true);
  mocks.verifyLaunchToken.mockReturnValue({ ok: true, claims: { sub, aud: CHAL, jti: "nonce-1" } });
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true });
  mocks.claimAiNonce.mockResolvedValue(true);
  mocks.hasTeam.mockResolvedValue(true);
  mocks.awardAiEvent.mockResolvedValue({ ok: true, correct: true, points: 400 });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  for (const m of Object.values(mocks)) m.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("POST /api/ai/event", () => {
  it("awards a solve asserted by the real backend", async () => {
    allGatesOpen();
    const res = await POST(signed(bodyFor()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ correct: true, points: 400, already: false });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    // Every security-critical argument, pinned. A wrong audience source (the
    // token's own `aud` instead of the URL's challengeId), a wrong nonce
    // subject (challengeId instead of the token's `jti`), or a rate-limit key
    // that is not the verified login would all still leave every OTHER
    // assertion in this suite green.
    expect(mocks.verifyLaunchToken).toHaveBeenCalledWith("t", "-----BEGIN PUBLIC KEY-----test", { audience: CHAL });
    expect(mocks.claimAiNonce).toHaveBeenCalledWith("nonce-1");
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith("ai-event", "alice", 60, 60);
    expect(mocks.hasTeam).toHaveBeenCalledWith("alice");
    expect(mocks.awardAiEvent).toHaveBeenCalledWith("alice", CHAL, { dryRun: false });
  });

  it("hashes the EXACT bytes received, never a re-serialized body", async () => {
    // The single most expensive mistake available on this path: a
    // JSON.parse -> JSON.stringify round trip changes whitespace and key
    // order, so every signature a real integrator computed would fail while
    // looking like a wrong key.
    allGatesOpen();
    const raw = '{ "challengeId":"' + CHAL + '",\n  "token":"t" }';
    await POST(signed(raw));
    expect(mocks.verifyEventSignature).toHaveBeenCalledWith("aik_key", NOW_SEC, raw, "sha256=deadbeef");
  });

  it("takes identity from the token, never from the body", async () => {
    allGatesOpen("alice");
    await POST(signed(bodyFor({ login: "mallory", sub: "mallory" })));
    expect(mocks.awardAiEvent).toHaveBeenCalledWith("alice", CHAL, { dryRun: false });
  });

  it("refuses a bad signature before it ever looks at the token", async () => {
    allGatesOpen();
    mocks.verifyEventSignature.mockReturnValue(false);
    const res = await POST(signed(bodyFor()));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid-signature" });
    // Order matters: a caller who cannot prove it is the backend learns
    // nothing about the token it presented.
    expect(mocks.verifyLaunchToken).not.toHaveBeenCalled();
    expect(mocks.awardAiEvent).not.toHaveBeenCalled();
  });

  it("refuses a missing or non-numeric timestamp", async () => {
    for (const ts of ["", "not-a-number", "NaN"]) {
      allGatesOpen();
      const res = await POST(signed(bodyFor(), NOW_SEC, { "x-ctf-timestamp": ts }));
      expect(res.status).toBe(401);
      expect(mocks.awardAiEvent).not.toHaveBeenCalled();
    }
  });

  it("refuses a stale timestamp AND a future one", async () => {
    // Both directions. A signer with a fast clock could otherwise mint
    // requests that stay replayable after the nonce expires.
    for (const ts of [NOW_SEC - 301, NOW_SEC + 301]) {
      allGatesOpen();
      const res = await POST(signed(bodyFor(), ts));
      expect(res.status, String(ts)).toBe(401);
      expect(await res.json()).toEqual({ error: "stale-request" });
      expect(mocks.awardAiEvent).not.toHaveBeenCalled();
    }
  });

  it("accepts a timestamp inside the window in both directions, boundary included", async () => {
    // `withinSkew` is `<=`, so exactly ±300 must still be accepted — not just
    // comfortably inside it.
    for (const ts of [NOW_SEC - 299, NOW_SEC + 299, NOW_SEC - 300, NOW_SEC + 300]) {
      allGatesOpen();
      expect((await POST(signed(bodyFor(), ts))).status, String(ts)).toBe(200);
    }
  });

  it("refuses a replayed event without awarding", async () => {
    allGatesOpen();
    mocks.claimAiNonce.mockResolvedValue(false);
    const res = await POST(signed(bodyFor()));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "replay" });
    expect(mocks.awardAiEvent).not.toHaveBeenCalled();
  });

  it("claims the nonce BEFORE awarding", async () => {
    allGatesOpen();
    const order: string[] = [];
    mocks.claimAiNonce.mockImplementation(async () => (order.push("nonce"), true));
    mocks.awardAiEvent.mockImplementation(async () => (order.push("award"), { ok: true, correct: true, points: 400 }));
    await POST(signed(bodyFor()));
    expect(order).toEqual(["nonce", "award"]);
  });

  it("refuses an event against a flag-only challenge", async () => {
    allGatesOpen();
    mocks.listAiChallenges.mockResolvedValue([{ id: CHAL, mode: "flag", points: 400 }]);
    const res = await POST(signed(bodyFor()));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "wrong-mode" });
    // Pins the mode gate ABOVE the signature check, not merely somewhere
    // before the award — the same ordering the 404 test pins for the
    // unknown-challenge gate.
    expect(mocks.verifyEventSignature).not.toHaveBeenCalled();
    expect(mocks.awardAiEvent).not.toHaveBeenCalled();
  });

  it("refuses when the body names a different challenge than the token", async () => {
    allGatesOpen();
    mocks.verifyLaunchToken.mockReturnValue({ ok: false, error: "audience" });
    const res = await POST(signed(bodyFor()));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid-token" });
    expect(mocks.awardAiEvent).not.toHaveBeenCalled();
  });

  it("404s an unknown challenge and never computes a signature for it", async () => {
    allGatesOpen();
    mocks.listAiChallenges.mockResolvedValue([]);
    const res = await POST(signed(bodyFor()));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown-challenge" });
    expect(mocks.verifyEventSignature).not.toHaveBeenCalled();
  });

  it("ignores a session cookie entirely", async () => {
    // A valid admin session plus a bad signature is still refused. If this
    // route ever starts reading a cookie, CSRF is back on a CORS `*` endpoint.
    allGatesOpen();
    mocks.verifyEventSignature.mockReturnValue(false);
    const res = await POST(signed(bodyFor(), NOW_SEC, { cookie: "better-auth.session=admin" }));
    expect(res.status).toBe(401);
  });

  it("dryRun reports the verdict and writes NOTHING", async () => {
    allGatesOpen();
    mocks.awardAiEvent.mockResolvedValue({ ok: true, correct: true, points: 0, dryRun: true });

    const res = await POST(signed(bodyFor({ dryRun: true })));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dryRun: true, wouldAward: true });
    // The nonce is a WRITE. A dry run that claimed one would burn the jti and
    // make the organizer's next real event look like a replay.
    expect(mocks.claimAiNonce).not.toHaveBeenCalled();
    expect(mocks.awardAiEvent).toHaveBeenCalledWith("alice", CHAL, { dryRun: true });
  });

  it("dryRun reports a refusal rather than swallowing it", async () => {
    allGatesOpen();
    mocks.awardAiEvent.mockResolvedValue({ ok: false, reason: "paused" });
    const res = await POST(signed(bodyFor({ dryRun: true })));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dryRun: true, wouldAward: false, verdict: "paused" });
  });

  it("dryRun still requires a valid signature — it is not an auth bypass", async () => {
    allGatesOpen();
    mocks.verifyEventSignature.mockReturnValue(false);
    const res = await POST(signed(bodyFor({ dryRun: true })));
    expect(res.status).toBe(401);
    expect(mocks.awardAiEvent).not.toHaveBeenCalled();
  });

  it("refuses a non-boolean dryRun rather than treating it as false", async () => {
    // `dryRun` means do-not-write. Falling through to `false` on a truthy
    // non-boolean (a templated integration sending the STRING "true") would
    // fail toward a real award and a burned jti — backwards for a safety
    // field.
    for (const value of ["true", 1]) {
      allGatesOpen();
      const res = await POST(signed(bodyFor({ dryRun: value })));
      expect(res.status, JSON.stringify(value)).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid-request" });
      expect(mocks.verifyEventSignature).not.toHaveBeenCalled();
      expect(mocks.awardAiEvent).not.toHaveBeenCalled();
    }
  });

  it("treats an explicit dryRun: false, and an absent dryRun, as a real award", async () => {
    for (const over of [{ dryRun: false }, {}]) {
      allGatesOpen();
      const res = await POST(signed(bodyFor(over)));
      expect(res.status, JSON.stringify(over)).toBe(200);
      expect(mocks.awardAiEvent).toHaveBeenCalledWith("alice", CHAL, { dryRun: false });
    }
  });

  it("refuses a teamless solver", async () => {
    allGatesOpen();
    mocks.hasTeam.mockResolvedValue(false);
    const res = await POST(signed(bodyFor()));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "no-team" });
    expect(mocks.awardAiEvent).not.toHaveBeenCalled();
  });

  it("maps every store refusal to its documented status", async () => {
    for (const [reason, status] of [
      ["paused", 403],
      ["solved", 409],
      ["wrong-mode", 409],
      ["unavailable", 503],
      ["error", 503],
      ["invalid", 400],
    ] as const) {
      allGatesOpen();
      mocks.awardAiEvent.mockResolvedValue({ ok: false, reason });
      const res = await POST(signed(bodyFor()));
      expect(res.status, reason).toBe(status);
      expect(await res.json()).toEqual({ error: reason });
    }
  });

  it("rate limits per token subject, before claiming a nonce", async () => {
    allGatesOpen();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
    const res = await POST(signed(bodyFor()));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(mocks.claimAiNonce).not.toHaveBeenCalled();
    expect(mocks.awardAiEvent).not.toHaveBeenCalled();
  });

  it("refuses an oversized body without hashing it", async () => {
    allGatesOpen();
    const res = await POST(signed(JSON.stringify({ token: "t", challengeId: CHAL, pad: "x".repeat(9000) })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid-request" });
    expect(mocks.verifyEventSignature).not.toHaveBeenCalled();
  });

  it("rejects a malformed body and a missing challengeId", async () => {
    for (const raw of ["{not json", JSON.stringify({ token: "t" }), JSON.stringify({ challengeId: CHAL })]) {
      allGatesOpen();
      expect((await POST(signed(raw))).status).toBe(400);
      expect(mocks.awardAiEvent).not.toHaveBeenCalled();
    }
  });

  it("answers a preflight advertising POST", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });
});
