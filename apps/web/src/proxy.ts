import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { GATE_COOKIE, isGateActive, verifyGateCookie } from "@/lib/gate";
import { ALL_MODULE_ROUTES } from "@/lib/modules";
import { MUTATING_METHODS, originAllowed } from "@/lib/origin";

/** The routes the pre-event gate stands in front of: every module route the
 *  registry knows about, **enabled or not**.
 *
 *  A gate that only knows one module's route protects nothing on an event
 *  running any other one — a quiz-only event shipped an "access password"
 *  screen with /quiz wide open behind it. Derived from the registry, so a
 *  module gets gated by being registered rather than by someone remembering
 *  to add it here.
 *
 *  It gates the FULL registry rather than the enabled subset because
 *  enablement became a runtime setting (issue #175), and this file is
 *  middleware: it runs on every matched request, and `gate.ts` is deliberately
 *  held to `node:crypto` so `next/headers` can never become reachable from
 *  here (see gate-request.ts). Reading Redis to decide which routes to gate
 *  would put a network call on that path and hand the gate a dependency that
 *  can fail — to protect a module that, if the read failed, would be left
 *  wide open. Gating the superset needs no read at all.
 *
 *  Gating a route whose module is switched off costs nothing: the page 404s on
 *  its own either way, and pre-event the lock screen is what a visitor should
 *  see regardless. It also stops the gate leaking which modules an event is
 *  running before it starts. And it cannot loop — `/gate`'s own redirect keys
 *  off `isGateActive()` and the cookie, never off this set, so a gated route
 *  that 404s after unlocking is a 404, not a bounce. */
const GATED_ROUTES = new Set(ALL_MODULE_ROUTES);

/** better-auth's own endpoints, which run their own origin check against
 *  their own `trustedOrigins` config. Left alone deliberately: the OAuth flow
 *  involves requests this proxy has no business adjudicating, and two
 *  independent origin policies on one route is how a sign-in breaks in a way
 *  nobody can find. */
const AUTH_PREFIX = "/api/auth";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // CSRF assertion for the app's own mutating API routes. Enforced HERE, in
  // one place, rather than as a call at the top of each route handler: there
  // are eighteen of them, and the failure mode of the per-route version is a
  // new route that simply forgets. The matcher below carries `/api/:path*` so
  // this cannot be reached by adding a file.
  if (pathname.startsWith("/api/") && !pathname.startsWith(AUTH_PREFIX) && MUTATING_METHODS.has(request.method)) {
    if (!originAllowed({ origin: request.headers.get("origin"), configuredUrl: process.env.BETTER_AUTH_URL })) {
      return NextResponse.json({ error: "cross-origin request refused" }, { status: 403 });
    }
  }

  // Pre-event gate: no valid signed unlock cookie → the lock screen. 307 on
  // purpose — a cached permanent redirect would keep bouncing after the gate
  // is switched off. /gate itself redirects back on the exact complement of
  // this condition, so the pair can never loop.
  if (GATED_ROUTES.has(pathname)) {
    if (isGateActive() && !verifyGateCookie(request.cookies.get(GATE_COOKIE)?.value)) {
      return NextResponse.redirect(new URL("/gate", request.url));
    }
    return NextResponse.next();
  }

  // /profile: optimistic redirect only — the cookie's presence is checked,
  // not its validity. The real gate is auth.api.getSession() inside the page.
  //
  // Matched EXPLICITLY rather than as the fallthrough it used to be: the
  // matcher below now also carries module routes that this event may not have
  // enabled, and treating any of those as /profile would bounce a signed-out
  // visitor off a public page.
  if (pathname === "/profile") {
    if (!getSessionCookie(request)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }
  return NextResponse.next();
}

// Static literal, and it has to be: "matcher values need to be constants so
// they can be statically analyzed at build-time. Dynamic values such as
// variables will be ignored" (the vendored proxy docs). So this cannot be
// computed from the registry — it lists EVERY module route the registry knows
// about, enabled or not, and `proxy.test.ts` asserts it covers
// `ALL_MODULE_ROUTES`. A route in here that this event doesn't enable simply
// falls through to `next()` and 404s on its own, as it did before.
// `/api/:path*` carries the origin assertion above. It is a path PATTERN
// rather than a literal route, so it is not part of the registry contract
// `proxy.test.ts` checks — that test compares the literal module routes and
// would otherwise read this as an unknown extra.
export const config = {
  matcher: ["/profile", "/challenges", "/quiz", "/flags", "/api/:path*"],
};
