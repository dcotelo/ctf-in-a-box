// The ai module's identity boundary. Every rejection test below sits next to a
// positive case built from the SAME fixture — a rejection test whose fixture
// was broken all along proves nothing.
//
// The property this file exists to pin: LAUNCH tokens are EdDSA, signed with a
// module-wide private key the box alone holds, while EVENT signatures stay
// symmetric and per challenge. Verify-power and mint-power are the same thing
// with an HMAC, so while the two shared one key a backend holding the event key
// could mint a token naming any user. `describe("the event key cannot mint a
// launch token")` is the regression test for exactly that. See ADR 53.
import { createHmac, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { AI_EVENT_SKEW_SEC, AI_NONCE_TTL_SEC } from "@/lib/ai-defaults";
import {
  AI_KEY_PREFIX,
  decodeTokenUnverified,
  generateLaunchKeyPair,
  generateSigningKey,
  launchKeyId,
  signEventBody,
  signLaunchToken,
  verifyEventSignature,
  verifyLaunchToken,
  withinSkew,
  type AiTokenClaims,
} from "@/lib/ai-token";

const KEY = "aik_test-key-one";
const OTHER_KEY = "aik_test-key-two";
const NOW = 1_756_636_800; // 2026-08-31T12:00:00Z
const AUD = "prompt-leak-ab12cd";

// One keypair for the whole file: generating Ed25519 pairs is cheap, but the
// tests that matter are about which HALF is used, not about freshness.
const PAIR = generateLaunchKeyPair();
const OTHER_PAIR = generateLaunchKeyPair();

function claims(over: Partial<AiTokenClaims> = {}): AiTokenClaims {
  return {
    iss: "https://ctf.example.com",
    sub: "alice",
    aud: AUD,
    iat: NOW,
    exp: NOW + 3600,
    jti: "nonce-1",
    ctf: {
      module: "ai",
      challenge: { id: AUD, title: "Prompt leak", points: 300 },
      points: 300,
      progress: [{ id: AUD, points: 300, solved: true, solvedAt: "2026-08-31T11:00:00.000Z" }],
    },
    ...over,
  };
}

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8").toString("base64url");

/** A compact JWS in exactly the shape the OLD code minted: HS256, keyed by a
 *  challenge's symmetric EVENT key. This is what a key-holding backend can
 *  build today, and it is what must not authorize a launch. */
function hs256Token(c: AiTokenClaims, key: string): string {
  const signingInput = `${b64({ alg: "HS256", typ: "JWT", kid: c.aud })}.${b64(c)}`;
  const sig = createHmac("sha256", key).update(signingInput, "utf8").digest().toString("base64url");
  return `${signingInput}.${sig}`;
}

describe("event signing keys", () => {
  it("mints prefixed, high-entropy, distinct keys", () => {
    const a = generateSigningKey();
    const b = generateSigningKey();
    expect(a.startsWith(AI_KEY_PREFIX)).toBe(true);
    expect(a.length).toBeGreaterThan(40);
    expect(a).not.toBe(b);
  });
});

describe("launch keypairs", () => {
  it("mints a distinct Ed25519 PEM pair each time", () => {
    expect(PAIR.privateKey).toContain("BEGIN PRIVATE KEY");
    expect(PAIR.publicKey).toContain("BEGIN PUBLIC KEY");
    // The private PEM must not simply CONTAIN the public one — a pair where the
    // "private" half is the public key would sign nothing and verify everything.
    expect(PAIR.privateKey).not.toBe(PAIR.publicKey);
    expect(generateLaunchKeyPair().privateKey).not.toBe(PAIR.privateKey);
  });

  it("gives a keypair a stable kid and a rotated pair a different one", () => {
    expect(launchKeyId(PAIR.publicKey)).toBe(launchKeyId(PAIR.publicKey));
    expect(launchKeyId(OTHER_PAIR.publicKey)).not.toBe(launchKeyId(PAIR.publicKey));
    expect(launchKeyId(PAIR.publicKey)).toHaveLength(16);
  });
});

describe("launch token round trip", () => {
  it("verifies, with the PUBLIC key alone, a token the private key signed", () => {
    const res = verifyLaunchToken(signLaunchToken(claims(), PAIR.privateKey), PAIR.publicKey, {
      audience: AUD,
      nowSec: NOW,
    });
    expect(res).toEqual({ ok: true, claims: claims() });
  });

  it("announces EdDSA and the key's own kid in the header", () => {
    const [header] = signLaunchToken(claims(), PAIR.privateKey).split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toEqual({
      alg: "EdDSA",
      typ: "JWT",
      kid: launchKeyId(PAIR.publicKey),
    });
  });

  it("cannot be signed with the public half — publishing it must not grant minting", () => {
    // The single most important property of the split: the key an integrator is
    // GIVEN can check a token and can produce none.
    expect(() => signLaunchToken(claims(), PAIR.publicKey)).toThrow();
    expect(typeof signLaunchToken(claims(), PAIR.privateKey)).toBe("string");
  });

  it("rejects a token signed by another box's launch key", () => {
    const token = signLaunchToken(claims(), OTHER_PAIR.privateKey);
    expect(verifyLaunchToken(token, PAIR.publicKey, { audience: AUD, nowSec: NOW })).toEqual({
      ok: false,
      error: "invalid-signature",
    });
    expect(verifyLaunchToken(token, OTHER_PAIR.publicKey, { audience: AUD, nowSec: NOW }).ok).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const [header, payload, sig] = signLaunchToken(claims(), PAIR.privateKey).split(".");
    const forged = b64({ ...claims(), sub: "mallory" });
    expect(forged).not.toBe(payload);
    expect(verifyLaunchToken(`${header}.${forged}.${sig}`, PAIR.publicKey, { audience: AUD, nowSec: NOW })).toEqual({
      ok: false,
      error: "invalid-signature",
    });
  });

  it("rejects a truncated signature without throwing on the malformed blob", () => {
    const token = signLaunchToken(claims(), PAIR.privateKey);
    expect(verifyLaunchToken(token.slice(0, -4), PAIR.publicKey, { audience: AUD, nowSec: NOW })).toEqual({
      ok: false,
      error: "invalid-signature",
    });
  });

  it("rejects an expired token", () => {
    const token = signLaunchToken(claims({ exp: NOW - 1 }), PAIR.privateKey);
    expect(verifyLaunchToken(token, PAIR.publicKey, { audience: AUD, nowSec: NOW })).toEqual({
      ok: false,
      error: "expired",
    });
  });

  it("rejects a token minted for another challenge", () => {
    const token = signLaunchToken(claims(), PAIR.privateKey);
    expect(verifyLaunchToken(token, PAIR.publicKey, { audience: "guardrail-cd34ef", nowSec: NOW })).toEqual({
      ok: false,
      error: "audience",
    });
  });

  it("refuses every token when the caller omits the audience, rather than accepting any", () => {
    // ONE launch key covers the whole module, so `aud` is the only thing
    // separating a token for challenge A from one for challenge B. An
    // unauthenticated route that forgot the argument would otherwise accept a
    // token the contestant legitimately holds for a challenge they never opened.
    const token = signLaunchToken(claims(), PAIR.privateKey);
    const noAudience = {} as unknown as { audience: string };
    expect(verifyLaunchToken(token, PAIR.publicKey, noAudience)).toEqual({ ok: false, error: "audience" });
    expect(verifyLaunchToken(token, PAIR.publicKey, { audience: "", nowSec: NOW })).toEqual({
      ok: false,
      error: "audience",
    });
    expect(verifyLaunchToken(token, PAIR.publicKey, { audience: AUD, nowSec: NOW }).ok).toBe(true);
  });

  it("rejects garbage", () => {
    expect(verifyLaunchToken("not-a-token", PAIR.publicKey, { audience: AUD, nowSec: NOW })).toEqual({
      ok: false,
      error: "malformed",
    });
  });

  it("decodes without verifying, the way a keyless static SPA does", () => {
    expect(decodeTokenUnverified(signLaunchToken(claims(), OTHER_PAIR.privateKey))?.sub).toBe("alice");
    expect(decodeTokenUnverified("garbage")).toBeNull();
  });
});

describe("the event key cannot mint a launch token", () => {
  // The regression test for the hole this whole design closes. While both
  // signatures used one symmetric key, ANY holder of a challenge's event key
  // could mint a launch token naming any `sub`, and a route that trusted
  // `claims.sub` would award points to a user who never opened the challenge.
  it("refuses an HS256 token forged with a challenge's event key", () => {
    const forged = hs256Token(claims({ sub: "mallory" }), KEY);
    // It is a well-formed JWT and it decodes...
    expect(decodeTokenUnverified(forged)?.sub).toBe("mallory");
    // ...and it authorizes nothing.
    expect(verifyLaunchToken(forged, PAIR.publicKey, { audience: AUD, nowSec: NOW })).toEqual({
      ok: false,
      error: "invalid-signature",
    });
    // Anti-vacuous: the same claims, signed by the box, DO verify — so the
    // refusal above is about the key, not about the fixture.
    expect(verifyLaunchToken(signLaunchToken(claims({ sub: "mallory" }), PAIR.privateKey), PAIR.publicKey, {
      audience: AUD,
      nowSec: NOW,
    }).ok).toBe(true);
  });

  it("refuses to treat a symmetric event key as launch key material at all", () => {
    // Not `{ ok: false }` — a THROW. Handing an HMAC key to the launch verifier
    // is a caller bug, and the failure it would hide (an HMAC path quietly
    // reappearing beside the Ed25519 one) is the hole coming back.
    const forged = hs256Token(claims(), KEY);
    expect(() => verifyLaunchToken(forged, KEY, { audience: AUD, nowSec: NOW })).toThrow();
    expect(() => signLaunchToken(claims(), KEY)).toThrow();
  });

  it("ignores the header's alg — an EdDSA claim over an HMAC signature proves nothing", () => {
    // Algorithm confusion, run in the only direction that matters here: the
    // header SAYS EdDSA, the signature is an HMAC under the event key. If
    // verification ever picked its algorithm from the header, this passes.
    const c = claims({ sub: "mallory" });
    const signingInput = `${b64({ alg: "EdDSA", typ: "JWT", kid: launchKeyId(PAIR.publicKey) })}.${b64(c)}`;
    const sig = createHmac("sha256", KEY).update(signingInput, "utf8").digest().toString("base64url");
    expect(verifyLaunchToken(`${signingInput}.${sig}`, PAIR.publicKey, { audience: AUD, nowSec: NOW })).toEqual({
      ok: false,
      error: "invalid-signature",
    });
  });

  it("refuses an `alg: none` token with an empty signature", () => {
    const signingInput = `${b64({ alg: "none", typ: "JWT" })}.${b64(claims())}`;
    // A three-part token whose signature segment is empty is malformed by the
    // split alone; one with junk in it fails the signature check.
    expect(verifyLaunchToken(`${signingInput}.`, PAIR.publicKey, { audience: AUD, nowSec: NOW })).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(verifyLaunchToken(`${signingInput}.AA`, PAIR.publicKey, { audience: AUD, nowSec: NOW })).toEqual({
      ok: false,
      error: "invalid-signature",
    });
  });

  it("refuses a launch key of the wrong asymmetric type", () => {
    // ES256 material where Ed25519 is expected. Asserted against the KEY, not
    // the token's header, because a header is attacker-controlled.
    const ec = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const token = signLaunchToken(claims(), PAIR.privateKey);
    expect(() => verifyLaunchToken(token, ec.publicKey, { audience: AUD, nowSec: NOW })).toThrow(/Ed25519/i);
    expect(() => signLaunchToken(claims(), ec.privateKey)).toThrow(/Ed25519/i);
    expect(() => launchKeyId(ec.publicKey)).toThrow(/Ed25519/i);
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

  it("stays symmetric — the launch private key is not what signs an event", () => {
    // The other half of the split: the event path never gained an asymmetric
    // key it would have to distribute, and the launch key never gained a second
    // job. A backend verifies its own event signature with the key it holds.
    expect(verifyEventSignature(KEY, NOW, body, signEventBody(KEY, NOW, body))).toBe(true);
    expect(signEventBody(KEY, NOW, body)).not.toContain(PAIR.privateKey);
  });
});

describe("empty or missing key material", () => {
  // `createHmac('sha256', '')` does NOT throw — it returns a perfectly valid
  // digest over a key anyone can guess, so a signature made with "" verifies.
  // `AdminAiChallenge.signingKey` really is "" for a legacy keyless row, so this
  // input can reach here. Each throw sits next to the same call with a real key,
  // which must still work.
  const body = '{"token":"x"}';

  it("makes signLaunchToken throw instead of minting a forgeable token", () => {
    expect(() => signLaunchToken(claims(), "")).toThrow(/launch private key/i);
    expect(() => signLaunchToken(claims(), undefined as unknown as string)).toThrow(/launch private key/i);
    expect(typeof signLaunchToken(claims(), PAIR.privateKey)).toBe("string");
  });

  it("makes verifyLaunchToken throw rather than report a routine 'invalid-signature'", () => {
    const token = signLaunchToken(claims(), PAIR.privateKey);
    expect(() => verifyLaunchToken(token, "", { audience: AUD, nowSec: NOW })).toThrow(/launch public key/i);
    expect(() => verifyLaunchToken(token, null as unknown as string, { audience: AUD })).toThrow(/launch public key/i);
    expect(verifyLaunchToken(token, PAIR.publicKey, { audience: AUD, nowSec: NOW }).ok).toBe(true);
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

  it("refuses a missing event key as firmly as an empty string", () => {
    expect(() => signEventBody(undefined as unknown as string, NOW, body)).toThrow(/signing key/i);
    expect(() => verifyEventSignature(null as unknown as string, NOW, body, "sha256=aa")).toThrow(/signing key/i);
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

  it("stays acceptable for a full 2*skew after a maximally future-skewed event is first seen — the nonce TTL has to outlast that", () => {
    // The widest replay window the pair of constants can produce: an event
    // stamped a full skew in the FUTURE is accepted the moment it arrives...
    const ts = NOW + AI_EVENT_SKEW_SEC;
    expect(withinSkew(ts, NOW)).toBe(true);
    // ...and is STILL inside its own window a further skew later.
    const lastAcceptable = ts + AI_EVENT_SKEW_SEC;
    expect(withinSkew(ts, lastAcceptable)).toBe(true);
    expect(withinSkew(ts, lastAcceptable + 1)).toBe(false);
    // So the nonce claimed at NOW must still be remembered at `lastAcceptable`.
    // A TTL of exactly 2 * skew expires it AT that second, leaving the captured
    // request replayable in the gap.
    expect(NOW + AI_NONCE_TTL_SEC).toBeGreaterThan(lastAcceptable);
  });
});
