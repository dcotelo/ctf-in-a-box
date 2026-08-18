// @testing-library/react is not a dependency of this repo and must not be
// added just for this test. AdminControls is a "use client" component but
// has no effects that run during a plain render, so renderToStaticMarkup is
// enough to check markup — same pattern as team-card.test.tsx. Content gated
// behind useState (e.g. the confirm modal) never appears in this render, so
// we only assert on what's present in the initial static markup.
//
// The panel assertions below lean on the component rendering EVERY tab panel
// and hiding the inactive ones with `hidden`. If that ever regresses to
// `{active === id && <Tab/>}`, `panelFor` throws instead of quietly making
// these tests vacuous.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminSettings } from "@/lib/admin-store";
import type { ResolvedModule } from "@/lib/modules";
import { panelFor } from "./panel-for";

// AdminControls now takes its modules as a prop (already resolved
// server-side), so it no longer reads the registry itself. The mock stays so
// this suite is never coupled to whatever `event.yaml` happens to enable for
// anything else that resolves `@/lib/modules` in this import graph.
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

/** What the server hands down: registry defaults already merged with any
 *  organizer override (see lib/resolved-modules.ts). Note `title`/`blurb` —
 *  a ResolvedModule has no `displayName`, deliberately. */
const twoModules: readonly ResolvedModule[] = [
  {
    id: "secure-development",
    title: "Secure Development",
    blurb: "Find the vulnerability, patch it for real, ship the fix as a PR.",
    nav: { href: "/challenges", label: "Challenges" },
    targets: ["juice-shop"],
  },
  {
    id: "quiz",
    title: "Quiz",
    blurb: "Answer security questions for points.",
    targets: [],
  },
];

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
  moduleOverrides: {},
};

describe("AdminControls tab shell", () => {
  it("renders one tab per enabled module plus Event", () => {
    const html = renderToStaticMarkup(<AdminControls initial={settings} modules={twoModules} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Event");
    expect(html).toContain("Secure Development");
    expect(html).toContain("Quiz");
    expect(html.match(/role="tab"/g)?.length).toBe(3);
  });

  it("labels a module tab with its resolved title", () => {
    const html = renderToStaticMarkup(
      <AdminControls initial={settings} modules={[{ id: "quiz", title: "Round 1" }] as never} />,
    );
    expect(html).toContain("Round 1");
  });

  it("renders every tab panel so only visibility is conditional", () => {
    const html = renderToStaticMarkup(<AdminControls initial={settings} modules={twoModules} />);
    expect(html.match(/role="tabpanel"/g)?.length).toBe(3);
    // Exactly the two non-selected panels carry `hidden`.
    expect(html.match(/hidden=""/g)?.length).toBe(2);
  });

  it("wires each tab to its panel for assistive tech", () => {
    const html = renderToStaticMarkup(<AdminControls initial={settings} modules={twoModules} />);
    for (const id of ["event", "secure-development", "quiz"]) {
      expect(html).toContain(`id="tab-${id}"`);
      expect(html).toContain(`aria-controls="panel-${id}"`);
      expect(html).toContain(`aria-labelledby="tab-${id}"`);
    }
  });

  it("marks exactly one tab selected", () => {
    const html = renderToStaticMarkup(<AdminControls initial={settings} modules={twoModules} />);
    expect(html.match(/aria-selected="true"/g)?.length).toBe(1);
  });

  it("gives only the selected tab a reachable tabIndex (roving tabindex)", () => {
    const html = renderToStaticMarkup(<AdminControls initial={settings} modules={twoModules} />);
    expect(html.match(/tabindex="0"/gi)?.length).toBe(1);
    expect(html.match(/tabindex="-1"/gi)?.length).toBe(2);
  });
});

describe("AdminControls panel contents", () => {
  it("puts hint controls in the Secure Development panel, not Event", () => {
    const html = renderToStaticMarkup(<AdminControls initial={settings} modules={twoModules} />);
    const secureDev = panelFor(html, "secure-development");
    const eventPanel = panelFor(html, "event");
    expect(secureDev).toContain("Hints enabled");
    expect(secureDev).toContain("Hint cost");
    expect(secureDev).toContain("Hints: solves required");
    expect(secureDev).toContain("Hints: unlock after (min)");
    expect(eventPanel).not.toContain("Hint cost");
    expect(eventPanel).not.toContain("Hints enabled");
  });

  it("keeps freeze and registration in the Event panel", () => {
    const html = renderToStaticMarkup(<AdminControls initial={settings} modules={twoModules} />);
    const eventPanel = panelFor(html, "event");
    expect(eventPanel).toContain("Freeze scoring");
    expect(eventPanel).toContain("Team registration open");
    expect(eventPanel).toContain("Schedule (auto dates)");
    expect(eventPanel).toContain("Danger zone");
  });

  it("renders the quiz module's settings and question authoring in its own panel", () => {
    const html = renderToStaticMarkup(<AdminControls initial={settings} modules={twoModules} />);
    const quizPanel = panelFor(html, "quiz");
    expect(quizPanel).toContain("Max attempts");
    expect(quizPanel).toContain("Retry after (min)");
    expect(quizPanel).toContain("Add question");
    expect(html).not.toContain("No settings for this module yet.");
  });

  it("drops a module's panel entirely when it is not enabled", () => {
    const html = renderToStaticMarkup(
      <AdminControls initial={settings} modules={twoModules.filter((m) => m.id !== "secure-development")} />,
    );
    expect(html.match(/role="tabpanel"/g)?.length).toBe(2);
    expect(html).not.toContain("Hint cost");
    expect(() => panelFor(html, "secure-development")).toThrow();
  });

  it("shows the demo seed section only when demoMode is set", () => {
    const withoutDemo = renderToStaticMarkup(<AdminControls initial={settings} modules={twoModules} />);
    expect(withoutDemo).not.toMatch(/seed demo data/i);

    const withDemo = renderToStaticMarkup(<AdminControls initial={settings} modules={twoModules} demoMode />);
    expect(panelFor(withDemo, "event")).toMatch(/seed demo data/i);
  });
});
