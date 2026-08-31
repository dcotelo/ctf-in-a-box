// The ai module's identity boundary. Every rejection test below sits next to a
// positive case built from the SAME fixture — a rejection test whose fixture
// was broken all along proves nothing.
import { describe, expect, it } from "vitest";

import {
  AI_KEY_PREFIX,
  decodeTokenUnverified,
  generateSigningKey,
  signEventBody,
  signToken,
  verifyEventSignature,
  verifyToken,
  withinSkew,
  type AiTokenClaims,
} from "@/lib/ai-token";

const KEY = "aik_test-key-one";
const OTHER_KEY = "aik_test-key-two";
const NOW = 1_756_636_800; // 2026-08-31T12:00:00Z

function claims(over: Partial<AiTokenClaims> = {}): AiTokenClaims {
  return {
    iss: "https://ctf.example.com",
    sub: "alice",
    aud: "prompt-leak-ab12cd",
    iat: NOW,
    exp: NOW + 3600,
    jti: "nonce-1",
    ctf: {
      module: "ai",
      challenge: { id: "prompt-leak-ab12cd", title: "Prompt leak", points: 300 },
      points: 300,
      progress: [{ id: "prompt-leak-ab12cd", points: 300, solved: true, solvedAt: "2026-08-31T11:00:00.000Z" }],
    },
    ...over,
  };
}

describe("signing keys", () => {
  it("mints prefixed, high-entropy, distinct keys", () => {
    const a = generateSigningKey();
    const b = generateSigningKey();
    expect(a.startsWith(AI_KEY_PREFIX)).toBe(true);
    expect(a.length).toBeGreaterThan(40);
    expect(a).not.toBe(b);
  });
});

describe("token round trip", () => {
  it("verifies a token it just signed", () => {
    const res = verifyToken(signToken(claims(), KEY), KEY, { audience: "prompt-leak-ab12cd", nowSec: NOW });
    expect(res).toEqual({ ok: true, claims: claims() });
  });

  it("rejects a token signed with another challenge's key", () => {
    const res = verifyToken(signToken(claims(), OTHER_KEY), KEY, { nowSec: NOW });
    expect(res).toEqual({ ok: false, error: "invalid-signature" });
  });

  it("rejects a tampered payload", () => {
    const [header, payload, sig] = signToken(claims(), KEY).split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...claims(), sub: "mallory" }),
      "utf8",
    ).toString("base64url");
    expect(forged).not.toBe(payload);
    expect(verifyToken(`${header}.${forged}.${sig}`, KEY, { nowSec: NOW })).toEqual({
      ok: false,
      error: "invalid-signature",
    });
  });

  it("rejects a truncated signature without throwing on the length mismatch", () => {
    const token = signToken(claims(), KEY);
    expect(verifyToken(token.slice(0, -4), KEY, { nowSec: NOW })).toEqual({
      ok: false,
      error: "invalid-signature",
    });
  });

  it("rejects an expired token", () => {
    const token = signToken(claims({ exp: NOW - 1 }), KEY);
    expect(verifyToken(token, KEY, { nowSec: NOW })).toEqual({ ok: false, error: "expired" });
  });

  it("rejects a token minted for another challenge", () => {
    const token = signToken(claims(), KEY);
    expect(verifyToken(token, KEY, { audience: "guardrail-cd34ef", nowSec: NOW })).toEqual({
      ok: false,
      error: "audience",
    });
  });

  it("rejects garbage", () => {
    expect(verifyToken("not-a-token", KEY, { nowSec: NOW })).toEqual({ ok: false, error: "malformed" });
  });

  it("decodes without verifying, the way a static SPA does", () => {
    expect(decodeTokenUnverified(signToken(claims(), OTHER_KEY))?.sub).toBe("alice");
    expect(decodeTokenUnverified("garbage")).toBeNull();
  });
});

describe("event body signatures", () => {
  const body = '{"token":"x","challengeId":"prompt-leak-ab12cd"}';

  it("verifies a signature over the exact bytes it signed", () => {
    const sig = signEventBody(KEY, NOW, body);
    expect(sig.startsWith("sha256=")).toBe(true);
    expect(verifyEventSignature(KEY, NOW, body, sig)).toBe(true);
  });

  it("fails when a single byte of the body changes", () => {
    const sig = signEventBody(KEY, NOW, body);
    expect(verifyEventSignature(KEY, NOW, `${body} `, sig)).toBe(false);
  });

  it("binds the signature to the timestamp", () => {
    const sig = signEventBody(KEY, NOW, body);
    expect(verifyEventSignature(KEY, NOW + 1, body, sig)).toBe(false);
  });

  it("fails on another key, a malformed header, and an empty header", () => {
    const sig = signEventBody(KEY, NOW, body);
    expect(verifyEventSignature(OTHER_KEY, NOW, body, sig)).toBe(false);
    expect(verifyEventSignature(KEY, NOW, body, "sha256=zz")).toBe(false);
    expect(verifyEventSignature(KEY, NOW, body, "")).toBe(false);
  });
});

describe("an empty signing key", () => {
  // `createHmac('sha256', '')` does NOT throw — it returns a perfectly valid
  // digest over a key anyone can guess, so a token signed with "" verifies and
  // anyone can mint one naming any `sub`. `AdminAiChallenge.signingKey` really
  // is "" for a legacy keyless row, so this input can reach here. Each throw
  // sits next to the same call with a real key, which must still work.
  const body = '{"token":"x"}';

  it("makes signToken throw instead of minting a forgeable token", () => {
    expect(() => signToken(claims(), "")).toThrow(/signing key/i);
    expect(typeof signToken(claims(), KEY)).toBe("string");
  });

  it("makes verifyToken throw rather than report a routine 'invalid-signature'", () => {
    const token = signToken(claims(), KEY);
    expect(() => verifyToken(token, "", { nowSec: NOW })).toThrow(/signing key/i);
    expect(verifyToken(token, KEY, { nowSec: NOW }).ok).toBe(true);
  });

  it("makes signEventBody throw", () => {
    expect(() => signEventBody("", NOW, body)).toThrow(/signing key/i);
    expect(signEventBody(KEY, NOW, body).startsWith("sha256=")).toBe(true);
  });

  it("makes verifyEventSignature throw rather than silently return false", () => {
    const sig = signEventBody(KEY, NOW, body);
    expect(() => verifyEventSignature("", NOW, body, sig)).toThrow(/signing key/i);
    expect(verifyEventSignature(KEY, NOW, body, sig)).toBe(true);
  });

  it("refuses a missing key as firmly as an empty string", () => {
    expect(() => signToken(claims(), undefined as unknown as string)).toThrow(/signing key/i);
    expect(() => verifyToken("a.b.c", null as unknown as string)).toThrow(/signing key/i);
  });
});

describe("withinSkew", () => {
  it("accepts inside the window and rejects stale AND future timestamps", () => {
    expect(withinSkew(NOW, NOW)).toBe(true);
    expect(withinSkew(NOW - 299, NOW)).toBe(true);
    expect(withinSkew(NOW - 301, NOW)).toBe(false);
    expect(withinSkew(NOW + 301, NOW)).toBe(false);
    expect(withinSkew(Number.NaN, NOW)).toBe(false);
  });
});
