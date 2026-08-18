import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { getAdminSettings } from "@/lib/admin-store";
import { resolveModules, type ResolvedModule } from "@/lib/modules";

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
