import "server-only";
import { exportBundle as exportClassic, clearChallenges, importBundle as importClassic } from "@/lib/classic-store";
import { exportBundle as exportQuiz, clearQuestions, importBundle as importQuiz } from "@/lib/quiz-store";
import { effectivePaused, getAdminSettings, resetEvent, updateAdminSettings, type SettingsPatch } from "@/lib/admin-store";
import { eventConfig } from "@/lib/event-config";
import { EVENT_BUNDLE_VERSION, EVENT_POLICY_FIELDS, type EventBundle, type EventPolicySettings } from "@/lib/event-io";
import { isModuleId, type ModuleId, type ModuleOverrides } from "@/lib/modules";

const SD_WARNING =
  "Secure Development is enabled — its content (target repos, forks, rubrics) is not in the box and is NOT included in this bundle.";
const LIVE_WARNING = "This event is live — do not publish this bundle while contestants can still play.";
const BRANDING_SKIPPED =
  "Event name, logo, and theme are baked at build time — rebuild with an updated event.yaml to fully repaint branding. Module title/blurb overrides were applied.";
const SD_IMPORT_SKIPPED = "Secure Development content cannot be imported from a bundle.";

/** Assembles a whole-EVENT archive bundle for export: event metadata + policy
 *  settings + each enabled content module's own bundle. This is an
 *  ALLOWLIST, never a scan — the only sources it ever reads are the content
 *  modules' own `exportBundle()` (which themselves only read their own
 *  challenge/question definitions, never solves/attempts), the
 *  `EVENT_POLICY_FIELDS`-picked subset of `getAdminSettings()`, and the
 *  handful of `eventConfig` fields picked below. No `ctf:user:*`/
 *  `ctf:team:*`/solve/attempt/hint/audit key is ever touched here.
 *
 *  `bundle.event` deliberately omits `contactEmail`, `admins`, `githubOrg`
 *  and `discordUrl` — organizer PII that is neither needed to replay the
 *  event nor safe to hand out in a bundle an organizer might publish or
 *  share. `bundle.settings` deliberately omits every schedule/run field
 *  (`scoringStartsAt`/`EndsAt`, `registrationStartsAt`/`EndsAt`, `paused`,
 *  `updatedBy`, `updatedAt`) — those are per-EVENT-RUN state, not portable
 *  policy (see event-io.ts's header). */
export async function exportEventBundle(now: Date = new Date()): Promise<{ bundle: EventBundle; warnings: string[] }> {
  const settings = await getAdminSettings();
  const warnings: string[] = [];

  const enabledModuleIds = settings.enabledModuleIds ?? eventConfig.modules.map((m) => m.id);
  const isEnabled = (id: string) => enabledModuleIds.includes(id as (typeof enabledModuleIds)[number]);

  if (isEnabled("secure-development")) {
    warnings.push(SD_WARNING);
  }
  if (!effectivePaused(settings, now.getTime())) {
    warnings.push(LIVE_WARNING);
  }

  const policySettings: EventPolicySettings = {};
  for (const field of EVENT_POLICY_FIELDS) {
    policySettings[field] = (settings as unknown as Record<string, unknown>)[field];
  }

  const bundle: EventBundle = {
    version: EVENT_BUNDLE_VERSION,
    kind: "archive",
    event: {
      name: eventConfig.name,
      theme: eventConfig.theme,
      dates: eventConfig.dates,
      location: eventConfig.location,
      ctfStartsAt: eventConfig.ctfStartsAt,
    },
    settings: policySettings,
    ...(isEnabled("classic") ? { classic: await exportClassic() } : {}),
    ...(isEnabled("quiz") ? { quiz: await exportQuiz() } : {}),
  };

  return { bundle, warnings };
}

/** Thrown by `importEventBundle`'s live guard. Maps to a 409 at the route via
 *  `instanceof` — never caught here, and never wrapped in a generic Error, so
 *  that mapping stays reliable. */
export class EventLiveError extends Error {}

export type EventImportSummary = {
  classic?: { created: number; updated: number };
  quiz?: { created: number; updated: number };
};

