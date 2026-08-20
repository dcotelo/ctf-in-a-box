// @testing-library/react is not a dependency of this repo and must not be
// added just for this test. renderToStaticMarkup (ships with react-dom) is
// enough to check the initial server render — same pattern as
// admin/__tests__/page.test.tsx and quiz/__tests__/page.test.tsx.
//
// The point of this file is I2: the profile page's headline points figure
// must equal what the SAME login's leaderboard row would show — hint spend
// subtracted, quiz points added, in that order. Rather than re-deriving the
// formula by hand (which would pass even if the two implementations quietly
// drifted), this drives the REAL leaderboard overlay functions
// (withHintPenalties, withModuleContributions) on an equivalent entry and
// asserts the profile page renders that exact number.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const {
  getSession,
  getUser,
  getViewerTeam,
  getViewerHints,
  getHintPenalties,
  isModuleEnabled,
  getQuizTotals,
  listQuestions,
  getTeamQuizTotals,
  getResolvedModules,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
  getViewerTeam: vi.fn(),
  getViewerHints: vi.fn(),
  getHintPenalties: vi.fn(),
  isModuleEnabled: vi.fn(),
  getQuizTotals: vi.fn(),
  listQuestions: vi.fn(),
  getTeamQuizTotals: vi.fn(),
  getResolvedModules: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
// TeamCard (rendered unconditionally by the profile page) calls useRouter —
// same reason quiz/__tests__/page.test.tsx mocks it for QuizBoard.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/leaderboard/source", () => ({ getLeaderboardSource: () => ({ getUser }) }));
vi.mock("@/lib/team-store", () => ({
  getViewerTeam,
  TEAM_MAX_MEMBERS: 4,
  TEAM_WRITES_ENABLED: false,
}));
vi.mock("@/lib/hint-store", () => ({ getViewerHints, getHintPenalties, HINTS_AVAILABLE: true }));
// Partial mock: `isModuleEnabled` is what this page's gates call, but
// `@/lib/site` reads `SECURE_AGENT_PLAYBOOK_URL` off this same module at
// import time (the registry owns the constant; site.ts re-exports it as
// `event.secureAgentPlaybookUrl`), so a whole-module replacement that omits
// it makes every importer of site.ts throw — same trap `challenges/
// __tests__/page.test.tsx` documents for its own `@/lib/modules` mock.
vi.mock("@/lib/modules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/modules")>()),
  isModuleEnabled,
}));
// The per-module block list is driven off this, not off `@/lib/modules`
// directly — these tests don't exercise the breakdown blocks, so an empty
// list is enough to keep the page from rendering any.
vi.mock("@/lib/resolved-modules", () => ({ getResolvedModules }));
vi.mock("@/lib/quiz-store", () => ({ getQuizTotals, listQuestions, getTeamQuizTotals }));
vi.mock("@/lib/upstash", () => ({ upstashPipeline: vi.fn() }));

import ProfilePage from "@/app/(site)/profile/page";
import { withHintPenalties } from "@/lib/leaderboard/hint-penalties";
import { withModuleContributions } from "@/lib/leaderboard/module-contributions";
import type { LeaderboardData, LeaderboardEntry } from "@/lib/leaderboard/types";

beforeEach(() => {
  vi.clearAllMocks();
  getViewerTeam.mockResolvedValue(null);
  listQuestions.mockResolvedValue([]);
  getTeamQuizTotals.mockResolvedValue({ points: 0, answered: 0, lastAt: null });
  getResolvedModules.mockResolvedValue([]);
});

const baseProfile = {
  login: "ada",
  team: null,
  teamName: null,
  points: 40,
  maxPoints: 100,
  patched: 4,
  failed: 0,
  total: 6,
  apps: [] as never[],
  updatedAt: null,
};

