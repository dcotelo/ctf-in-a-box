import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { getAdminSettings } from "@/lib/admin-store";
import { defaultEnabledModules } from "@/lib/module-defaults";
import type { ModuleId } from "@/lib/modules";

/** The module set this deployment starts with, and falls back to: computed
 *  once from the server's env (issue #386). Secure Development when a scorer
 *  image exists, otherwise nothing — quiz, classic and ai are switched on from
 *  /admin. Server-only on purpose: SCORE_IMAGE is not in the client bundle. */
export const defaultModuleIds: readonly ModuleId[] = defaultEnabledModules(process.env);

/** Which modules this event is serving RIGHT NOW.
 *
 *  The stored set from `ctf:admin:settings` wins, including an explicitly
 *  empty one — an organizer who switched every board off meant it. Only when
 *  NOTHING is stored (`null`), or the read fails, does the default apply. The
 *  read fails **open** to that default: a Redis blip must render the modules
 *  this deployment was brought up for, never a surprise. Two load-bearing
 *  details, shared with `getResolvedModules`:
 *
 *  - `await connection()` keeps the read out of the build-time prerender.
 *  - `cache()` dedupes WITHIN a request only; a toggle is live on the next.
 *
 *  Disabling a module writes nothing to its data — the toggle is a switch. */
export const getEnabledModuleIds = cache(async (): Promise<ReadonlySet<ModuleId>> => {
  await connection();
  const ids = await getAdminSettings()
    .then((s) => s.enabledModuleIds)
    .catch(() => null);
  return new Set(ids ?? defaultModuleIds);
});

export async function isModuleLive(id: ModuleId): Promise<boolean> {
  return (await getEnabledModuleIds()).has(id);
}
