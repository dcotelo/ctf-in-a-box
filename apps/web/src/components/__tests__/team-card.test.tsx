// @testing-library/react is not a dependency of this repo and must not be
// added just for this test. TeamCard is a "use client" component but has no
// effects that run during a plain render, so renderToStaticMarkup is enough
// to check markup — same pattern as score-time-chart.test.tsx. useRouter is
// mocked since next/navigation's real hook needs a router context.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import TeamCard from "@/components/team-card";

describe("TeamCard", () => {
  it("offers all three ways onto a team when the viewer has none", () => {
    const html = renderToStaticMarkup(
      <TeamCard team={null} writesEnabled maxMembers={4} isCaptain={false} captain={null} joinCode={null} />,
    );
    // Join-by-code field, labeled as a code (not a slug).
    expect(html).toMatch(/join code/i);
    // Create field.
    expect(html).toMatch(/team name/i);
    // One-click team of one (issue #153) — without it the cheapest way to play
    // alone is to invent a team name.
    expect(html).toMatch(/play solo/i);
  });

  it("says a team is REQUIRED, not merely available", () => {
    // A team is now mandatory before anything scores. Copy that reads as an
    // optional extra leaves a contestant wondering later why nothing counted.
    const html = renderToStaticMarkup(
      <TeamCard team={null} writesEnabled maxMembers={4} isCaptain={false} captain={null} joinCode={null} />,
    );
    expect(html).toMatch(/need a team/i);
    expect(html).not.toMatch(/create or join a team to compete/i);
  });

  it("shows Leave for a non-captain member and hides captain controls", () => {
    const html = renderToStaticMarkup(
      <TeamCard
        team={{ slug: "red-team", name: "Red Team", members: ["alice", "bob"] }}
        writesEnabled
        maxMembers={4}
        isCaptain={false}
        captain="alice"
        joinCode="ab12cd"
      />,
    );
    expect(html).toMatch(/leave team/i);
    expect(html).not.toMatch(/rename/i);
    expect(html).not.toMatch(/transfer/i);
    expect(html).not.toMatch(/regenerate/i);
    expect(html).not.toMatch(/disband/i);
  });

  it("shows rename/remove/transfer/regen/disband controls for the captain", () => {
    const html = renderToStaticMarkup(
      <TeamCard
        team={{ slug: "red-team", name: "Red Team", members: ["alice", "bob", "carol"] }}
        writesEnabled
        maxMembers={4}
        isCaptain
        captain="alice"
        joinCode="ab12cd"
      />,
    );
    expect(html).toMatch(/rename/i);
    expect(html).toMatch(/remove/i);
    expect(html).toMatch(/transfer/i);
    expect(html).toMatch(/regenerate join code/i);
    expect(html).toMatch(/disband team/i);
    // The join code itself is surfaced prominently.
    expect(html).toContain("ab12cd");
  });
});
