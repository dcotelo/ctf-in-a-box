import "server-only";

/**
 * The app's one trusted origin, for the launch token's `iss` claim —
 * NEVER the request's Host header, which a client fully controls. Two
 * existing checks already draw this same line for the same reason and this
 * follows them: `secure-url.ts` derives the session cookie's Secure flag from
 * `BETTER_AUTH_URL` alone (never a header), and `origin.ts`'s CSRF check
 * compares an incoming `Origin` against `new URL(BETTER_AUTH_URL).origin`,
 * again never inventing an expectation from the request itself.
 *
 * `BETTER_AUTH_URL` unset is a tolerated dev state, not an error, in both of
 * those: `secure-url.ts`'s own startup check passes it as `ok` outside
 * production, and `origin.ts` allows every request once there is "nothing to
 * compare against". A launch token still needs SOME string for `iss` — it is
 * never validated against anything server-side (`ai-token.ts`'s
 * `verifyLaunchToken` checks signature, expiry and audience; the external
 * integrator reads `iss` for its own logging) — so the safe answer here is
 * the shipped `.env.example` default's own origin, `http://localhost`, rather
 * than reading `headers()` for one.
 *
 * Shared by `ai/[id]/page.tsx` (the launch token's `iss`) and
 * `admin/ai/test/route.ts` (the Send test demo token's `iss`) — previously
 * two byte-identical copies of this function, one per call site.
 */
export function resolveOrigin(): string {
  const configured = process.env.BETTER_AUTH_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // A malformed BETTER_AUTH_URL is a config error, not a reason to fail
      // a page render — fall through to the dev default below.
    }
  }
  return "http://localhost";
}
