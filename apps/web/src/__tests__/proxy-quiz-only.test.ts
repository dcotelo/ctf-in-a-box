// What the proxy DOES on a quiz-only event — the behaviour half of the
// matcher check in `proxy.test.ts`.
//
// That file only ever imported `config`. It never called `proxy()`, so the
// entire fix it was written alongside — gating `enabledModuleRoutes` instead
// of a hardcoded `/challenges` — was ungated: reverting the check to
// `pathname === "/challenges"` left the whole suite green while a quiz-only
// event shipped an "access password" screen with /quiz wide open behind it.
// A matcher that carries a route proves only that the proxy RUNS on it; this
// file proves what it then does.
//
// The gate must be ACTIVE for any of this to be observable, so the env is
// stubbed before the module graph loads — `@/lib/gate` reads it once, at
// import. Own file for the usual `vi.mock` hoisting reason: the event config
// decides which routes are gated, and it is baked at import.
import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GATE_COOKIE, signGateCookie } from "@/lib/gate";

const mocks = vi.hoisted(() => {
  process.env.CHALLENGES_GATE_ENABLED = "true";
  process.env.CHALLENGES_GATE_PASSWORD = "open-sesame";
  process.env.BETTER_AUTH_SECRET = "test-secret";
  return { getSessionCookie: vi.fn(() => null as string | null) };
});

vi.mock("better-auth/cookies", () => ({ getSessionCookie: mocks.getSessionCookie }));
vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    name: "Quiz Night",
    theme: "",
    dates: "",
    location: "",
    ctfStartsAt: null,
    url: "http://localhost:3000",
    contactEmail: "",
    githubOrg: "OWASP-CTF",
    discordUrl: "",
    modules: [{ id: "quiz" }],
    targets: [],
    admins: [],
  },
}));

import { proxy } from "@/proxy";

/** The slice of NextRequest the proxy actually reads. */
function request(pathname: string, gateCookie?: string): NextRequest {
  const url = new URL(pathname, "http://localhost:3000");
  return {
    nextUrl: url,
    url: url.toString(),
    cookies: {
      get: (name: string) =>
        name === GATE_COOKIE && gateCookie ? { name, value: gateCookie } : undefined,
    },
  } as unknown as NextRequest;
}

/** Where the proxy sent this request, or `null` when it let it through. */
function destination(pathname: string, gateCookie?: string): string | null {
  const res = proxy(request(pathname, gateCookie));
  const location = res.headers.get("location");
  return location ? new URL(location).pathname : null;
}

describe("the proxy on a quiz-only event", () => {
  it("sends a locked-out visitor from the enabled module's route to /gate", () => {
    expect(destination("/quiz")).toBe("/gate");
  });

  it("redirects with a 307, not a cacheable permanent redirect", () => {
    expect(proxy(request("/quiz")).status).toBe(307);
  });

  it("lets a visitor holding a valid unlock cookie through", () => {
    const unlocked = signGateCookie(Date.now() + 60_000);
    expect(destination("/quiz", unlocked)).toBeNull();
  });

  it("does not treat a gated module route as /profile when signed out", () => {
    // The signed-out session is what the /profile branch keys on: if the
    // module route ever fell through to it, this would redirect to "/".
    mocks.getSessionCookie.mockReturnValue(null);
    expect(destination("/quiz")).toBe("/gate");
  });

  it("still bounces a signed-out visitor off /profile", () => {
    mocks.getSessionCookie.mockReturnValue(null);
    expect(destination("/profile")).toBe("/");
  });

  it("leaves a signed-in visitor on /profile", () => {
    mocks.getSessionCookie.mockReturnValue("session-token");
    expect(destination("/profile")).toBeNull();
  });

  it("never gates /profile itself behind the lock screen", () => {
    mocks.getSessionCookie.mockReturnValue("session-token");
    expect(destination("/profile")).not.toBe("/gate");
  });
});
