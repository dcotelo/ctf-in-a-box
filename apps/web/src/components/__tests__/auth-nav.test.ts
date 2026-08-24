// Sign-out landing rules. Signing out used to router.refresh() in place
// unconditionally, so doing it from /admin re-rendered the "Forbidden" wall
// and from /profile the sign-in prompt — an error-shaped screen for a
// perfectly normal action. signOutDestination decides: home from a
// session-gated page, stay put (null = refresh) from a public one.
//
// Tested as the exported pure function: the click handler is client state a
// static render cannot drive (no testing-library in this repo, by choice).

import { describe, expect, it } from "vitest";
import { signOutDestination } from "@/components/auth-nav";

describe("signOutDestination", () => {
  it("sends session-gated pages home, including their subpaths", () => {
    expect(signOutDestination("/admin")).toBe("/");
    expect(signOutDestination("/profile")).toBe("/");
    expect(signOutDestination("/admin/anything")).toBe("/");
  });

  it("stays put on public pages — a refresh just re-renders them signed out", () => {
    expect(signOutDestination("/")).toBeNull();
    expect(signOutDestination("/flags")).toBeNull();
    expect(signOutDestination("/flags/crypto-1")).toBeNull();
    expect(signOutDestination("/leaderboard")).toBeNull();
    expect(signOutDestination("/quiz")).toBeNull();
  });

  it("matches whole path segments, not raw prefixes", () => {
    // A hypothetical public /profiles or /administrivia must not redirect.
    expect(signOutDestination("/profiles")).toBeNull();
    expect(signOutDestination("/administrivia")).toBeNull();
  });
});
