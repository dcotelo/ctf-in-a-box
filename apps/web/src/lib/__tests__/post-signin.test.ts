// Pure decision logic for the first-login team steering (issue #217). The
// route handler's own test covers the wiring; this pins the sanitizer (the
// `next` parameter is attacker-influencable) and the branch matrix.
import { describe, expect, it } from "vitest";

import {
  POST_SIGNIN_PATH,
  TEAM_SETUP_PATH,
  postSigninCallbackURL,
  resolvePostSigninTarget,
  sanitizeNext,
} from "@/lib/post-signin";

describe("postSigninCallbackURL", () => {
  it("routes through the post-signin path with the intent encoded", () => {
    expect(postSigninCallbackURL("/quiz")).toBe(`${POST_SIGNIN_PATH}?next=%2Fquiz`);
  });

  it("round-trips a path that itself carries a query or fragment", () => {
    const url = postSigninCallbackURL("/profile#team");
    const next = new URL(`http://x${url}`).searchParams.get("next");
    expect(next).toBe("/profile#team");
  });
});

describe("sanitizeNext", () => {
  it("keeps a same-origin path", () => {
    expect(sanitizeNext("/flags")).toBe("/flags");
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["https://evil.example/"],
    ["//evil.example/"],
    ["/\\evil.example/"],
    ["quiz"],
  ])("falls back to /profile for %j", (raw) => {
    expect(sanitizeNext(raw as string | null | undefined)).toBe("/profile");
  });
});

describe("resolvePostSigninTarget", () => {
  it("sends a teamless contestant to team setup, not their destination", () => {
    expect(resolvePostSigninTarget({ next: "/quiz", isAdmin: false, teamless: true })).toBe(
      TEAM_SETUP_PATH,
    );
  });

  it("lets a teamed contestant through to their destination", () => {
    expect(resolvePostSigninTarget({ next: "/quiz", isAdmin: false, teamless: false })).toBe("/quiz");
  });

  it("lets an admin through even when teamless — checking content is not playing", () => {
    expect(resolvePostSigninTarget({ next: "/admin", isAdmin: true, teamless: true })).toBe("/admin");
  });

  it("passes a /join/<code> invite through even when teamless — the invite IS the team step", () => {
    expect(resolvePostSigninTarget({ next: "/join/ab12cd", isAdmin: false, teamless: true })).toBe(
      "/join/ab12cd",
    );
  });
});
