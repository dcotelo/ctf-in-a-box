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
import { AI_COOLDOWN_SEC } from "@/lib/ai-defaults";

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
// full-module mock has to supply them too. `ALL_MODULE_IDS`, `moduleDefById`
// and `bakedModuleIds` came with runtime enablement (issue #175): the panel
// builds its module toggle rows off the WHOLE registry, not the enabled
// subset, so it can offer a disabled module's switch at all.
vi.mock("@/lib/modules", () => ({
  enabledModules,
  bakedModuleIds: enabledModules.map((m) => m.id),
  ALL_MODULE_IDS: ["secure-development", "quiz", "classic"],
  moduleDefById: (id: string) =>
    ({
      "secure-development": { displayName: "Secure Development", description: "" },
      quiz: { displayName: "Quiz", description: "Answer security questions for points." },
      classic: { displayName: "Classic CTF", description: "" },
    })[id],
  MODULE_TITLE_MAX: 60,
  MODULE_BLURB_MAX: 200,
}));

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
  aiCooldownSec: null,
  teamMaxMembers: null,
  scoreCooldownMin: null,
  scoringStartsAt: null,
  scoringEndsAt: null,
  registrationStartsAt: null,
  registrationEndsAt: null,
  updatedBy: null,
  updatedAt: null,
  moduleOverrides: {},
  enabledModuleIds: null,
};

describe("AdminControls tab shell", () => {
  it("renders one sidebar destination per enabled module plus the six control-plane destinations", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    expect(html).toContain('aria-label="Admin sections"');
    expect(html).toContain("Overview");
    expect(html).toContain("Event");
    expect(html).toContain("Admins");
    expect(html).toContain("Support");
    expect(html).toContain("Activity");
    expect(html).toContain("Insights");
    expect(html).toContain("Secure Development");
    expect(html).toContain("Quiz");
    // Overview + Event + Hints + Admins + Support + Activity + Insights + the
    // two modules. The seven control-plane destinations are not modules, so
    // all seven are present regardless of what the event enables.
    expect(html.match(/href="\?tab=/g)?.length).toBe(9);
  });

  // Setup instructions are a registry contract (`ModuleDef.setup`), resolved
  // server-side and handed down as plain data. The shell renders them as the
  // FIRST child of every module panel — before the identity editor — from
  // the `setups` prop alone, so a fifth module gets its panel with no
  // per-module branch here.
  it("opens a module panel with its setup checklist, ahead of the identity editor", () => {
    const html = renderToStaticMarkup(
      <AdminControls
        viewerLogin="organizer"
        initial={settings}
        modules={twoModules}
        setups={{
          quiz: {
            experience: "Contestants answer questions and are graded on submit.",
            steps: [{ title: "Author at least one question", where: "panel", check: { count: "items", noun: "questions" } }],
            midEvent: { safe: ["Retry knobs."], unsafe: ["Correct answers."] },
            docs: { href: "https://example.test/operations#quiz", label: "Quiz guide" },
          },
        }}
      />,
    );
    const quiz = panelFor(html, "quiz");
    const setupAt = quiz.indexOf("Contestants answer questions and are graded on submit.");
    const identityAt = quiz.indexOf('name="moduleTitle:quiz"');
    expect(setupAt).toBeGreaterThan(-1);
    expect(identityAt).toBeGreaterThan(-1);
    expect(setupAt).toBeLessThan(identityAt);
    // Nothing has reported a count yet on first paint, so the checkable step
    // says so rather than claiming there are no questions.
    expect(quiz).toContain("Checking…");
    // A module the registry gave no setup block renders no setup panel — and
    // nothing else in its panel changes.
    expect(panelFor(html, "secure-development")).not.toContain("Setting up");
  });

  // UX audit F3: the blurb help used to say "Not shown on any page … which
  // today means the quiz". The blurb IS rendered — as the page-header lede on
  // /quiz, /flags and /ai, and as those pages' meta description — so the one
  // sentence the field carried about itself was the one false claim on the
  // panel. The help now names the surfaces the docs name.
  it("tells the truth about where the blurb renders", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    const quiz = panelFor(html, "quiz");
    expect(quiz).not.toContain("Not shown on any page");
    expect(quiz).toMatch(/lede under the title/);
    expect(quiz).toMatch(/meta description/);
  });

  it("labels a module tab with its resolved title", () => {
    const html = renderToStaticMarkup(
      <AdminControls viewerLogin="organizer" initial={settings} modules={[{ id: "quiz", title: "Round 1" }] as never} />,
    );
    expect(html).toContain("Round 1");
  });

  it("renders every tab panel so only visibility is conditional", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    // Overview + Event + Hints + Admins + Support + Activity + Insights + the two modules.
    expect(html.match(/role="tabpanel"/g)?.length).toBe(9);
    // Exactly the eight non-selected panels carry `hidden`.
    expect(html.match(/hidden=""/g)?.length).toBe(8);
  });

  it("names each panel for assistive tech and links the sidebar to it", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    for (const [id, label] of [
      ["event", "Event"],
      ["admins", "Admins"],
      ["support", "Support"],
      ["insights", "Insights"],
      ["secure-development", "Secure Development"],
      ["quiz", "Quiz"],
    ]) {
      expect(html).toContain(`id="panel-${id}" aria-label="${label}"`);
      expect(html).toContain(`href="?tab=${id}"`);
    }
  });

  it("marks exactly one sidebar destination current, and it is Overview", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    // Which one matters: an organizer opening /admin with no deep link lands
    // on the state-at-a-glance screen, not on whichever module happens to be
    // first — and not on the settings form either.
    expect(html).toContain('href="?tab=overview" aria-current="page"');
    // …and it is the Overview panel that is visible, not a hidden one.
    expect(panelFor(html, "overview")).not.toContain('hidden=""');
  });

  it("replaces the old WAI-ARIA tabs widget entirely — every destination is a real, keyboard-reachable link", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain('role="tablist"');
    // No roving tabindex trick — a plain `<a>` needs none to be Tab-reachable.
    expect(html).not.toMatch(/tabindex="-1"/i);
  });
});

