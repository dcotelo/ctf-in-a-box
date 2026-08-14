import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { GATE_COOKIE, isGateActive, verifyGateCookie } from "@/lib/gate";

export function proxy(request: NextRequest) {
  // Pre-event challenges gate: no valid signed unlock cookie → the lock
  // screen. 307 on purpose — a cached permanent redirect would keep bouncing
  // after the gate is switched off. /gate itself redirects back on the exact
  // complement of this condition, so the pair can never loop.
  if (request.nextUrl.pathname === "/challenges") {
    if (isGateActive() && !verifyGateCookie(request.cookies.get(GATE_COOKIE)?.value)) {
      return NextResponse.redirect(new URL("/gate", request.url));
    }
    return NextResponse.next();
  }

  // /profile: optimistic redirect only — the cookie's presence is checked,
  // not its validity. The real gate is auth.api.getSession() inside the page.
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/profile", "/challenges"],
};
