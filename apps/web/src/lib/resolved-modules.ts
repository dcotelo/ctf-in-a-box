import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { getAdminSettings } from "@/lib/admin-store";
import { buildNavLinks, type NavLink } from "@/lib/site";
import {
  enabledModules,
  resolveModules,
  type ModuleGuide,
  type ModuleHome,
  type ModuleId,
  type ModuleRules,
  type ResolvedModule,
} from "@/lib/modules";

/** Modules with their organizer-authored names applied.
 *
 *  Fails OPEN: a settings-read failure resolves to registry defaults rather
 *  than throwing. This is deliberately the opposite of the quiz gates, which
 *  fail closed — a wrong display name is cosmetic, while a wrong gate decision
 *  awards points. A Redis outage should render the stock nav, not a header
 *  with no links in it.
 *
 *  `await connection()` before the read is load-bearing, not decorative:
 *  this function has no Request-time API (no `cookies`/`headers`), so
 *  without it Next would happily prerender the root layout at BUILD time —
 *  against an Upstash that is deliberately unreachable during the Docker
 *  build (see Dockerfile) — and bake that one-shot fallback into the static
 *  HTML for every route that doesn't otherwise opt out of prerendering.
 *  `connection()` forces this (and therefore the whole nav) to resolve
 *  per-request instead, so a renamed module shows up without a rebuild.
 *
 *  Wrapped in React's `cache()` (the vendored Next docs' own prescription for
 *  non-`fetch` memoization — see the App Router glossary's "Memoization"
 *  entry) so the settings read is deduped WITHIN one request: the root
 *  layout (nav), a page's `generateMetadata`, and that same page's body can
 *  all call this and only the first pays for `getAdminSettings()`. This is
 *  request-scoped only — React resets the cache between requests — so it
 *  does NOT reintroduce the stale-until-rebuild bug Task 3 fixed: an
 *  organizer's rename is still live on the very next request. Do not add a
 *  TTL or any cross-request cache here. */
export const getResolvedModules = cache(async (): Promise<readonly ResolvedModule[]> => {
  await connection();
  const overrides = await getAdminSettings()
    .then((s) => s.moduleOverrides)
    .catch(() => ({}));
  return resolveModules(overrides);
});

/** The site nav, with organizer renames applied — the ONE accessor every
 *  surface that renders those links must go through.
 *
 *  Both the header (root layout) and the footer (the `(site)` layout, the
 *  landing page, and the 404) render the same link list, and they used to
 *  build it two different ways: the header off resolved modules, the footer
 *  off `site.ts`'s static `navLinks`. A rename then showed up in one and not
 *  the other, so the two disagreed on every page of the site. Funnelling both
 *  through here is what makes that class of drift impossible rather than
 *  merely fixed once; `site-nav-parity.test.tsx` pins it.
 *
 *  Inherits `getResolvedModules`' fail-open behaviour and its per-request
 *  memoization: several callers on one page cost one settings read. */
export async function getNavLinks(): Promise<NavLink[]> {
  return buildNavLinks(await getResolvedModules());
}

/** A module's landing-page contribution, read straight from the registry
 *  (there is nothing organizer-authored about it — only `title`/`blurb` are
 *  overridable, and those live on the resolved module).
 *
 *  This is deliberately a SEPARATE, server-only accessor rather than a field
 *  on `ResolvedModule`: `ModuleHome.intro` and `ModuleHome.steps` are
 *  functions, and a resolved module is passed to Client Components, where a
 *  function-valued prop is a hard flight-serialization error. Keeping the two
 *  apart means the client-safe object stays client-safe by construction.
 *
 *  Callers must be Server Components: call `intro`/`steps` here and pass the
 *  resulting STRINGS down, never the `ModuleHome` itself. Pair a home block
 *  with its organizer-resolved name by looking both up by `id`. Returns
 *  `undefined` for a module that is disabled or has no home block. */
export function getModuleHome(id: ModuleId): ModuleHome | undefined {
  return enabledModules.find((m) => m.id === id)?.home;
}

/** A module's `/how-to-play` contribution. Same contract as `getModuleHome`:
 *  server-only, read straight from the registry, and its functions
 *  (`steps`, `example`) must be CALLED here so only strings travel onward. */
export function getModuleGuide(id: ModuleId): ModuleGuide | undefined {
  return enabledModules.find((m) => m.id === id)?.guide;
}

/** A module's `/rules` bullets. Itself a function of `RulesContext`, so it
 *  carries the same server-only contract as the other two accessors. */
export function getModuleRules(id: ModuleId): ModuleRules | undefined {
  return enabledModules.find((m) => m.id === id)?.rules;
}
