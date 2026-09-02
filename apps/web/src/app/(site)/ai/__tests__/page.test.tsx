// @testing-library/react is not a dependency of this repo and must not be
// added just for this test. renderToStaticMarkup (ships with react-dom) is
// enough to check the initial server render, since we only assert on markup
// text — same pattern as flags/__tests__/page.test.tsx, which this mirrors.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { isModuleEnabled, isAdminLogin, getSession, listAiChallenges, listAiCategories, getAiSolveCounts, getViewerAi, getResolvedModules } =
  vi.hoisted(() => ({
    isModuleEnabled: vi.fn(),
    isAdminLogin: vi.fn(),
    getSession: vi.fn(),
    listAiChallenges: vi.fn(),
    listAiCategories: vi.fn(),
    getAiSolveCounts: vi.fn(),
    getViewerAi: vi.fn(),
    getResolvedModules: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/enabled-modules", () => import("@/test/enabled-modules-baked"));
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("@/lib/modules", () => ({ isModuleEnabled }));
vi.mock("@/lib/resolved-modules", () => ({ getResolvedModules }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/admin-auth", () => ({ isAdminLogin }));
vi.mock("@/lib/ai-store", () => ({
  listAiChallenges,
  listAiCategories,
  getAiSolveCounts,
  getViewerAi,
  AI_COOLDOWN_SEC: 5,
}));

import AiPage, { generateMetadata } from "@/app/(site)/ai/page";

const baseChallenges = [
  { id: "a1", title: "Solved one", category: "Prompt Injection", description: "d1", points: 10, order: 0, mode: "flag" },
  { id: "a2", title: "Still cooling down", category: "Prompt Injection", description: "d2", points: 20, order: 1, mode: "flag" },
  { id: "a3", title: "Never attempted", category: "Guardrails", description: "d3", points: 30, order: 2, mode: "event" },
];

beforeEach(() => {
  vi.clearAllMocks();
  isAdminLogin.mockReturnValue(false);
  // Registry-default fallback, same shape resolveModules would produce for an
  // event with only the ai module enabled and no organizer overrides.
  getResolvedModules.mockResolvedValue([
    {
      id: "ai",
      title: "AI Challenges",
      blurb: "Prompt-injection and guardrail challenges hosted outside the box, scored inside it.",
    },
  ]);
  listAiCategories.mockResolvedValue(["Prompt Injection", "Guardrails"]);
  getAiSolveCounts.mockResolvedValue(new Map());
});

describe("ai page gate", () => {
  it("404s when the ai module is not enabled", async () => {
    isModuleEnabled.mockReturnValue(false);
    await expect(AiPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});

describe("ai page view model", () => {
  it("derives solved/cooldown/unsolved per challenge from viewer progress, in board order", async () => {
    isModuleEnabled.mockReturnValue(true);
    getSession.mockResolvedValue({ user: { login: "alice" } });
    listAiChallenges.mockResolvedValue(baseChallenges);
    getViewerAi.mockResolvedValue({
      solved: { a1: { points: 10, at: "2026-08-18T00:00:00.000Z", source: "flag" } },
      attempts: {
        a2: { attempts: 1, lastAt: new Date().toISOString() }, // fresh — inside the cooldown
      },
    });

    const html = renderToStaticMarkup(await AiPage());

    // Board tiles show STATE, not the challenge form (that lives on
    // /ai/[id]): the solved tile is marked, every tile links to its own page.
    expect(html).toContain("(solved)");
    expect(html).toContain('href="/ai/a1"');
    expect(html).toContain('href="/ai/a2"');
    expect(html).toContain('href="/ai/a3"');
    expect(html).not.toContain("d1"); // descriptions live on /ai/[id]
    expect(html).toContain("/ 3 solved");

    // Row order: the tiles appear in the store's (server-sorted) order within
    // each category, which the board never re-sorts.
    const iA1 = html.indexOf("Solved one");
    const iA2 = html.indexOf("Still cooling down");
    expect(iA1).toBeGreaterThan(-1);
    expect(iA2).toBeGreaterThan(iA1);
  });

  it("treats a signed-out visitor as having no progress and prompts sign-in instead of a submit control", async () => {
    isModuleEnabled.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    listAiChallenges.mockResolvedValue([baseChallenges[2]]);

    const html = renderToStaticMarkup(await AiPage());

    expect(getViewerAi).not.toHaveBeenCalled();
    expect(html).toMatch(/sign in with github/i);
    expect(html).not.toContain("<button");
    // And no personal summary — nothing personal to summarize.
    expect(html).not.toContain("/ 1 solved");
  });

  it("shows an empty state with no challenges available", async () => {
    isModuleEnabled.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    listAiChallenges.mockResolvedValue([]);

    const html = renderToStaticMarkup(await AiPage());
    expect(html).toMatch(/no challenges are available/i);
  });

  // The state every new event starts in, and the first thing an organizer
  // sees after provisioning. A contestant's "check back soon" is a correct
  // dead end for them and a useless one for whoever has to author the board.
  it("routes an organizer to the authoring tab from the empty state", async () => {
    isModuleEnabled.mockReturnValue(true);
    isAdminLogin.mockReturnValue(true);
    getSession.mockResolvedValue({ user: { login: "alice" } });
    listAiChallenges.mockResolvedValue([]);
    getViewerAi.mockResolvedValue({ solved: {}, attempts: {} });

    const html = renderToStaticMarkup(await AiPage());

    expect(html).toContain('href="/admin?tab=ai"');
    expect(html).toMatch(/author challenges/i);
    expect(html).not.toMatch(/check back soon/i);
  });

  it("shows a signed-in contestant the plain empty state, with no admin link", async () => {
    isModuleEnabled.mockReturnValue(true);
    isAdminLogin.mockReturnValue(false);
    getSession.mockResolvedValue({ user: { login: "bob" } });
    listAiChallenges.mockResolvedValue([]);
    getViewerAi.mockResolvedValue({ solved: {}, attempts: {} });

    const html = renderToStaticMarkup(await AiPage());

    expect(html).toMatch(/check back soon/i);
    expect(html).not.toContain("/admin");
  });

  it("renders the organizer's module title instead of the default", async () => {
    isModuleEnabled.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    listAiChallenges.mockResolvedValue([]);
    getResolvedModules.mockResolvedValue([{ id: "ai", title: "Prompt Arena", blurb: "Break the bot." }]);

    const html = renderToStaticMarkup(await AiPage());
    expect(html).toContain("Prompt Arena");
  });

  it("still prompts a signed-out visitor to sign in when there are no challenges at all", async () => {
    isModuleEnabled.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    listAiChallenges.mockResolvedValue([]);

    const html = renderToStaticMarkup(await AiPage());

    // Non-vacuity: this really is the empty-state render, not a populated one.
    expect(html).toMatch(/no challenges are available/i);
    expect(html).toMatch(/sign in with github to play the challenges/i);
  });
});

describe("ai page metadata", () => {
  it("falls back to the registry default title/description when there's no organizer override", async () => {
    getResolvedModules.mockResolvedValue([
      {
        id: "ai",
        title: "AI Challenges",
        blurb: "Prompt-injection and guardrail challenges hosted outside the box, scored inside it.",
      },
    ]);

    await expect(generateMetadata()).resolves.toEqual({
      title: "AI Challenges",
      description: "Prompt-injection and guardrail challenges hosted outside the box, scored inside it.",
    });
  });

  it("uses the organizer's resolved title/blurb when set", async () => {
    getResolvedModules.mockResolvedValue([{ id: "ai", title: "Prompt Arena", blurb: "Break the bot." }]);

    await expect(generateMetadata()).resolves.toEqual({
      title: "Prompt Arena",
      description: "Break the bot.",
    });
  });
});
