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

export type ResolvedModule = ModuleDef & { title: string; blurb: string };

/** Merge registry defaults with organizer overrides. Pure — no I/O — so it is
 *  testable on its own and usable either side of the server boundary. An
 *  override for a module that isn't enabled has nothing to apply to and is
 *  simply absent from the result; an empty string is treated as unset so
 *  clearing a field in the admin UI restores the registry default. */
export function resolveModules(overrides: ModuleOverrides): readonly ResolvedModule[] {
  return enabledModules.map((m) => {
    const o = overrides[m.id];
    return {
      ...m,
      title: o?.title?.trim() || m.displayName,
      blurb: o?.blurb?.trim() || m.description,
    };
  });
}
