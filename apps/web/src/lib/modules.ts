// CTF module registry. Registration is deliberate: a new vertical is code
// (an entry here) + config (a key under modules. in event.yaml) — never
// config alone. See the kit's docs/modules.md for the full contract.
import type { AppId } from "@/lib/apps";
import { eventConfig } from "@/lib/event-config";

export type ModuleId = "secure-development" | "quiz";

/** Context handed to a module's home-page copy so it can interpolate live
 *  facts (target counts, app names) without importing them itself. */
export type HomeContext = {
  appCount: number;
  appList: string;
  topAppsList: string;
  totalChallenges: number;
};

/** A module's contribution to the landing page. Plain data + pure functions —
 *  no JSX — so the registry stays importable from server and client alike. */
export type ModuleHome = {
  /** Uppercase kicker rendered under the event name. */
  tagline: string;
  /** The hero paragraph for this module. */
  intro: (ctx: HomeContext) => string;
  /** "What to expect" heading and lede. */
  expect: { heading: string; lede: string };
  /** Numbered how-it-works cards. */
  steps: (ctx: HomeContext) => { title: string; body: string }[];
  /** Optional CTA into the module's own route. */
  cta?: { href: string; label: string };
  /** Optional extra full-width section. */
  extra?: { kicker: string; heading: string; body: string };
};

export type ModuleDef = {
  id: ModuleId;
  displayName: string;
  description: string;
  /** Nav entry, rendered iff the module is enabled (module contract §5.4).
   *  Omitted by a module that has no contestant route yet. */
  nav?: { href: string; label: string };
  /** Targets this module owns; empty for modules that have none (e.g. quiz). */
  targets: readonly AppId[];
  /** Landing-page copy for this module, composed into `app/page.tsx` by the
   *  platform frame. Optional: a module with no `home` simply contributes
   *  nothing to the landing page, which is valid, not an error. Server code
   *  reaches it through `getModuleHome` — never off a ResolvedModule, which
   *  strips it so the object stays safe to hand to a Client Component. */
  home?: ModuleHome;
};

// Display metadata per registered module. Registration is deliberate: an entry
// here plus a key under `modules:` in event.yaml — never config alone.
const REGISTRY: Record<ModuleId, Omit<ModuleDef, "targets">> = {
  "secure-development": {
    id: "secure-development",
    displayName: "Secure Development",
    description: "Find the vulnerability, patch it for real, ship the fix as a PR.",
    nav: { href: "/challenges", label: "Challenges" },
    // Moved VERBATIM off app/page.tsx, curly apostrophes included: the JSX
    // spelled them `&rsquo;`, which React emits as a literal U+2019, so the
    // rendered bytes are unchanged. Retyping them as ASCII "'" would be a
    // silent copy change no test would notice.
    home: {
      tagline: "Secure Development CTF",
      intro: (ctx) =>
        `Break real vulnerabilities in ${ctx.appCount} OWASP training ${ctx.appCount === 1 ? "app" : "apps"}, patch them for real, and ship the fix as a GitHub pull request. CI validates your patch and scores it automatically. Practice the full secure development lifecycle, not just flag-hunting.`,
      expect: {
        heading: "This isn’t flag hunting. It’s the real fix workflow",
        lede: "Every challenge maps to a real, disclosed vulnerability class from the OWASP Top 10. You find it, patch it, and prove the fix with a passing regression test, the same loop a security engineer runs against a live codebase.",
      },
      steps: (ctx) => [
        {
          title: "Pick a target",
          body: `Choose from ${ctx.appCount} real, deliberately vulnerable OWASP ${ctx.appCount === 1 ? "app" : "apps"}: ${ctx.appList}.`,
        },
        {
          title: "Find the vulnerability",
          body: "Work through the OWASP Top 10 (Web and API) to identify a real flaw in the target's source. Please use AI. Point an agent at the codebase. That's the workflow this event is built to teach.",
        },
        {
          title: "Patch it and open a PR",
          body: "Fix the vulnerability in your fork, then submit a pull request against the repo's main branch. This is secure development, not flag hunting.",
        },
        {
          title: "Get scored automatically",
          body: "A GitHub Action runs that challenge's regression test against your patched app. A passing test scores points immediately, no manual grading.",
        },
      ],
      cta: { href: "/challenges", label: "Browse targets" },
      // "Please use AI" belongs to THIS module, not to the platform frame: it
      // says writing the patch with an agent is the skill the event exists to
      // build, which in a quiz-only event would read as an invitation to cheat.
      extra: {
        kicker: "Bring your agent",
        heading: "Please use AI",
        body: "This isn’t tolerated, it’s the point. Reviewing code, finding the flaw, and writing the patch with an AI agent is the skill this event exists to build. Bring whatever you already use (Claude Code, Copilot, Cursor, your own harness) and let it read the target.",
      },
    },
  },
  quiz: {
    id: "quiz",
    displayName: "Quiz",
    description: "Answer security questions for points.",
    nav: { href: "/quiz", label: "Quiz" },
    // Deliberately plain and factual, and deliberately silent on AI: the
    // secure-development module invites an agent because patching WITH one is
    // the skill it teaches; on a graded question set the same invitation would
    // read as permission to cheat.
    home: {
      tagline: "Quiz",
      intro: () =>
        "Answer security questions drawn from the OWASP Top 10. Every question carries its own point value, is graded the moment you submit it, and counts toward your place on the leaderboard.",
      expect: {
        heading: "Straight questions, scored on submit",
        lede: "Each question is multiple choice and graded automatically against a stored answer key. The organizers set how many attempts a question allows and how long you wait between them; both are shown on the question itself.",
      },
      steps: () => [
        {
          title: "Sign in with GitHub",
          body: "Sign in to claim your row on the leaderboard. Answers and points are recorded against your account, so you can leave and pick the set back up later.",
        },
        {
          title: "Work through the questions",
          body: "Take the set at your own pace. Each question shows what it is worth, how many attempts you have left, and whether it is still on cooldown from your last try.",
        },
        {
          title: "Get scored on submit",
          body: "Your answer is graded immediately against the answer key. Points land on your profile and the leaderboard with no manual review.",
        },
      ],
      cta: { href: "/quiz", label: "Take the quiz" },
    },
  },
};

