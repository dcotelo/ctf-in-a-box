// Leaderboard is a "use client" component, but it has no effects that run
// during a plain render (all state is useState with static initial values),
// so renderToStaticMarkup is enough to check markup — same pattern as
// score-time-chart.test.tsx and team-card.test.tsx. next/image is mocked
// because the real component needs Next's image-optimization runtime, which
// isn't wired up under vitest.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={(props.alt as string) ?? ""} />;
  },
}));

import Leaderboard, { EntryRow, TeamRow } from "@/components/leaderboard";
import type { LeaderboardData, LeaderboardEntry, TeamStanding } from "@/lib/leaderboard/types";

const CAPS = { apps: true, teams: true, challenges: true } as const;

function entry(overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    rank: 1,
    login: "alice",
    team: null,
    points: 100,
    patched: 3,
    failed: 0,
    total: 3,
    apps: {},
    updatedAt: null,
    ...overrides,
  };
}

function team(overrides: Partial<TeamStanding> = {}): TeamStanding {
  return {
    rank: 1,
    slug: "red-team",
    name: "Red Team",
    captain: "alice",
    points: 150,
    members: ["alice", "bob"],
    ...overrides,
  };
}

function data(overrides: Partial<LeaderboardData> = {}): LeaderboardData {
  return {
    entries: [entry()],
    teams: [],
    generatedAt: "2026-08-01T00:00:00.000Z",
    capabilities: { apps: false, teams: false, challenges: false },
    ...overrides,
  };
}

describe("Leaderboard", () => {
  it("defaults to the teams view when teams exist, with the toggle marked active", () => {
    const board = data({
      entries: [entry({ login: "alice", team: "red-team" }), entry({ rank: 2, login: "bob", team: "red-team", points: 80 })],
      teams: [team()],
      capabilities: { apps: false, teams: true, challenges: false },
    });
    const html = renderToStaticMarkup(<Leaderboard data={board} viewerLogin={null} />);

    // Team rows render by default.
    expect(html).toContain("Red Team");
    // The teams toggle button is the active one.
    expect(html).toMatch(/aria-pressed="true"[^>]*>\s*teams/);
    // Individual-only sort controls are not shown while in teams view.
    expect(html).not.toMatch(/Sort:/);
  });

  it("shows the captain among members when a team row is expanded", () => {
    const html = renderToStaticMarkup(
      <TeamRow team={team({ members: ["alice", "bob", "carol"], captain: "bob" })} topPoints={150} isOpen onToggle={() => {}} />,
    );
    expect(html).toContain("alice");
    expect(html).toContain("bob");
    expect(html).toContain("carol");
    expect(html).toMatch(/captain/i);
    // The captain marker sits specifically next to bob, not every member.
    const bobIdx = html.indexOf(">bob<");
    const captainIdx = html.toLowerCase().indexOf("captain");
    expect(captainIdx).toBeGreaterThan(bobIdx);
  });

  it("shows each member's points in the expanded team row", () => {
    const html = renderToStaticMarkup(
      <TeamRow
        team={team({ members: ["alice", "bob"], captain: "alice" })}
        topPoints={150}
        pointsByLogin={new Map([["alice", 14], ["bob", 4]])}
        isOpen
        onToggle={() => {}}
      />,
    );
    expect(html).toMatch(/14\s*pts/);
    expect(html).toMatch(/4\s*pts/);
  });

  it("renders team score lines in the chart when the default view is teams", () => {
    const board = data({
      teams: [team()],
      capabilities: { apps: false, teams: true, challenges: false },
      teamSeries: [
        {
          slug: "red-team",
          name: "Red Team",
          points: [
            { t: "2026-08-01T00:00:00.000Z", score: 10 },
            { t: "2026-08-01T04:00:00.000Z", score: 90 },
          ],
        },
        {
          slug: "blue-team",
          name: "Blue Team",
          points: [
            { t: "2026-08-01T01:00:00.000Z", score: 20 },
            { t: "2026-08-01T05:00:00.000Z", score: 60 },
          ],
        },
      ],
      series: [{ login: "alice", points: [{ t: "2026-08-01T00:00:00.000Z", score: 10 }] }],
    });
    const html = renderToStaticMarkup(<Leaderboard data={board} viewerLogin={null} />);
    expect(html).toMatch(/Top 2 teams/);
  });

  it("keeps the individual view (and player chart) unchanged when there are no teams", () => {
    const board = data({
      entries: [entry({ login: "alice" }), entry({ rank: 2, login: "bob", points: 80 })],
      teams: [],
      capabilities: { apps: false, teams: false, challenges: false },
      series: [
        {
          login: "alice",
          points: [
            { t: "2026-08-01T00:00:00.000Z", score: 10 },
            { t: "2026-08-01T04:00:00.000Z", score: 100 },
          ],
        },
        {
          login: "bob",
          points: [
            { t: "2026-08-01T01:00:00.000Z", score: 20 },
            { t: "2026-08-01T05:00:00.000Z", score: 80 },
          ],
        },
      ],
    });
    const html = renderToStaticMarkup(<Leaderboard data={board} viewerLogin={null} />);
    // No teams => no toggle at all, individual view stands alone.
    expect(html).not.toMatch(/aria-pressed/);
    expect(html).toContain("alice");
    expect(html).toContain("bob");
    expect(html).toMatch(/Sort:/);
    // Player chart (not team chart) renders from `series`.
    expect(html).toMatch(/Top 2 contestants/);
  });
});

describe("per-challenge catalog", () => {
  it("lists an entry's challenges (solved + open) in the expanded breakdown", () => {
    const withChallenges = entry({
      apps: {
        "juice-shop": {
          app: "juice-shop",
          points: 10,
          maxPoints: 15,
          patched: 1,
          total: 2,
          challenges: [
            { key: "xss", name: "Reflected XSS", points: 10, owasp: "A03", status: "patched" },
            { key: "sqli", name: "SQL injection", points: 5, owasp: null, status: "open" },
          ],
        },
      },
    });
    const html = renderToStaticMarkup(
      <EntryRow entry={withChallenges} topPoints={100} isOwn={false} isOpen onToggle={() => {}} capabilities={CAPS} />,
    );
    // The per-target challenge list is collapsible (collapsed by default —
    // some targets have 100+ challenges), so the expand trigger is what renders
    // in static markup, under the target's name.
    expect(html).toMatch(/Show 2 challenges/);
    expect(html).toContain("Juice Shop");
  });

  it("shows a team's solved flags (union), grouped by target, when expanded", () => {
    const withFlags = team({
      apps: {
        "juice-shop": {
          app: "juice-shop",
          points: 15,
          maxPoints: 15,
          patched: 2,
          total: 2,
          challenges: [
            { key: "xss", name: "Reflected XSS", points: 10, owasp: "A03", status: "patched" },
            { key: "sqli", name: "SQL injection", points: 5, owasp: null, status: "patched" },
          ],
        },
      },
    });
    const html = renderToStaticMarkup(<TeamRow team={withFlags} topPoints={150} isOpen onToggle={() => {}} />);
    expect(html).toMatch(/Solved flags/i);
    expect(html).toContain("Reflected XSS");
    expect(html).toContain("SQL injection");
    // Members still render alongside the flags.
    expect(html).toContain("alice");
  });

  it("omits the solved-flags section for a team without per-challenge data", () => {
    const html = renderToStaticMarkup(<TeamRow team={team()} topPoints={150} isOpen onToggle={() => {}} />);
    expect(html).not.toMatch(/Solved flags/i);
  });
});
