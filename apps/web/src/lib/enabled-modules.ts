import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { getAdminSettings } from "@/lib/admin-store";
import { bakedModuleIds, type ModuleId } from "@/lib/modules";

export { bakedModuleIds };

/** Which modules this event is serving RIGHT NOW (issue #175).
 *
 *  The runtime set from `ctf:admin:settings`, falling back to `event.yaml`'s
 *  baked set. That fallback is the whole safety story and it fails **OPEN**:
 *  a Redis blip during an event must render the modules the box was built
 *  with, never "nothing is enabled". Resolving an outage to an empty set would
 *  404 every live module at once — the loudest possible failure, from the
 *  quietest possible cause.
 *
 *  This is deliberately the same shape as `getResolvedModules` above, and
 *  shares its two load-bearing details:
 *
 *  - `await connection()` keeps it out of the build-time prerender, where
 *    Upstash is unreachable on purpose. Without it, Next bakes the one-shot
 *    fallback into static HTML and a runtime toggle never takes effect.
 *  - `cache()` dedupes the read WITHIN a request — layout, `generateMetadata`
 *    and the page body all ask, one read happens. Request-scoped ONLY: React
 *    resets it between requests, so a toggle is live on the very next one.
 *    Do not add a TTL or any cross-request cache here.
 *
 *  Note what this does NOT do: disabling a module writes nothing to its data.
 *  A disabled module's answers, solves and attempts stay exactly where they
 *  are, so re-enabling restores the same board. The toggle is a switch, not a
 *  delete. */
export const getEnabledModuleIds = cache(async (): Promise<ReadonlySet<ModuleId>> => {
  await connection();
  const ids = await getAdminSettings()
    .then((s) => s.enabledModuleIds)
    .catch(() => null);
  return new Set(ids ?? bakedModuleIds);
});

/** Is this module live on this event right now? The async replacement for
 *  `isModuleEnabled`, which reads the baked set and therefore cannot see a
 *  runtime toggle. Prefer `getEnabledModuleIds` directly when a caller asks
 *  about more than one module — it is one memoized read either way, but the
 *  set reads better than three awaits in a row. */
export async function isModuleLive(id: ModuleId): Promise<boolean> {
  return (await getEnabledModuleIds()).has(id);
}
