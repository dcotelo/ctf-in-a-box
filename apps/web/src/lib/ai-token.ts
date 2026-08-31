// The ai module's identity boundary: a compact HS256 JWT minted per challenge
// page view, and the HMAC signature an external backend puts on a solve event.
//
// BOTH are keyed by the SAME per-challenge signing key, on purpose. A backend
// holding that key can verify the token it was handed (so it knows who is
// playing) and sign the events it sends back — one secret, both directions. A
// static SPA holds no key: it decodes the payload for display and can verify
// nothing, which is why `decodeTokenUnverified` is named the way it is.
//
// What the key does NOT buy its holder: the ability to name a user. Identity
// always comes from `sub` inside a token the BOX minted, so a leaked key can
// only assert solves for players who actually opened that challenge.
//
// Not `server-only`: this file is pure crypto over `node:crypto` with no store
// access, and the admin test route needs it. It must never import the store.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { AI_EVENT_SKEW_SEC } from "@/lib/ai-defaults";

export const AI_KEY_PREFIX = "aik_";

/** A fresh per-challenge signing key. 32 bytes of CSPRNG output — this one is
 *  a real secret (unlike a challenge id), so `Math.random` is not an option. */
export function generateSigningKey(): string {
  return `${AI_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export type AiTokenProgress = {
  id: string;
  points: number;
  solved: boolean;
  solvedAt: string | null;
};

export type AiTokenClaims = {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  ctf: {
    module: "ai";
    challenge: { id: string; title: string; points: number };
    points: number;
    progress: AiTokenProgress[];
    /** Present only when `progress` was capped at AI_PROGRESS_MAX. */
    truncated?: true;
  };
};

const HEADER = { alg: "HS256", typ: "JWT" } as const;

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

function hmac(key: string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** Constant-time compare that tolerates a length mismatch. `timingSafeEqual`
 *  THROWS on differing lengths, so a truncated signature would surface as a
 *  500 instead of a refusal — and the length itself is not a secret. */
function equalBytes(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function signToken(claims: AiTokenClaims, key: string): string {
  const signingInput = `${encode({ ...HEADER, kid: claims.aud })}.${encode(claims)}`;
  return `${signingInput}.${hmac(key, signingInput).toString("base64url")}`;
}

export type AiTokenCheck =
  | { ok: true; claims: AiTokenClaims }
  | { ok: false; error: "malformed" | "invalid-signature" | "expired" | "audience" };

/** Verifies a token against ONE challenge's key.
 *
 *  Order matters: signature first, then expiry, then audience. Reporting
 *  "expired" for a token we cannot authenticate would answer a question the
 *  caller has not earned an answer to. */
export function verifyToken(
  token: string,
  key: string,
  opts: { audience?: string; nowSec?: number } = {},
): AiTokenCheck {
  if (typeof token !== "string") return { ok: false, error: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return { ok: false, error: "malformed" };

  const expected = hmac(key, `${parts[0]}.${parts[1]}`);
  if (!equalBytes(Buffer.from(parts[2], "base64url"), expected)) {
    return { ok: false, error: "invalid-signature" };
  }

  const claims = decodeClaims(parts[1]);
  if (!claims) return { ok: false, error: "malformed" };

  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(claims.exp) || claims.exp <= nowSec) return { ok: false, error: "expired" };
  if (opts.audience !== undefined && claims.aud !== opts.audience) return { ok: false, error: "audience" };

  return { ok: true, claims };
}

/** What a static SPA can do: read the payload, trust nothing. Never call this
 *  on a path that awards anything. */
export function decodeTokenUnverified(token: string): AiTokenClaims | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  return decodeClaims(parts[1]);
}

function decodeClaims(segment: string): AiTokenClaims | null {
  try {
    const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const c = parsed as Record<string, unknown>;
    if (typeof c.sub !== "string" || typeof c.aud !== "string" || typeof c.jti !== "string") return null;
    if (typeof c.iat !== "number" || typeof c.exp !== "number") return null;
    return parsed as AiTokenClaims;
  } catch {
    return null;
  }
}

/** The signature an external backend puts on a solve event: HMAC over
 *  `<timestamp>.<raw body>`. The timestamp is INSIDE the signed material, so a
 *  captured request cannot be replayed later under a fresh header. */
export function signEventBody(key: string, tsSec: number, rawBody: string): string {
  return `sha256=${hmac(key, `${tsSec}.${rawBody}`).toString("hex")}`;
}

/** `rawBody` MUST be the exact bytes received. Re-serializing a parsed body
 *  before hashing changes whitespace and key order and breaks every real
 *  integrator. */
export function verifyEventSignature(key: string, tsSec: number, rawBody: string, header: string): boolean {
  if (typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const provided = Buffer.from(header.slice("sha256=".length), "hex");
  return equalBytes(provided, hmac(key, `${tsSec}.${rawBody}`));
}

/** Clock skew, enforced in BOTH directions — a future timestamp is as invalid
 *  as a stale one, or a signer with a fast clock mints requests that stay
 *  replayable after the nonce expires. */
export function withinSkew(tsSec: number, nowSec: number, skewSec: number = AI_EVENT_SKEW_SEC): boolean {
  if (!Number.isFinite(tsSec)) return false;
  return Math.abs(nowSec - tsSec) <= skewSec;
}
