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
import { HINT_COST, HINT_MIN_SOLVES, HINT_UNLOCK_AFTER_MIN } from "@/lib/hint-defaults";
import { QUIZ_MAX_ATTEMPTS, QUIZ_RETRY_AFTER_MIN } from "@/lib/quiz-defaults";
import { CLASSIC_COOLDOWN_SEC } from "@/lib/classic-defaults";

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

// MODULE_TITLE_MAX/MODULE_BLURB_MAX live in @/lib/modules (client-safe — see
// that file's comment on why they aren't defined in admin-store.ts), so this
// full-module mock has to supply them too.
vi.mock("@/lib/modules", () => ({ enabledModules, MODULE_TITLE_MAX: 60, MODULE_BLURB_MAX: 200 }));

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
  classicCooldownSec: null,
  teamMaxMembers: null,
  scoreCooldownMin: null,
  scoringStartsAt: null,
  scoringEndsAt: null,
  registrationStartsAt: null,
  registrationEndsAt: null,
  updatedBy: null,
  updatedAt: null,
  moduleOverrides: {},
};

describe("AdminControls tab shell", () => {
  it("renders one tab per enabled module plus the four control-plane tabs", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Event");
    expect(html).toContain("Admins");
    expect(html).toContain("Support");
    expect(html).toContain("Insights");
    expect(html).toContain("Secure Development");
    expect(html).toContain("Quiz");
    // Event + Admins + Support + Insights + the two modules. The four
    // control-plane tabs are not modules, so all four are present regardless
    // of what the event enables.
    expect(html.match(/role="tab"/g)?.length).toBe(6);
  });

  it("labels a module tab with its resolved title", () => {
    const html = renderToStaticMarkup(
      <AdminControls viewerLogin="organizer" initial={settings} modules={[{ id: "quiz", title: "Round 1" }] as never} />,
    );
    expect(html).toContain("Round 1");
  });

  it("renders every tab panel so only visibility is conditional", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    expect(html.match(/role="tabpanel"/g)?.length).toBe(6);
    // Exactly the five non-selected panels carry `hidden`.
    expect(html.match(/hidden=""/g)?.length).toBe(5);
  });

  it("wires each tab to its panel for assistive tech", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    for (const id of ["event", "admins", "support", "insights", "secure-development", "quiz"]) {
      expect(html).toContain(`id="tab-${id}"`);
      expect(html).toContain(`aria-controls="panel-${id}"`);
      expect(html).toContain(`aria-labelledby="tab-${id}"`);
    }
  });

  it("marks exactly one tab selected, and it is Event", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    expect(html.match(/aria-selected="true"/g)?.length).toBe(1);
    // Which one matters: an organizer opening /admin lands on the
    // control-plane settings, not on whichever module happens to be first.
    expect(html).toContain('id="tab-event" aria-selected="true"');
    // …and it is the Event panel that is visible, not a hidden one.
    expect(panelFor(html, "event")).not.toContain('hidden=""');
  });

  it("gives only the selected tab a reachable tabIndex (roving tabindex)", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    expect(html.match(/tabindex="0"/gi)?.length).toBe(1);
    expect(html.match(/tabindex="-1"/gi)?.length).toBe(5);
  });
});

describe("AdminControls panel contents", () => {
  it("puts hint controls in the Secure Development panel, not Event", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
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
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    const eventPanel = panelFor(html, "event");
    expect(eventPanel).toContain("Freeze scoring");
    expect(eventPanel).toContain("Team registration open");
    expect(eventPanel).toContain("Schedule (auto dates)");
    expect(eventPanel).toContain("Danger zone");
  });

  it("renders the quiz module's settings and question authoring in its own panel", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    const quizPanel = panelFor(html, "quiz");
    expect(quizPanel).toContain("Max attempts");
    expect(quizPanel).toContain("Retry after (min)");
    expect(quizPanel).toContain("Add question");
    expect(html).not.toContain("No settings for this module yet.");
  });

  it("drops a module's panel entirely when it is not enabled", () => {
    const html = renderToStaticMarkup(
      <AdminControls viewerLogin="organizer" initial={settings} modules={twoModules.filter((m) => m.id !== "secure-development")} />,
    );
    // Event + Admins + Support + Insights + quiz. The control-plane tabs
    // survive a module being disabled, because none of them is a module tab.
    expect(html.match(/role="tabpanel"/g)?.length).toBe(5);
    expect(html).not.toContain("Hint cost");
    expect(() => panelFor(html, "secure-development")).toThrow();
  });

  it("shows the demo seed section only when demoMode is set", () => {
    const withoutDemo = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    expect(withoutDemo).not.toMatch(/seed demo data/i);

    const withDemo = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} demoMode />);
    expect(panelFor(withDemo, "event")).toMatch(/seed demo data/i);
  });
});

