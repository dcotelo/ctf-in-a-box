// The actual proof that the per-module block loop is driven off the
// enabled-module LIST and not a hard-coded branch pair.
//
// `page-two-modules.test.tsx`'s block-count assertion does NOT prove this: a
// mutation that replaces the loop with
// `{moduleProgress["secure-development"] && <Block/>}{moduleProgress["quiz"]
// && <Block/>}` — exactly the anti-pattern this page must avoid — still
// emits 2 blocks on a 2-module fixture, so a count check alone passes both
// the real implementation and the regression.
//
// What a hard-coded branch pair CANNOT do, but a loop over the resolved
// module list trivially does, is follow the ORDER an organizer declared
// their modules in `event.yaml`. This fixture declares quiz BEFORE
// secure-development (the reverse of every other fixture in this suite,
// and of the order a branch pair would be written in), then asserts the
// quiz block renders first. A hard-coded pair (in either likely writing
// order) fails this: it either always emits secure-development first, or,
// if reversed to match, breaks `page-two-modules.test.tsx`'s own
// registry-order assertion instead — there is no fixed branch order that
// satisfies both fixtures at once, which is exactly the point.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    name: "Reordered CTF",
    theme: "",
    dates: "",
    location: "",
    ctfStartsAt: null,
    url: "http://localhost:3000",
    contactEmail: "",
    githubOrg: "OWASP-CTF",
    discordUrl: "",
    // Quiz declared FIRST — the reverse of page-two-modules.test.tsx.
    modules: [{ id: "quiz" }, { id: "secure-development", targets: ["dvwa"], scoreIngest: "poll" }],
    targets: ["dvwa"],
    admins: [],
  },
}));

const { getSession, getUser, getViewerTeam, getViewerHints, getQuizTotals, listQuestions } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    getUser: vi.fn(),
    getViewerTeam: vi.fn(),
    getViewerHints: vi.fn(),
    getQuizTotals: vi.fn(),
    listQuestions: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/admin-store", () => ({
  getAdminSettings: async () => ({ moduleOverrides: {} }),
  // The page reads the registration window for the team card's
  // closed-state explanation (issue #217).
  effectiveRegistrationOpen: () => true,
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/leaderboard/source", () => ({ getLeaderboardSource: () => ({ getUser }) }));
vi.mock("@/lib/team-store", () => ({
  getViewerTeam,
  // The page renders the cap through the same resolver joinTeam enforces
  // with, so the mock has to provide it (issue #99).
  resolveTeamMaxMembers: async () => 4,
  TEAM_MAX_MEMBERS: 4,
  TEAM_WRITES_ENABLED: false,
}));
vi.mock("@/lib/hint-store", () => ({
  getViewerHints,
  getHintPenalties: vi.fn(),
  HINTS_AVAILABLE: false,
}));
vi.mock("@/lib/quiz-store", () => ({
  getQuizTotals,
  listQuestions,
  // The blocks' Show-N item list reads the viewer's own per-question map.
  getViewerQuiz: async () => ({ answered: {}, attempts: {} }),
}));
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
});

describe("/profile block order follows the enabled-module list", () => {
  it("renders the quiz block before secure-development's when the organizer declares quiz first", async () => {
    const html = renderToStaticMarkup(await ProfilePage());
    const quizAt = html.indexOf(">Quiz<");
    const secureDevAt = html.indexOf(">Secure Development<");
    expect(quizAt).toBeGreaterThanOrEqual(0);
    expect(secureDevAt).toBeGreaterThanOrEqual(0);
    expect(quizAt).toBeLessThan(secureDevAt);
  });
});
