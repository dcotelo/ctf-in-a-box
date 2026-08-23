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
import type { ResolvedModule } from "@/lib/modules";
import type { LeaderboardData, LeaderboardEntry, TeamStanding } from "@/lib/leaderboard/types";

const CAPS = { apps: true, teams: true, challenges: true } as const;

// Leaderboard/EntryRow render their per-module headings from a `modules`
// prop supplied by the server page (resolved, organizer-named modules), not
// from a mocked registry — so tests pass this directly instead of mocking
// `@/lib/modules`. Two modules, so the per-module heading is exercised (see
// leaderboard-single-module.test.tsx for the one-module suppression case).
const MODULES: readonly ResolvedModule[] = [
  { id: "secure-development", title: "Secure Development", blurb: "", targets: [] },
  { id: "quiz", title: "Quiz", blurb: "", targets: [] },
];

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
    const html = renderToStaticMarkup(<Leaderboard data={board} viewerLogin={null} modules={MODULES} />);

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
    const html = renderToStaticMarkup(<Leaderboard data={board} viewerLogin={null} modules={MODULES} />);
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
    const html = renderToStaticMarkup(<Leaderboard data={board} viewerLogin={null} modules={MODULES} />);
    // No teams => no toggle at all, individual view stands alone.
    expect(html).not.toMatch(/aria-pressed/);
    expect(html).toContain("alice");
    expect(html).toContain("bob");
    expect(html).toMatch(/Sort:/);
    // Player chart (not team chart) renders from `series`.
    expect(html).toMatch(/Top 2 contestants/);
  });

  // The series is the scorer's history alone — quiz/classic points are
  // stamped on as totals with no timeline — so on a multi-module event the
  // chart's ceiling sits below the row totals. The chart must say so, or it
  // reads as broken (issue #200, 2.3).
  it("labels the chart with what it does not plot, on a multi-module event", () => {
    const board = data({
      series: [
        {
          login: "alice",
          points: [
            { t: "2026-08-01T00:00:00.000Z", score: 10 },
            { t: "2026-08-01T04:00:00.000Z", score: 100 },
          ],
        },
      ],
    });
    const html = renderToStaticMarkup(<Leaderboard data={board} viewerLogin={null} modules={MODULES} />);
    expect(html).toContain("Plots Secure Development scoring only");
    expect(html).toContain("Quiz points count toward the totals below but are not charted.");
  });

  it("renders no chart note on a secure-development-only event", () => {
    const board = data({
      series: [
        {
          login: "alice",
          points: [
            { t: "2026-08-01T00:00:00.000Z", score: 10 },
            { t: "2026-08-01T04:00:00.000Z", score: 100 },
          ],
        },
      ],
    });
    const sdOnly: readonly ResolvedModule[] = [MODULES[0]];
    const html = renderToStaticMarkup(<Leaderboard data={board} viewerLogin={null} modules={sdOnly} />);
    // On a one-module event the series IS the whole story — a note would
    // qualify nothing.
    expect(html).not.toContain("scoring only");
  });

  // Rank is breadth-first (compareStanding), so the top row is not
  // necessarily the highest points — the rule has to be stated where the
  // ranking is, or a contestant with the biggest PTS figure at #3 concludes
  // the board is broken (issue #200, 2.1).
  it("explains the breadth-first rank order under the sort chips", () => {
    const board = data({
      entries: [entry({ login: "alice" }), entry({ rank: 2, login: "bob", points: 80 })],
    });
    const html = renderToStaticMarkup(<Leaderboard data={board} viewerLogin={null} modules={MODULES} />);
    // Default sort is "rank", so the explainer is visible on first paint —
    // the moment the confusion would otherwise start.
    expect(html).toContain("Rank rewards breadth");
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
      <EntryRow entry={withChallenges} topPoints={100} isOwn={false} isOpen onToggle={() => {}} capabilities={CAPS} modules={MODULES} />,
    );
    // The per-target challenge list is collapsible (collapsed by default —
    // some targets have 100+ challenges), so the expand trigger is what renders
    // in static markup, under the target's name.
    expect(html).toMatch(/Show 2 challenges/);
    expect(html).toContain("Juice Shop");
  });

  it("shows a team's flags (solved + pending) grouped by target, when expanded", () => {
    const withFlags = team({
      apps: {
        "juice-shop": {
          app: "juice-shop",
          points: 15,
          maxPoints: 20,
          patched: 2,
          total: 3,
          challenges: [
            { key: "xss", name: "Reflected XSS", points: 10, owasp: "A03", status: "patched" },
            { key: "sqli", name: "SQL injection", points: 5, owasp: null, status: "patched" },
            { key: "csrf", name: "CSRF token", points: 5, owasp: "A01", status: "open" },
          ],
        },
      },
    });
    const html = renderToStaticMarkup(<TeamRow team={withFlags} topPoints={150} isOpen onToggle={() => {}} />);
    expect(html).toContain(">Target breakdown<");
    // Reuses the same collapsible AppChallengeList as the individual view, so
    // the per-target expand trigger renders under the target name (collapsed) —
    // and the count covers pending flags too (2 of 3, one still open).
    expect(html).toContain("Juice Shop");
    expect(html).toMatch(/2 \/ 3 patched/);
    expect(html).toMatch(/Show 3 challenges/);
    // Members still render alongside the flags.
    expect(html).toContain("alice");
  });

  it("omits the flags section for a team without per-challenge data", () => {
    const html = renderToStaticMarkup(<TeamRow team={team()} topPoints={150} isOpen onToggle={() => {}} />);
    expect(html).not.toContain(">Target breakdown<");
  });

  // The expansion exists to explain the team's total. Before this block, a
  // team on a multi-module event found only the secure-development targets
  // below — its quiz/classic points were IN the header figure and invisible
  // in the breakdown (issue #200, 2.2).
  it("shows each module's deduped contribution in the expanded team row", () => {
    const withModules = team({
      points: 278,
      modules: {
        quiz: { points: 200, completed: 3, lastActivityAt: null, detail: { kind: "quiz", answered: 3, total: 5, points: 200 } },
        "secure-development": {
          points: 8,
          completed: 6,
          lastActivityAt: null,
          detail: { kind: "secure-development", apps: {} },
        },
      },
    });
    const html = renderToStaticMarkup(
      <TeamRow team={withModules} topPoints={278} isOpen onToggle={() => {}} modules={MODULES} />,
    );
    expect(html).toContain("Quiz");
    expect(html).toMatch(/200 pts/);
    // Module vocabulary survives: questions are answered, not solved.
    expect(html).toMatch(/3 answered/);
    expect(html).toMatch(/6 solved/);
  });

  it("renders no module blocks on a single-module event — the total needs no split", () => {
    const withModules = team({
      modules: {
        "secure-development": {
          points: 150,
          completed: 6,
          lastActivityAt: null,
          detail: { kind: "secure-development", apps: {} },
        },
      },
    });
    const html = renderToStaticMarkup(
      <TeamRow team={withModules} topPoints={150} isOpen onToggle={() => {}} modules={[MODULES[0]]} />,
    );
    expect(html).not.toMatch(/6 solved/);
  });
});

