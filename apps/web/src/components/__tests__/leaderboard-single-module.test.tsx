// Single-module regression gate. `vi.mock` is hoisted per file, so the
// one-module registry needs its own file alongside leaderboard.test.tsx's
// two-module one.
//
// What this pins: for an event with exactly one enabled module — every event
// shipped so far — an expanded leaderboard row must render the way it did
// before the multi-module branch: the "App breakdown" label straight above the
// per-target grid, with no redundant "SECURE DEVELOPMENT <n> pts" heading
// wedged between them restating the points already shown in the row header.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={(props.alt as string) ?? ""} />;
  },
}));

vi.mock("@/lib/modules", () => ({
  enabledModules: [{ id: "secure-development", displayName: "Secure Development", description: "", targets: [] }],
}));

import { EntryRow } from "@/components/leaderboard";
import type { LeaderboardEntry } from "@/lib/leaderboard/types";

const CAPS = { apps: true, teams: false, challenges: true } as const;

const entry: LeaderboardEntry = {
  rank: 1,
  login: "alice",
  team: null,
  points: 100,
  patched: 3,
  failed: 0,
  total: 3,
  apps: { dvwa: { app: "dvwa", points: 100, maxPoints: 200, patched: 3, total: 6 } },
  updatedAt: null,
  modules: {
    "secure-development": {
      points: 100,
      completed: 3,
      lastActivityAt: null,
      detail: { apps: { dvwa: { app: "dvwa", points: 100, maxPoints: 200, patched: 3, total: 6 } } },
    },
  },
};

describe("expanded row with a single enabled module", () => {
  const html = renderToStaticMarkup(
    <EntryRow entry={entry} topPoints={200} isOwn={false} isOpen onToggle={() => {}} capabilities={CAPS} />,
  );

  it("suppresses the per-module heading", () => {
    expect(html).not.toContain("Secure Development");
  });

  it("still renders the app breakdown under its own label", () => {
    expect(html).toContain("App breakdown");
    expect(html).toContain("DVWA");
  });
});
