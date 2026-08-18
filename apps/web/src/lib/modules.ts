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
  /** Landing-page copy for this module. Undefined until a module opts in
   *  (see Task 7); the type is declared here so later tasks never need to
   *  retro-edit this file's type declarations. */
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
  },
  quiz: {
    id: "quiz",
    displayName: "Quiz",
    description: "Answer security questions for points.",
    nav: { href: "/quiz", label: "Quiz" },
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
