// Issue #357. The refusal copy already named the fix ("set one up on your
// profile"), and that was still a dead end for the population that actually
// hit it: an organizer learned the rule from a solve that did not count. What
// this component has to do is arrive BEFORE the form and carry the one-click
// exit, so both are pinned here rather than left to review.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TeamlessNotice from "@/components/teamless-notice";
import { TEAM_SETUP_PATH } from "@/lib/post-signin";

describe("TeamlessNotice", () => {
  it("names Play solo, not just 'get a team'", () => {
    // The whole reason this exists: `team-card.tsx` has a one-click team of
    // one, and none of the no-team copy said so. "You need a team" without
    // the cheapest way to get one is the dead end the issue is about.
    expect(renderToStaticMarkup(<TeamlessNotice />)).toContain("Play solo");
  });

  it("links to the team card, fragment included", () => {
    const html = renderToStaticMarkup(<TeamlessNotice />);
    expect(html).toContain(`href="${TEAM_SETUP_PATH}"`);
    // The fragment is what lands the reader on the team card instead of the
    // top of a page of stats — the same reason redirectIfTeamless uses it.
    expect(TEAM_SETUP_PATH).toContain("#team");
  });

  it("says the submissions are refused, not that the page is blocked", () => {
    // An organizer reading this can still browse everything; overstating it as
    // "you cannot use this page" would be false and would read as breakage.
    const html = renderToStaticMarkup(<TeamlessNotice />);
    expect(html).toContain("nothing below is blocked");
    expect(html).toContain("refused");
  });

  it("takes the module's own word for what gets submitted", () => {
    // quiz submits answers, the flag boards submit solves. One hardcoded noun
    // would be wrong on one of them.
    expect(renderToStaticMarkup(<TeamlessNotice what="answers" />)).toContain("answers submitted");
    expect(renderToStaticMarkup(<TeamlessNotice what="solves" />)).toContain("solves submitted");
  });
});
