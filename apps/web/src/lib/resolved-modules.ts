import "server-only";
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
 *  per-request instead, so a renamed module shows up without a rebuild. */
export async function getResolvedModules(): Promise<readonly ResolvedModule[]> {
  await connection();
  const overrides = await getAdminSettings()
    .then((s) => s.moduleOverrides)
    .catch(() => ({}));
  return resolveModules(overrides);
}
