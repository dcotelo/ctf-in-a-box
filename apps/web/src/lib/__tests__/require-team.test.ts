// The page-level half of the team requirement (issue #153). The API routes are
// the boundary that actually holds — a direct POST never sees a page — so what
// matters here is that the redirect fires for exactly the people it should and
// nobody else.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasTeam: vi.fn<(login: string) => Promise<boolean>>(),
  redirect: vi.fn((path: string) => {
    // The real `redirect()` throws a framework control-flow signal rather than
    // returning, and callers rely on nothing after it running. Throwing here
    // keeps that shape, so a test can't pass because execution continued in a
    // way it never would in production.
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/team-store", () => ({ hasTeam: mocks.hasTeam }));

import { redirectIfTeamless, TEAM_SETUP_PATH } from "@/lib/require-team";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("redirectIfTeamless", () => {
  it("sends a signed-in contestant with no team to team setup", async () => {
    mocks.hasTeam.mockResolvedValue(false);
    await expect(redirectIfTeamless("octocat")).rejects.toThrow(`REDIRECT:${TEAM_SETUP_PATH}`);
  });

  it("lands them ON the team card, not at the top of the profile", async () => {
    // Without the fragment a redirected contestant arrives at a page of stats
    // with no indication of why they were moved.
    expect(TEAM_SETUP_PATH).toContain("#team");
  });

  it("leaves a contestant who has a team alone", async () => {
    mocks.hasTeam.mockResolvedValue(true);
    await expect(redirectIfTeamless("octocat")).resolves.toBeUndefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("lets a signed-out visitor browse, without asking the store", async () => {
    // A visitor is not yet a contestant, and bouncing them to a profile page
    // they cannot see is worse than the sign-in prompt the page renders.
    await expect(redirectIfTeamless(undefined)).resolves.toBeUndefined();
    expect(mocks.hasTeam).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("lets an admin through without a team, and without asking the store", async () => {
    // An organizer opening a module page to check their content renders is not
    // playing. Not a scoring hole: an admin who actually submits still meets
    // the route gate, because an admin's points fold into no team either.
    await expect(redirectIfTeamless("octocat", { isAdmin: true })).resolves.toBeUndefined();
    expect(mocks.hasTeam).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("inherits hasTeam's fail-open answer instead of herding everyone to /profile", async () => {
    // `hasTeam` swallows a store failure and answers true. Pinned from this
    // side too: a Redis blip mid-event must not redirect every contestant off
    // the page they are playing on.
    mocks.hasTeam.mockResolvedValue(true);
    await expect(redirectIfTeamless("octocat")).resolves.toBeUndefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
