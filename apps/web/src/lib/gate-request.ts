import "server-only";
import { cookies } from "next/headers";
import { GATE_COOKIE, isGateActive, verifyGateCookie } from "@/lib/gate";

/**
 * Server-side pre-event gate check for a module API route (as opposed to
 * `proxy.ts`, which only covers page routes — see docs/modules.md §5.8).
 * A route calls this beside the gates it already runs (`effectivePaused`,
 * attempt caps, cooldowns): after authentication (so an unauthenticated
 * caller still gets the more specific 401) and before any store read or
 * write, so a refusal here can never follow a write that already happened.
 *
 * Deliberately split out of `@/lib/gate` rather than added there: `gate.ts`
 * is imported by `proxy.ts` (the Node-runtime middleware) and is kept to
 * `node:crypto` only so that stays true structurally, not by convention —
 * a `next/headers` import anywhere in that module's graph would make
 * `cookies()` reachable from the proxy, where it isn't called inside a
 * request scope and throws at runtime. This file carries its own
 * `"server-only"` marker and the `next/headers` import instead, and is
 * never imported by `proxy.ts`.
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
