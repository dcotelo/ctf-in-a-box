// The leaderboard on an event that does NOT run secure-development.
//
// "patched" and "non-patched" are that module's own vocabulary: a regression
// test passing against a submitted patch. /profile already gated the identical
// trio on `secureDevEnabled`; the board rendered its two columns and the
// "patched" sort key unconditionally, so a quiz-only event — the one event
// /leaderboard's acceptance gate actually loads — showed every contestant a
// "0 patched / 0 non-patched" pair for a game it wasn't running, and offered
// to sort on it.
//
// Own file so the quiz-only `modules` fixture can't be confused with
// leaderboard.test.tsx's two-module one or leaderboard-single-module.test.tsx's
// secure-development one.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={(props.alt as string) ?? ""} />;
  },
}));

import Leaderboard, { EntryRow } from "@/components/leaderboard";
import type { ResolvedModule } from "@/lib/modules";
import type { LeaderboardData, LeaderboardEntry } from "@/lib/leaderboard/types";

const QUIZ_ONLY: readonly ResolvedModule[] = [
  { id: "quiz", title: "Quiz", blurb: "", targets: [] },
];
const WITH_SECURE_DEV: readonly ResolvedModule[] = [
  { id: "secure-development", title: "Secure Development", blurb: "", targets: [] },
];

const CAPS = { apps: false, teams: false, challenges: false } as const;

// A row as `withModuleContributions` creates one for a quiz-only contestant:
// real points, and zeroes in every field the scorer would have filled in.
const entry: LeaderboardEntry = {
  rank: 1,
  login: "alice",
  team: null,
  points: 30,
  patched: 0,
  failed: 0,
  total: 0,
  apps: {},
  updatedAt: null,
  modules: {
    quiz: {
      points: 30,
      completed: 2,
      lastActivityAt: null,
      detail: { kind: "quiz", answered: 2, total: 4, points: 30 },
    },
  },
};

const data: LeaderboardData = {
  entries: [entry],
  teams: [],
  generatedAt: "2026-08-01T00:00:00.000Z",
  capabilities: CAPS,
};

describe("a leaderboard row on a quiz-only event", () => {
  const html = renderToStaticMarkup(
    <EntryRow
      entry={entry}
      topPoints={30}
      isOwn={false}
      isOpen={false}
      onToggle={() => {}}
      capabilities={CAPS}
      modules={QUIZ_ONLY}
    />,
  );

  it("renders no patched or non-patched column", () => {
    expect(html).not.toContain("patched");
  });

  it("still renders the contestant and their points", () => {
    expect(html).toContain("alice");
    expect(html).toContain("30");
  });
});

describe("a leaderboard row on a secure-development event", () => {
  it("keeps both columns", () => {
    const html = renderToStaticMarkup(
      <EntryRow
        entry={{ ...entry, patched: 3, total: 5 }}
        topPoints={30}
        isOwn={false}
        isOpen={false}
        onToggle={() => {}}
        capabilities={CAPS}
        modules={WITH_SECURE_DEV}
      />,
    );
    expect(html).toContain(">patched<");
    expect(html).toContain(">non-patched<");
  });
});

describe("the sort controls on a quiz-only event", () => {
  it("offers rank and points but not patched", () => {
    const html = renderToStaticMarkup(
      <Leaderboard data={data} viewerLogin={null} modules={QUIZ_ONLY} />,
    );
    expect(html).toContain(">rank<");
    expect(html).toContain(">points<");
    expect(html).not.toContain("patched");
  });

  it("still offers the patched sort where the module is enabled", () => {
    const html = renderToStaticMarkup(
      <Leaderboard data={data} viewerLogin={null} modules={WITH_SECURE_DEV} />,
    );
    expect(html).toContain(">patched<");
  });
});
