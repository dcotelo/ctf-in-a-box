// @testing-library/react is not a dependency of this repo and must not be
// added just for this test. AdminControls is a "use client" component but
// has no effects that run during a plain render, so renderToStaticMarkup is
// enough to check markup — same pattern as team-card.test.tsx. Content gated
// behind useState (e.g. the confirm modal) never appears in this render, so
// we only assert on what's present in the initial static markup.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminSettings } from "@/lib/admin-store";

const { enabledModules } = vi.hoisted(() => ({
  enabledModules: [
    {
      id: "secure-development",
      displayName: "Secure Development",
      description: "Find the vulnerability, patch it for real, ship the fix as a PR.",
      nav: { href: "/challenges", label: "Challenges" },
      targets: ["juice-shop"],
    },
    {
      id: "quiz",
      displayName: "Quiz",
      description: "Answer security questions for points.",
      targets: [],
    },
  ],
}));

vi.mock("@/lib/modules", () => ({ enabledModules }));

import AdminControls from "@/app/(site)/admin/admin-controls";

const settings: AdminSettings = {
  paused: false,
  teamRegistrationOpen: true,
  hintsEnabled: null,
  hintCost: null,
  hintsMinSolves: null,
  hintsUnlockAfterMin: null,
  quizMaxAttempts: null,
  quizRetryAfterMin: null,
  scoringStartsAt: null,
  scoringEndsAt: null,
  registrationStartsAt: null,
  registrationEndsAt: null,
  updatedBy: null,
  updatedAt: null,
};

describe("AdminControls", () => {
  it("groups controls into an event section and one section per enabled module", () => {
    const html = renderToStaticMarkup(<AdminControls initial={settings} />);
    expect(html).toMatch(/Event/);
    expect(html).toContain("Secure Development"); // module section heading

    // Hint controls belong to secure-development, not to the event section.
    const modIdx = html.indexOf("Secure Development");
    expect(html.indexOf("Hint cost")).toBeGreaterThan(modIdx);
    expect(html.indexOf("Hints enabled")).toBeGreaterThan(modIdx);
    expect(html.indexOf("Hints: solves required")).toBeGreaterThan(modIdx);
    expect(html.indexOf("Hints: unlock after (min)")).toBeGreaterThan(modIdx);

    // Event-only controls appear before the first module heading.
    expect(html.indexOf("Freeze scoring")).toBeLessThan(modIdx);
    expect(html.indexOf("Team registration open")).toBeLessThan(modIdx);
    expect(html.indexOf("Schedule (auto dates)")).toBeLessThan(modIdx);
    expect(html.indexOf("Danger zone")).toBeLessThan(modIdx);
  });

  it("renders the quiz module's settings and question authoring, not the old placeholder", () => {
    const html = renderToStaticMarkup(<AdminControls initial={settings} />);
    expect(html).toContain("Quiz");
    const quizIdx = html.indexOf("Quiz");
    expect(html.indexOf("Max attempts")).toBeGreaterThan(quizIdx);
    expect(html.indexOf("Retry after (min)")).toBeGreaterThan(quizIdx);
    expect(html.indexOf("Add question")).toBeGreaterThan(quizIdx);
    expect(html).not.toContain("No settings for this module yet.");
  });

  it("shows the demo seed section only when demoMode is set", () => {
    const withoutDemo = renderToStaticMarkup(<AdminControls initial={settings} />);
    expect(withoutDemo).not.toMatch(/seed demo data/i);

    const withDemo = renderToStaticMarkup(<AdminControls initial={settings} demoMode />);
    expect(withDemo).toMatch(/seed demo data/i);
  });
});
