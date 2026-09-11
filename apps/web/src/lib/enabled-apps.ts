// Which of the six secure-development targets this event actually SERVES,
// at request time (issue #386, PR 2). apps.ts's `apps` catalogue is static —
// this is the runtime filter over it, mirroring how `enabled-modules.ts` sits
// on top of the static module registry.
//
// Built on `getAdminSettingsSnapshot` (enabled-modules.ts), never
// `getAdminSettings()` directly: that snapshot is the one `cache()`-wrapped
// settings read every other live-set question in a request shares, so a page
// that asks this module AND `getEnabledModuleIds`/`getResolvedModules` still
// pays for exactly one Redis read. Every export here is itself `cache()`-
// wrapped on top of that, so a page that calls several of them (a target
// list AND a total, say) costs one memoized filter, not several.
//
// Fails open to `DEFAULT_SECURE_DEV_TARGETS` (all six) on the same terms as
// the snapshot itself: `getAdminSettingsSnapshot` already resolves a failed
// read to `null`, and `null` here means "nothing stored", not "nothing
// enabled" — the same reading `normalizeSecureDevTargets` documents.
import "server-only";
import { cache } from "react";
import { apps, type AppId, type AppMeta } from "@/lib/apps";
import { DEFAULT_SECURE_DEV_TARGETS } from "@/lib/secure-dev-targets";
import { getAdminSettingsSnapshot } from "@/lib/enabled-modules";

/** The stored target list, in catalogue order, or the default (all six) when
 *  nothing is stored or the settings read failed. */
export const getSecureDevTargets = cache(async (): Promise<readonly AppId[]> => {
  const settings = await getAdminSettingsSnapshot();
  return settings?.secureDevTargets ?? DEFAULT_SECURE_DEV_TARGETS;
});

/** The catalogue entries for the live target list, in catalogue order —
 *  what every page that used to read the build-time `enabledApps` now
 *  reads instead. */
export const getEnabledApps = cache(async (): Promise<AppMeta[]> => {
  const live = new Set<AppId>(await getSecureDevTargets());
  return apps.filter((a) => live.has(a.id));
});

/** `getEnabledApps`, keyed by id — the runtime replacement for the old
 *  build-time `enabledAppsById`. */
export const getEnabledAppsById = cache(async (): Promise<Partial<Record<AppId, AppMeta>>> => {
  const enabled = await getEnabledApps();
  return Object.fromEntries(enabled.map((a) => [a.id, a])) as Partial<Record<AppId, AppMeta>>;
});

/** The live target list's summed challenge count and point ceiling — the
 *  runtime replacement for the old build-time `enabledTotalChallenges` /
 *  `enabledTotalMaxPoints`. */
export const getEnabledTotals = cache(async (): Promise<{ challenges: number; maxPoints: number }> => {
  const enabled = await getEnabledApps();
  return enabled.reduce(
    (totals, a) => ({
      challenges: totals.challenges + a.challengeCount,
      maxPoints: totals.maxPoints + a.maxPoints,
    }),
    { challenges: 0, maxPoints: 0 },
  );
});
