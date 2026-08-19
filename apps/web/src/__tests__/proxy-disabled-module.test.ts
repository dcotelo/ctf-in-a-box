// The other side of the proxy's behaviour: a route the MATCHER carries but
// this event does not enable.
//
// `config.matcher` is a static literal listing every registry route, enabled
// or not (Next requires a constant there), so on a secure-development-only
// event the proxy still runs on /quiz. Two things must hold and neither left
// a trace in the old matcher-only test:
//
//   - a disabled module's route is NOT gated (there is nothing behind it to
//     protect; it 404s on its own, as it did before the matcher grew), and
//   - it must not be treated as /profile either. /profile used to be the
//     FALLTHROUGH, so widening the matcher silently turned every non-enabled
//     module route into a signed-out redirect to "/" — a public 404 became a
//     bounce to the landing page.
import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GATE_COOKIE } from "@/lib/gate";

const mocks = vi.hoisted(() => {
  process.env.CHALLENGES_GATE_ENABLED = "true";
  process.env.CHALLENGES_GATE_PASSWORD = "open-sesame";
  process.env.BETTER_AUTH_SECRET = "test-secret";
  return { getSessionCookie: vi.fn(() => null as string | null) };
});

vi.mock("better-auth/cookies", () => ({ getSessionCookie: mocks.getSessionCookie }));
vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    name: "OWASP CTF",
    theme: "",
    dates: "",
    location: "",
    ctfStartsAt: null,
    url: "http://localhost:3000",
    contactEmail: "",
    githubOrg: "OWASP-CTF",
    discordUrl: "",
    modules: [{ id: "secure-development", targets: ["juice-shop"] }],
    targets: ["juice-shop"],
    admins: [],
  },
}));

import { proxy } from "@/proxy";

function request(pathname: string): NextRequest {
  const url = new URL(pathname, "http://localhost:3000");
  return {
    nextUrl: url,
    url: url.toString(),
    cookies: { get: (name: string) => (name === GATE_COOKIE ? undefined : undefined) },
  } as unknown as NextRequest;
}

function destination(pathname: string): string | null {
  const location = proxy(request(pathname)).headers.get("location");
  return location ? new URL(location).pathname : null;
}

describe("the proxy on a secure-development-only event", () => {
  it("gates the enabled module's own route, as it always did", () => {
    expect(destination("/challenges")).toBe("/gate");
  });

  it("lets the disabled module's route through untouched", () => {
    mocks.getSessionCookie.mockReturnValue(null);
    expect(destination("/quiz")).toBeNull();
  });

  it("does not bounce a signed-out visitor off the disabled route", () => {
    mocks.getSessionCookie.mockReturnValue(null);
    expect(destination("/quiz")).not.toBe("/");
  });

  it("still bounces a signed-out visitor off /profile", () => {
    mocks.getSessionCookie.mockReturnValue(null);
    expect(destination("/profile")).toBe("/");
  });
});