export const enabledModules: readonly ModuleDef[] = eventConfig.modules.map((cfg) => ({
  ...REGISTRY[cfg.id],
  targets: cfg.id === "secure-development" ? cfg.targets : [],
}));

export function isModuleEnabled(id: ModuleId): boolean {
  return enabledModules.some((m) => m.id === id);
}

/** Organizer-authored, runtime overrides keyed by module id. Both fields are
 *  optional and an empty string means "no override" — see resolveModules. */
export type ModuleOverrides = Partial<Record<ModuleId, { title?: string; blurb?: string }>>;

/** Caps for organizer-authored per-module naming overrides (title/blurb).
 *  Defined here — not in `admin-store.ts`, which validates against them —
 *  because this module is client-safe and `admin-store.ts` is `server-only`;
 *  the admin panel's identity form (a Client Component) needs these numbers
 *  for its `maxLength` attributes and would break the client build if it
 *  imported them (or anything else) from admin-store by value. admin-store
 *  re-exports these two so it stays the single place server code looks for
 *  them. */
export const MODULE_TITLE_MAX = 60;
export const MODULE_BLURB_MAX = 200;

/** A module with its organizer-authored naming applied: identity only, and
 *  deliberately client-safe.
 *
 *  `displayName`/`description` are OMITTED rather than carried through: they
 *  are the registry DEFAULTS, and `title`/`blurb` are what a consumer must
 *  render. Keeping both on the same object made reading `.displayName` off a
 *  resolved module — silently ignoring the organizer's override — a plain
 *  property access with no type error. Dropping them turns that mistake into
 *  a compile failure.
 *
 *  `home` is OMITTED for a harder reason: `ModuleHome.intro` and
 *  `ModuleHome.steps` are FUNCTIONS, and resolved modules are handed straight
 *  from Server Components to `"use client"` components (the admin panel, the
 *  leaderboard). React's flight serializer throws "Functions cannot be passed
 *  directly to Client Components" on any function-valued prop, so a resolved
 *  module carrying `home` would 500 those pages the moment a module defines
 *  one. Keeping identity-only here makes that structurally impossible instead
 *  of a trap for the next module to opt into landing-page copy. Server code
 *  that needs the home block reads it from the registry — see
 *  `getModuleHome` in `@/lib/resolved-modules`. */
export type ResolvedModule = Omit<ModuleDef, "displayName" | "description" | "home"> & {
  title: string;
  blurb: string;
};

/** Merge registry defaults with organizer overrides. Pure — no I/O — so it is
 *  testable on its own and usable either side of the server boundary. An
 *  override for a module that isn't enabled has nothing to apply to and is
 *  simply absent from the result; an empty string is treated as unset so
 *  clearing a field in the admin UI restores the registry default. */
export function resolveModules(overrides: ModuleOverrides): readonly ResolvedModule[] {
  // Destructure the defaults OUT rather than spreading them through, so a
  // resolved module genuinely has no `displayName` to read by mistake — the
  // type and the runtime object agree. `home` goes the same way, and there it
  // is load-bearing rather than merely tidy: a type-level Omit alone would
  // leave the functions on the object, still crossing the RSC boundary and
  // still throwing. Stripping it here is what makes the result client-safe.
  // `home` is bound only to keep it out of `...rest` — being unused IS the
  // point, so the lint warning is silenced deliberately rather than worked
  // around by re-spreading and deleting.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return enabledModules.map(({ displayName, description, home, ...rest }) => {
    const o = overrides[rest.id];
    return {
      ...rest,
      title: o?.title?.trim() || displayName,
      blurb: o?.blurb?.trim() || description,
    };
  });
}