describe("AdminControls module identity fields", () => {
  it("renders a title and blurb field in each module panel", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    expect(panelFor(html, "quiz")).toContain('name="moduleTitle:quiz"');
    expect(panelFor(html, "quiz")).toContain('name="moduleBlurb:quiz"');
    expect(panelFor(html, "secure-development")).toContain('name="moduleTitle:secure-development"');
    expect(panelFor(html, "secure-development")).toContain('name="moduleBlurb:secure-development"');
    // Not in the Event panel — module identity is per-module, not global.
    expect(panelFor(html, "event")).not.toContain("moduleTitle:");
  });

  it("shows the stored override as the field value", () => {
    const s = { ...settings, moduleOverrides: { quiz: { title: "Round 1" } } };
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={s} modules={twoModules} />);
    expect(panelFor(html, "quiz")).toContain('value="Round 1"');
  });

  it("leaves the field blank (not the registry default) when there is no override", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    expect(panelFor(html, "quiz")).toContain('name="moduleTitle:quiz" value=""');
  });

  it("shows the registry default as the placeholder, so blank-restores-default is discoverable", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    const quizPanel = panelFor(html, "quiz");
    expect(quizPanel).toContain('placeholder="Quiz"');
    expect(quizPanel).toContain('placeholder="Answer security questions for points."');
    expect(quizPanel).toMatch(/blank/i);
  });

  it("caps the fields at the stored maxima", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    const quizPanel = panelFor(html, "quiz");
    expect(quizPanel).toContain('maxLength="60"');
    expect(quizPanel).toContain('maxLength="200"');
  });

  it("renders module identity as the first child of the module panel", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    const quizPanel = panelFor(html, "quiz");
    const identityAt = quizPanel.indexOf("Module identity");
    const questionsAt = quizPanel.indexOf("Add question");
    expect(identityAt).toBeGreaterThan(-1);
    expect(questionsAt).toBeGreaterThan(-1);
    expect(identityAt).toBeLessThan(questionsAt);
  });
});

// Every numeric admin input must SHOW the default it falls back to.
//
// The stored value is the organizer's OVERRIDE, which is null until they touch
// it — so `value={…}` alone renders an empty box. Beside help text reading
// "0 = unlimited" and "0 = no cooldown", an empty box states the opposite of
// the truth: the real defaults are 3 attempts, 5 minutes and 5 seconds.
//
// hint-defaults.ts already exists for exactly this bug on the hints TOGGLE
// (#89): "the admin toggle has to render the same default the server resolves,
// or it misreports the effective state". The number inputs were never brought
// along. This pins that they were.
describe("numeric inputs advertise their default", () => {
  const allModules = [
    { id: "secure-development", title: "Secure Development", blurb: "" },
    { id: "quiz", title: "Quiz", blurb: "" },
    { id: "classic", title: "Classic CTF", blurb: "" },
  ] as unknown as ResolvedModule[];

  it("renders a placeholder equal to the server-side fallback", () => {
    // `settings` here has no overrides, which is the state every fresh event
    // starts in — and the state in which these boxes rendered blank.
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={allModules} />);
    for (const def of [
      HINT_COST,
      HINT_MIN_SOLVES,
      HINT_UNLOCK_AFTER_MIN,
      QUIZ_MAX_ATTEMPTS,
      QUIZ_RETRY_AFTER_MIN,
      CLASSIC_COOLDOWN_SEC,
    ]) {
      expect(html).toContain(`placeholder="${def}"`);
    }
  });

  it("still shows the override, not the default, once one is set", () => {
    const overridden = { ...settings, hintCost: 42 } as AdminSettings;
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={overridden} modules={allModules} />);
    expect(html).toContain('value="42"');
  });
});