describe("profile page points vs. the leaderboard row", () => {
  it("agrees with withHintPenalties + withModuleContributions for the same login (quiz enabled)", async () => {
    isModuleEnabled.mockImplementation((id: string) => id === "quiz" || id === "secure-development");
    getSession.mockResolvedValue({ user: { login: "ada", image: null } });
    getUser.mockResolvedValue(baseProfile);
    getViewerHints.mockResolvedValue({ purchased: {}, spent: 10, count: 1 });
    getQuizTotals.mockResolvedValue(new Map([["ada", { points: 15, answered: 2, lastAt: null }]]));
    getHintPenalties.mockResolvedValue(new Map([["ada", 10]]));

    const html = renderToStaticMarkup(await ProfilePage());

    // Independently compute what the leaderboard would show this SAME login,
    // through the real overlay pipeline (not a hand-rolled formula).
    const entry: LeaderboardEntry = {
      rank: 1,
      login: "ada",
      team: null,
      points: baseProfile.points,
      patched: baseProfile.patched,
      failed: 0,
      total: baseProfile.total,
      apps: {},
      updatedAt: null,
    };
    const data: LeaderboardData = {
      entries: [entry],
      teams: [],
      generatedAt: new Date().toISOString(),
      capabilities: { apps: false, teams: false, challenges: false },
    };
    const leaderboardOut = await withModuleContributions(await withHintPenalties(data));
    const leaderboardPoints = leaderboardOut.entries[0].points;

    // 40 (raw) - 10 (hint spend, floored at 0) + 15 (quiz) = 45.
    expect(leaderboardPoints).toBe(45);
    expect(html).toContain(`>${leaderboardPoints}<`);
  });

  it("shows the raw (hint-only-adjusted) total when the quiz module is disabled — never reads quiz data", async () => {
    isModuleEnabled.mockReturnValue(false);
    getSession.mockResolvedValue({ user: { login: "ada", image: null } });
    getUser.mockResolvedValue(baseProfile);
    getViewerHints.mockResolvedValue({ purchased: {}, spent: 10, count: 1 });

    const html = renderToStaticMarkup(await ProfilePage());

    expect(getQuizTotals).not.toHaveBeenCalled();
    expect(html).toContain(">30<"); // 40 - 10, no quiz points added
  });
});

// Regression coverage for review round 1: the per-app points figure the
// pre-module custom grid used to show ("DVWA 30 / 60 pts") was silently
// dropped when the grid was replaced by AppBreakdown/ModuleDetail, and a
// separate regression let the per-module heading show the RAW scorer total
// instead of the hint-netted one the headline and the leaderboard row use.
describe("profile per-module block content", () => {
  it("shows the per-app points figure via the reused AppBreakdown (showPoints)", async () => {
    isModuleEnabled.mockImplementation((id: string) => id === "secure-development");
    getResolvedModules.mockResolvedValue([
      {
        id: "secure-development",
        nav: { href: "/challenges", label: "Challenges" },
        targets: ["dvwa"],
        title: "Secure Development",
        blurb: "",
      },
    ]);
    getSession.mockResolvedValue({ user: { login: "ada", image: null } });
    getUser.mockResolvedValue({
      ...baseProfile,
      apps: [{ app: "dvwa", points: 30, maxPoints: 60, patched: 3, total: 4 }],
    });
    getViewerHints.mockResolvedValue({ purchased: {}, spent: 0, count: 0 });

    const html = renderToStaticMarkup(await ProfilePage());

    expect(html).toContain(">30<");
    expect(html).toContain("/ 60 pts");
  });

  it("nets hint spend into the secure-development module's own point total, matching the headline", async () => {
    isModuleEnabled.mockImplementation((id: string) => id === "secure-development" || id === "quiz");
    // Two resolved modules so `multiModule` is true and the per-module
    // heading (which carries the points figure under test) renders at all.
    getResolvedModules.mockResolvedValue([
      {
        id: "secure-development",
        nav: { href: "/challenges", label: "Challenges" },
        targets: ["dvwa"],
        title: "Secure Development",
        blurb: "",
      },
      { id: "quiz", nav: { href: "/quiz", label: "Quiz" }, targets: [], title: "Quiz", blurb: "" },
    ]);
    getSession.mockResolvedValue({ user: { login: "ada", image: null } });
    getUser.mockResolvedValue({
      ...baseProfile,
      apps: [{ app: "dvwa", points: 40, maxPoints: 100, patched: 4, total: 6 }],
    });
    getViewerHints.mockResolvedValue({ purchased: {}, spent: 10, count: 1 });
    getQuizTotals.mockResolvedValue(new Map());

    const html = renderToStaticMarkup(await ProfilePage());

    // 40 raw - 10 hint spend = 30. NOT the raw 40.
    expect(html).toContain(">30 pts<");
    expect(html).not.toContain(">40 pts<");
  });
});