/** Replace-all import of a whole-EVENT archive bundle. Destructive: it wipes
 *  run state (`resetEvent`) and then REPLACES each content module present in
 *  the bundle (clear, then import — never the reverse, or a stale challenge
 *  the bundle doesn't carry would survive the "replace"). Refuses outright on
 *  a live event (see `EventLiveError`) — this must never run while
 *  contestants can still play.
 *
 *  Only `EVENT_POLICY_FIELDS` keys present in `bundle.settings` are applied
 *  to admin settings; schedule/run fields (`paused`, `scoringStartsAt`, etc.)
 *  are never in that allowlist (see event-io.ts's header) and so can never
 *  leak into the patch. Branding (`event.yaml`-baked name/logo/theme) and
 *  Secure Development content are outside what a bundle can carry at all —
 *  both are reported back in `skipped` rather than silently dropped.
 *
 *  The caller (the route) owns writing the `event-import` audit entry, the
 *  same split classic/quiz import routes already use. */
export async function importEventBundle(
  bundle: EventBundle,
  actor: string,
  now: Date = new Date(),
): Promise<{ summary: EventImportSummary; skipped: string[] }> {
  // Guard FIRST: nothing destructive below this line may run before the
  // event is confirmed non-live.
  const settings = await getAdminSettings();
  if (!effectivePaused(settings, now.getTime())) {
    throw new EventLiveError("Refusing to import into a live event — pause scoring first.");
  }

  // Sweep run-state before touching content, so a mid-import failure never
  // leaves stale team/solve/hint state pointing at content that no longer
  // exists.
  await resetEvent(actor);

  const summary: EventImportSummary = {};

  if (bundle.classic) {
    await clearChallenges();
    const c = await importClassic(bundle.classic);
    summary.classic = { created: c.created, updated: c.updated };
  }

  if (bundle.quiz) {
    await clearQuestions();
    const q = await importQuiz(bundle.quiz);
    summary.quiz = { created: q.created, updated: q.updated };
  }

  const patch = buildPolicyPatch(bundle.settings);
  if (Object.keys(patch).length > 0) {
    await updateAdminSettings(patch, actor);
  }

  const skipped: string[] = [BRANDING_SKIPPED];
  const enabledModuleIds = bundle.settings.enabledModuleIds;
  if (Array.isArray(enabledModuleIds) && enabledModuleIds.includes("secure-development")) {
    skipped.push(SD_IMPORT_SKIPPED);
  }

  return { summary, skipped };
}

/** Translates the bundle's `EVENT_POLICY_FIELDS` allowlist into the shape
 *  `updateAdminSettings` actually accepts. Most fields are 1:1 by name, but
 *  two are not — `moduleOverrides` (a nested `{id: {title, blurb}}` map on
 *  read) has to flatten to the dynamic `moduleTitle:<id>`/`moduleBlurb:<id>`
 *  keys `updateAdminSettings` recognizes, and `enabledModuleIds` (the
 *  read-side name) writes under `enabledModules` (the write-side name).
 *  Copying either field's name straight through would make
 *  `updateAdminSettings` reject it as an unknown setting. A `null`/empty
 *  value for either is treated as "nothing to apply" rather than forwarded —
 *  `enabledModules` in particular refuses an empty array (ADR 24's runtime
 *  analogue: an event can never end up with zero enabled modules). */
function buildPolicyPatch(settings: EventPolicySettings): SettingsPatch {
  const patch: SettingsPatch = {};
  for (const field of EVENT_POLICY_FIELDS) {
    if (!(field in settings)) continue;
    const value = settings[field];
    if (field === "moduleOverrides") {
      const overrides = value as ModuleOverrides | null | undefined;
      if (!overrides) continue;
      for (const [id, slot] of Object.entries(overrides)) {
        if (!isModuleId(id) || !slot) continue;
        if (slot.title !== undefined) patch[`moduleTitle:${id}`] = slot.title;
        if (slot.blurb !== undefined) patch[`moduleBlurb:${id}`] = slot.blurb;
      }
    } else if (field === "enabledModuleIds") {
      const ids = value as ModuleId[] | null | undefined;
      if (Array.isArray(ids) && ids.length > 0) patch.enabledModules = ids;
    } else {
      (patch as Record<string, unknown>)[field] = value;
    }
  }
  return patch;
}
