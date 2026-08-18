// @testing-library/react is not a dependency of this repo and must not be
// added just for this test. renderToStaticMarkup (ships with react-dom) is
// enough to check the initial server render, since we only assert on markup
// text — same pattern as admin/__tests__/page.test.tsx.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { isModuleEnabled, getSession, listQuestions, getViewerQuiz, getAdminSettings, getResolvedModules } = vi.hoisted(() => ({
  isModuleEnabled: vi.fn(),
  getSession: vi.fn(),
  listQuestions: vi.fn(),
  getViewerQuiz: vi.fn(),
  getAdminSettings: vi.fn(),
  getResolvedModules: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
// QuizBoard (the client component this page renders) calls useRouter for
// its post-submit refresh — needs a mock the same way quiz-board.test.tsx
// mocks it, since real next/navigation needs a router context.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/modules", () => ({ isModuleEnabled }));
vi.mock("@/lib/resolved-modules", () => ({ getResolvedModules }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/admin-store", () => ({ getAdminSettings }));
vi.mock("@/lib/quiz-store", () => ({
  listQuestions,
  getViewerQuiz,
  QUIZ_MAX_ATTEMPTS: 3,
  QUIZ_RETRY_AFTER_MIN: 5,
}));

import QuizPage from "@/app/(site)/quiz/page";

const baseQuestions = [
  {
    id: "q1",
    prompt: "Answered already",
    type: "single",
    choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    points: 10,
    order: 0,
  },
  {
    id: "q2",
    prompt: "Out of attempts",
    type: "single",
    choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    points: 5,
    order: 1,
  },
  {
    id: "q3",
    prompt: "Still cooling down",
    type: "single",
    choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    points: 5,
    order: 2,
  },
  {
    id: "q4",
    prompt: "Never attempted",
    type: "multi",
    choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    points: 20,
    order: 3,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  // Registry-default fallback, same shape resolveModules would produce for an
  // event with only the quiz module enabled and no organizer overrides. Tests
  // that care about an organizer-renamed title override this per-case.
  getResolvedModules.mockResolvedValue([{ id: "quiz", title: "Quiz", blurb: "Answer security questions for points." }]);
});

describe("quiz page gate", () => {
  it("404s when the quiz module is not enabled", async () => {
    isModuleEnabled.mockReturnValue(false);
    await expect(QuizPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});

describe("quiz page view model", () => {
  it("derives answered/exhausted/cooldown/unanswered per question from viewer progress and settings", async () => {
    isModuleEnabled.mockReturnValue(true);
    getSession.mockResolvedValue({ user: { login: "alice" } });
    listQuestions.mockResolvedValue(baseQuestions);
    getAdminSettings.mockResolvedValue({ quizMaxAttempts: 2, quizRetryAfterMin: 5 });
    getViewerQuiz.mockResolvedValue({
      answered: { q1: { points: 10, at: "2026-08-18T00:00:00.000Z" } },
      attempts: {
        q2: { attempts: 2, lastAt: "2026-08-18T00:00:00.000Z" }, // hit the 2-attempt cap
        q3: { attempts: 1, lastAt: new Date().toISOString() }, // fresh — inside the 5-minute cooldown
      },
    });

    const html = renderToStaticMarkup(await QuizPage());

    expect(html).toMatch(/answered.*earned 10 point/i);
    expect(html).toMatch(/no attempts remaining/i);
    expect(html).toMatch(/on cooldown/i);
    expect(html).toMatch(/submit answer/i); // q4 (never attempted) still offers one
    expect(html).toMatch(/answered 1 of 4 questions/i);
  });

  it("treats a signed-out visitor as having no progress and prompts sign-in instead of a submit control", async () => {
    isModuleEnabled.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    listQuestions.mockResolvedValue([baseQuestions[3]]);
    getAdminSettings.mockResolvedValue({ quizMaxAttempts: null, quizRetryAfterMin: null });

    const html = renderToStaticMarkup(await QuizPage());

    expect(getViewerQuiz).not.toHaveBeenCalled();
    expect(html).toMatch(/sign in with github/i);
    expect(html).not.toContain("<button");
  });

  it("shows an empty state with no questions available", async () => {
    isModuleEnabled.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    listQuestions.mockResolvedValue([]);
    getAdminSettings.mockResolvedValue({ quizMaxAttempts: null, quizRetryAfterMin: null });

    const html = renderToStaticMarkup(await QuizPage());
    expect(html).toMatch(/no quiz questions are available/i);
  });

  it("renders the organizer's module title instead of the default", async () => {
    isModuleEnabled.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    listQuestions.mockResolvedValue([]);
    getAdminSettings.mockResolvedValue({ quizMaxAttempts: null, quizRetryAfterMin: null });
    getResolvedModules.mockResolvedValue([{ id: "quiz", title: "Round 1", blurb: "Ten questions." }]);

    const html = renderToStaticMarkup(await QuizPage());
    expect(html).toContain("Round 1");
  });
});

describe("quiz page metadata", () => {
  it("falls back to the registry default title/description when there's no organizer override", async () => {
    getResolvedModules.mockResolvedValue([{ id: "quiz", title: "Quiz", blurb: "Answer security questions for points." }]);
    const { generateMetadata } = await import("@/app/(site)/quiz/page");

    await expect(generateMetadata()).resolves.toEqual({
      title: "Quiz",
      description: "Answer security questions for points.",
    });
  });

  it("uses the organizer's resolved title/blurb when set", async () => {
    getResolvedModules.mockResolvedValue([{ id: "quiz", title: "Round 1", blurb: "Ten questions." }]);
    const { generateMetadata } = await import("@/app/(site)/quiz/page");

    await expect(generateMetadata()).resolves.toEqual({
      title: "Round 1",
      description: "Ten questions.",
    });
  });
});