describe("AdminControls panel contents", () => {
  // Hints are event policy shared by every module that sells them (Secure
  // Development, Classic, AI — hint-store.ts reads the same four settings for
  // all three), so the knobs live on the Event tab. Parking them on Secure
  // Development's tab made them unreachable on any event without that
  // module (UX audit F1). Secure Development keeps the one knob that IS its
  // own: the re-run cooldown.
  it("puts the hint controls on their own Hints panel and leaves only the re-run cooldown on Secure Development", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    const secureDev = panelFor(html, "secure-development");
    const eventPanel = panelFor(html, "event");
    const hintsPanel = panelFor(html, "hints");
    expect(hintsPanel).toContain("Hints enabled");
    expect(hintsPanel).toContain("Hint cost");
    expect(hintsPanel).toContain("Hints: solves required");
    expect(hintsPanel).toContain("Hints: unlock after (min)");
    expect(eventPanel).not.toContain("Hint cost");
    expect(secureDev).toContain("Re-run cooldown (min)");
    expect(secureDev).not.toContain("Hint cost");
    expect(secureDev).not.toContain("Hints enabled");
  });

  it("says on the Hints panel which modules the hint policy reaches", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    const hintsPanel = panelFor(html, "hints");
    expect(hintsPanel).toMatch(/Secure Development, Classic CTF and AI Challenges/);
  });

  // UX audit F6: the unlock-after help used to say "a scoring start below",
  // a leftover from the flat layout. Now that Hints is its own destination
  // (not a section of Event), the field names WHERE to find Scoring opens
  // instead of pointing at a field on the same panel.
  it("points the unlock-after help at the Event tab, not 'below'", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    const hintsPanel = panelFor(html, "hints");
    expect(hintsPanel).toContain("on the Event tab");
    expect(hintsPanel).not.toContain("a scoring start below");
  });

  it("keeps freeze and registration in the Event panel", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    const eventPanel = panelFor(html, "event");
    expect(eventPanel).toContain("Freeze scoring");
    expect(eventPanel).toContain("Team registration open");
    expect(eventPanel).toContain("Schedule (auto dates)");
    expect(eventPanel).toContain("Danger zone");
  });

  // The schedule section states the EFFECTIVE state — toggle AND window,
  // through the shared outsideWindow — so the organizer never computes it in
  // their head from four datetime fields plus two toggles (issue #200, 3.3).
  it("states whether scoring and registration are live right now", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={twoModules} />);
    const eventPanel = panelFor(html, "event");
    // Fixture: not paused, no windows, registration open — both live.
    expect(eventPanel).toContain("Right now:");
    expect(eventPanel).toContain("scoring is live");
    expect(eventPanel).toContain("registration is open");
  });

  it("names WHY scoring is frozen — manual freeze vs a closed window", () => {
    const manuallyFrozen = renderToStaticMarkup(
      <AdminControls viewerLogin="organizer" initial={{ ...settings, paused: true }} modules={twoModules} />,
    );
    expect(panelFor(manuallyFrozen, "event")).toContain("scoring is frozen (manual)");

    const windowClosed = renderToStaticMarkup(
      <AdminControls
        viewerLogin="organizer"
        // A scoring window that ended long ago — the toggle is on, the
        // window is what froze it, and the readout must say which.
        initial={{ ...settings, scoringEndsAt: "2000-01-01T00:00:00.000Z" }}
        modules={twoModules}
      />,
    );
    expect(panelFor(windowClosed, "event")).toContain("scoring is frozen (outside its window)");
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
    // Overview + Event + Hints + Admins + Support + Activity + Insights +
    // quiz. The control-plane destinations survive a module being disabled,
    // because none of them is a module tab.
    expect(html.match(/role="tabpanel"/g)?.length).toBe(8);
    // The hint policy stays reachable: quiz has no hints, but classic and ai
    // do, and this event can switch either on at runtime.
    expect(panelFor(html, "hints")).toContain("Hint cost");
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

// Runtime module enablement (issue #175) — the panel half.
describe("module toggles", () => {
  const render = (overrides: Partial<typeof settings> = {}) =>
    renderToStaticMarkup(
      <AdminControls viewerLogin="organizer" initial={{ ...settings, ...overrides }} modules={twoModules} />,
    );

  it("offers a row for every registry module, including one this event has OFF", () => {
    // The whole point of the control is turning a module ON, so a module that
    // is currently off still needs a visible switch. Keying the list off the
    // enabled set would show only what is already running.
    const html = render({ enabledModuleIds: ["secure-development"] });
    expect(html).toContain("Classic CTF");
    expect(html).toContain("Quiz");
  });

  it("shows secure-development as not toggleable, with the reason", () => {
    // Not merely disabled: a dead control with no explanation reads as a bug.
    const html = render();
    expect(html).toMatch(/Configured at setup/);
  });

  it("says a disabled module's data survives, because that is the question an organizer has", () => {
    expect(render()).toMatch(/deletes nothing|Nothing is deleted/i);
  });

  it("does NOT lock a toggleable module while a non-toggleable one is still live", () => {
    // The bug this replaces: counting only TOGGLEABLE live modules locked quiz
    // on a secure-development + quiz event, on the grounds that quiz was the
    // last *switchable* module — while secure-development sat above it,
    // enabled and serving. Disabling quiz there leaves a perfectly legal event,
    // the server accepts it, and the UI used to refuse anyway.
    const html = render({ enabledModuleIds: ["secure-development", "quiz"] });
    expect(html).not.toContain("The only module left");
  });

  it("locks the last LIVE module instead of letting it be switched off", () => {
    // Genuinely the last one: nothing else is enabled, so switching it off
    // would leave the event serving nothing. The server refuses that (ADR 24's
    // runtime analogue); a control that always errors is worse than one that
    // explains itself.
    const html = render({ enabledModuleIds: ["quiz"] });
    expect(html).toContain("The only module left");
  });
});

// A SEPARATE fixture (not a mutation of `twoModules`/`settings` above) so the
// "7 tabs"/"7 panels" assertions in the first describe block stay pinned to
// exactly the module set they were written against — adding a third module
// to that shared fixture would silently need every one of those counts
// bumped to 8, and a forgotten one would pass for the wrong reason.
describe("AdminControls ai panel", () => {
  const withAi: readonly ResolvedModule[] = [
    ...twoModules,
    { id: "ai", title: "AI Challenges", blurb: "Prompt-injection and jailbreak challenges hosted externally.", targets: [] },
  ];

  it("renders the ai module's tab with a tenth destination and panel", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={withAi} />);
    expect(html).toContain("AI Challenges");
    expect(html.match(/href="\?tab=/g)?.length).toBe(10);
    expect(html.match(/role="tabpanel"/g)?.length).toBe(10);
  });

  it("renders AdminAiControls in the ai panel, not the fallback placeholder", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={withAi} />);
    const aiPanel = panelFor(html, "ai");
    expect(aiPanel).toContain("Submission cooldown (sec)");
    expect(aiPanel).toContain("Add challenge");
    expect(aiPanel).not.toContain("No settings for this module yet.");
  });

  it("keeps the ai cooldown field out of every other panel", () => {
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={withAi} />);
    expect(panelFor(html, "event")).not.toContain("Submission cooldown (sec)");
    expect(panelFor(html, "quiz")).not.toContain("Submission cooldown (sec)");
  });

  it("shows the ai cooldown override, falling back to the module default when unset", () => {
    const withDefault = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={settings} modules={withAi} />);
    expect(panelFor(withDefault, "ai")).toContain(`placeholder="${AI_COOLDOWN_SEC}"`);

    const overridden = { ...settings, aiCooldownSec: 42 };
    const html = renderToStaticMarkup(<AdminControls viewerLogin="organizer" initial={overridden} modules={withAi} />);
    expect(panelFor(html, "ai")).toContain('value="42"');
  });
});
