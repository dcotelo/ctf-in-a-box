// The proxy's matcher against the module registry.
//
// Next requires `config.matcher` to be a static literal — "matcher values need
// to be constants so they can be statically analyzed at build-time. Dynamic
// values such as variables will be ignored" (the vendored proxy docs) — so it
// cannot be computed from the registry, and the two can drift. They did: the
// matcher listed /challenges only, so on a quiz-only event the pre-event gate
// ran on no module route at all and the "access password" screen protected
// nothing.
//
// This is the check that keeps a newly registered module from being silently
// un-gated: a route in `ALL_MODULE_ROUTES` that the matcher does not carry
// fails here.
//
// It is HALF the contract, and only half: the matcher decides where the proxy
// RUNS, never what it then does. `proxy-quiz-only.test.ts` and
// `proxy-disabled-module.test.ts` call `proxy()` and pin the decision itself —
// without them, reverting the gate check to `pathname === "/challenges"` left
// this file (and the whole suite) green.

import { describe, expect, it } from "vitest";
import { config } from "@/proxy";
import { ALL_MODULE_ROUTES } from "@/lib/modules";

describe("the proxy matcher", () => {
  it("covers every module route the registry knows about", () => {
    const missing = ALL_MODULE_ROUTES.filter((route) => !config.matcher.includes(route));
    expect(missing).toEqual([]);
  });

  it("still covers /profile", () => {
    expect(config.matcher).toContain("/profile");
  });

  it("carries nothing the registry and the platform don't own", () => {
    // "/api/:path*" is the platform's, not a module's: it is what puts the
    // mutating-route origin assertion in front of every API route at once.
    // Named explicitly so this stays a real guard against an unknown page
    // route sneaking in, rather than being relaxed into one that permits
    // anything.
    const known = new Set<string>([...ALL_MODULE_ROUTES, "/profile", "/api/:path*"]);
    expect(config.matcher.filter((route) => !known.has(route))).toEqual([]);
  });

  // The origin assertion is only reachable on routes the matcher covers. A
  // matcher that lost this entry would leave every route handler running
  // exactly as before, with no test failing anywhere near the check itself.
  it("covers the API routes the origin assertion defends", () => {
    expect(config.matcher).toContain("/api/:path*");
  });
});