describe("per-module breakdown", () => {
  it("labels each module's contribution in the expanded row", () => {
    const e = entry({
      points: 132,
      modules: {
        "secure-development": { points: 75, completed: 8, lastActivityAt: null, detail: { kind: "secure-development", apps: {} } },
        quiz: { points: 57, completed: 12, lastActivityAt: null, detail: { kind: "quiz", answered: 12, total: 15, points: 57 } },
      },
    });
    const html = renderToStaticMarkup(
      <EntryRow entry={e} topPoints={200} isOwn={false} isOpen onToggle={() => {}} capabilities={CAPS} modules={MODULES} />,
    );
    expect(html).toContain("Secure Development");
    expect(html).toContain("Quiz");
    expect(html).toMatch(/12\s*\/\s*15/); // quiz progress
  });

  it("heads a module block with its resolved title", () => {
    const e = entry({
      points: 132,
      modules: {
        "secure-development": { points: 75, completed: 8, lastActivityAt: null, detail: { kind: "secure-development", apps: {} } },
        quiz: { points: 57, completed: 12, lastActivityAt: null, detail: { kind: "quiz", answered: 12, total: 15, points: 57 } },
      },
    });
    const html = renderToStaticMarkup(
      <EntryRow
        entry={e}
        topPoints={200}
        isOwn={false}
        isOpen
        onToggle={() => {}}
        capabilities={CAPS}
        modules={[
          { id: "secure-development", title: "Patch Track", blurb: "", targets: [] },
          { id: "quiz", title: "Round 1", blurb: "", targets: [] },
        ]}
      />,
    );
    expect(html).toContain("Round 1");
    expect(html).not.toContain(">Quiz<");
  });
});
