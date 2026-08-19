// /profile on a two-module event: both secure-development's per-app
// breakdown and the quiz's "answered / total" block must render, and the
// block COUNT must track the enabled-module list — not a per-module branch
// baked into the page. A third module registered here (with progress to
// show) would grow this count with no page edit; a hard-coded branch could
// not do that.
//
// Own file because `vi.mock` hoists per file and this fixture needs its own
// event config — same split as page-quiz-only.test.tsx and
// lib/__tests__/modules-resolve.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    name: "Two-Track CTF",
    theme: "",
    dates: "",
    location: "",
    ctfStartsAt: null,
    url: "http://localhost:3000",
    contactEmail: "",
    githubOrg: "OWASP-CTF",
    discordUrl: "",
    modules: [
      { id: "secure-development", targets: ["dvwa"], scoreIngest: "poll" },
      { id: "quiz" },
    ],
    targets: ["dvwa"],
    admins: [],
  },
}));

const { getSession, getUser, getViewerTeam, getViewerHints, getQuizTotals, listQuestions, getTeamQuizTotals } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    getUser: vi.fn(),
    getViewerTeam: vi.fn(),
    getViewerHints: vi.fn(),
    getQuizTotals: vi.fn(),
    listQuestions: vi.fn(),
    getTeamQuizTotals: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));
// An organizer rename, so the multi-module heading is demonstrably the
// RESOLVED title and not the registry default — same fixture the landing
// page's two-module test uses.
vi.mock("@/lib/admin-store", () => ({
  getAdminSettings: async () => ({ moduleOverrides: { quiz: { title: "Round 1" } } }),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/leaderboard/source", () => ({ getLeaderboardSource: () => ({ getUser }) }));
vi.mock("@/lib/team-store", () => ({
  getViewerTeam,
  TEAM_MAX_MEMBERS: 4,
  TEAM_WRITES_ENABLED: false,
}));
vi.mock("@/lib/hint-store", () => ({
  getViewerHints,
  getHintPenalties: vi.fn(),
  HINTS_ENABLED: false,
}));
vi.mock("@/lib/quiz-store", () => ({ getQuizTotals, listQuestions, getTeamQuizTotals }));
vi.mock("@/lib/upstash", () => ({ upstashPipeline: vi.fn() }));

import ProfilePage from "@/app/(site)/profile/page";

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { login: "ada", image: null } });
  getUser.mockResolvedValue({
    login: "ada",
    team: null,
    teamName: null,
    points: 40,
    maxPoints: 100,
    patched: 4,
    failed: 0,
    total: 6,
    apps: [{ app: "dvwa", points: 40, maxPoints: 100, patched: 4, total: 6 }],
    updatedAt: null,
  });
  getViewerTeam.mockResolvedValue(null);
  getViewerHints.mockResolvedValue({ purchased: {}, spent: 0, count: 0 });
  getQuizTotals.mockResolvedValue(new Map([["ada", { points: 15, answered: 3, lastAt: null }]]));
  listQuestions.mockResolvedValue([{}, {}, {}, {}, {}]);
  getTeamQuizTotals.mockResolvedValue({ points: 0, answered: 0, lastAt: null });
});

describe("/profile on a two-module event", () => {
  it("shows both the secure-development and quiz blocks", async () => {
    const html = renderToStaticMarkup(await ProfilePage());
    expect(html).toContain(">4<"); // secure-development's per-app patched count (DVWA)
    expect(html).toContain("/ 6 patched");
    expect(html).toContain("3 / 5"); // quiz answered / total
  });

  it("heads each block with that module's resolved title, in registry order", () => {
    return ProfilePage()
      .then(renderToStaticMarkup)
      .then((html) => {
        expect(html).toContain("Secure Development");
        expect(html).toContain("Round 1");
        expect(html.indexOf("Secure Development")).toBeLessThan(html.indexOf("Round 1"));
      });
  });

  // The point of this test: it counts BLOCKS, not modules by name. A
  // per-module `if`/branch bolted onto the page instead of driving off the
  // enabled-module list would still pass every assertion above while being
  // exactly the anti-pattern the brief forbids — this is what actually pins
  // "list-driven, not branch-driven".
  it("drives the block count off the enabled-module list, not a per-module branch", async () => {
    const html = renderToStaticMarkup(await ProfilePage());
    const blockCount = html.split('data-testid="module-block"').length - 1;
    expect(blockCount).toBe(2);
  });
});
