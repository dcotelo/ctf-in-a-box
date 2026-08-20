// Pre-event gate for /challenges: flag + password from env, and the signed
// unlock cookie. The password is only ever compared server-side (POST
// /api/gate) so there is nothing client-side to brute-force offline; the
// cookie is HMAC-signed with BETTER_AUTH_SECRET so it can't be forged.
//
// Deliberately imports ONLY node:crypto at the top level — this module is
// bundled into the proxy (Node runtime), so no "server-only" marker and no
// Upstash client here. `requireGatePassed()` below imports "next/headers",
// but only route handlers (never proxy.ts) call it, so the proxy bundle
// never exercises that path.

import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

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

/**
 * Server-side pre-event gate check for a module API route (as opposed to
 * `proxy.ts`, which only covers page routes — see docs/modules.md §5.8).
 * A route calls this beside the gates it already runs (`effectivePaused`,
 * attempt caps, cooldowns): after authentication (so an unauthenticated
 * caller still gets the more specific 401) and before any store read or
 * write, so a refusal here can never follow a write that already happened.
 *
 * Route handlers get a plain `Request`, not a `NextRequest`, so there is no
 * `request.cookies` the way `proxy.ts` reads it. `cookies()` from
 * "next/headers" is the documented way to read an incoming cookie inside a
 * Route Handler in this Next version — and it is async here (cookies() was
 * synchronous through Next 14; Next 15+ made it a Promise, back-compat
 * notwithstanding) per node_modules/next/dist/docs/01-app/03-api-reference/
 * 04-functions/cookies.md.
 *
 * `isGateActive()` is a module-load env read and `verifyGateCookie` is pure
 * crypto — neither one does I/O, so unlike the store-backed gates this sits
 * beside, there is no fail-open/fail-closed question to make here: nothing
 * in this check can error mid-request.
 */
export async function requireGatePassed(): Promise<boolean> {
  if (!isGateActive()) return true;
  const store = await cookies();
  return verifyGateCookie(store.get(GATE_COOKIE)?.value);
}
