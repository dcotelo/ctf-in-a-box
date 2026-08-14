// Pre-event gate for /challenges: flag + password from env, and the signed
// unlock cookie. The password is only ever compared server-side (POST
// /api/gate) so there is nothing client-side to brute-force offline; the
// cookie is HMAC-signed with BETTER_AUTH_SECRET so it can't be forged.
//
// Deliberately imports ONLY node:crypto — this module is bundled into the
// proxy (Node runtime), so no "server-only" marker and no DynamoDB here.

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export const GATE_COOKIE = "ctf-challenges-gate";
/** Unlock lifetime; the gate itself is expected to be switched off at the
 *  conference start, which makes any outstanding cookie inert. */
export const GATE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

// Module-load reads, the TEAM_WRITES_ENABLED idiom — static per deployment.
const GATE_ENABLED = process.env.CHALLENGES_GATE_ENABLED === "true";
const GATE_PASSWORD = process.env.CHALLENGES_GATE_PASSWORD ?? "";
const SECRET = process.env.BETTER_AUTH_SECRET ?? "";

/** Domain separation so this HMAC use of BETTER_AUTH_SECRET can never collide
 *  with better-auth's own cookie signatures. */
const SIGNING_CONTEXT = "ctf-challenges-gate.v1.";

/** The gate only engages when explicitly enabled AND a password AND the
 *  signing secret exist — a half-configured gate stays open rather than
 *  locking everyone out with an unanswerable prompt. */
export function isGateActive(): boolean {
  return GATE_ENABLED && GATE_PASSWORD.length > 0 && SECRET.length > 0;
}

function signature(expEpochMs: number): string {
  return createHmac("sha256", SECRET).update(`${SIGNING_CONTEXT}${expEpochMs}`).digest("hex");
}

/** Cookie value: "v1.<expiry epoch ms>.<hex hmac>". */
export function signGateCookie(expEpochMs: number): string {
  return `v1.${expEpochMs}.${signature(expEpochMs)}`;
}

export function verifyGateCookie(value: string | undefined): boolean {
  if (!value) return false;
  const [version, expRaw, sig] = value.split(".");
  if (version !== "v1" || !expRaw || !sig) return false;
  const exp = Number(expRaw);
  if (!Number.isSafeInteger(exp) || exp <= Date.now()) return false;
  const expected = Buffer.from(signature(exp), "hex");
  const actual = Buffer.from(sig, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Constant-time password check; hashing both sides first sidesteps
 *  timingSafeEqual's equal-length requirement. */
export function verifyGatePassword(candidate: string): boolean {
  if (!GATE_PASSWORD) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(GATE_PASSWORD).digest();
  return timingSafeEqual(a, b);
}
