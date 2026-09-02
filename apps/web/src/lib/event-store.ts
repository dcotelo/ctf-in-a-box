import "server-only";
import { exportBundle as exportClassic, clearChallenges, importBundle as importClassic } from "@/lib/classic-store";
import { exportBundle as exportQuiz, clearQuestions, importBundle as importQuiz } from "@/lib/quiz-store";
import { effectivePaused, getAdminSettings, resetEvent, updateAdminSettings, type SettingsPatch } from "@/lib/admin-store";
import { eventConfig } from "@/lib/event-config";
import { EVENT_BUNDLE_VERSION, EVENT_POLICY_FIELDS, type EventBundle, type EventPolicySettings } from "@/lib/event-io";
import { bakedModuleIds, isModuleId, type ModuleId, type ModuleOverrides } from "@/lib/modules";

const SD_WARNING =
  "Secure Development is enabled — its content (target repos, forks, rubrics) is not in the box and is NOT included in this bundle.";
const LIVE_WARNING = "This event is live — do not publish this bundle while contestants can still play.";
const BRANDING_SKIPPED =
  "Event name, logo, and theme are baked at build time — rebuild with an updated event.yaml to fully repaint branding. Module title/blurb overrides were applied.";

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
  // Overwrite with the RESOLVED module set (the same value `isEnabled` above
  // decides inclusion from), never the raw `settings.enabledModuleIds` the
  // loop just copied. That raw value is `undefined` whenever there is no
  // runtime override (the common case), and JSON.stringify drops an
  // `undefined` key entirely — silently losing both the source event's
  // effective module selection on replay AND import's ability to report a
  // Secure-Development module as `skipped` (its reconciliation only fires
  // off a concrete array).
  policySettings.enabledModuleIds = enabledModuleIds;

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
 *  run state (`resetEvent`) and then REPLACES the box's content. Both
 *  archivable content stores (classic, quiz) are cleared unconditionally —
 *  not only the ones present in the bundle — and only then is each section
 *  actually present in the bundle imported (clear-both, then import-present
 *  — never the reverse, or a stale challenge the bundle doesn't carry would
 *  survive the "replace"). This is "replace-all into a box to replay THIS
 *  event": a quiz-only archive must leave the box with NO classic content,
 *  not the target's pre-existing classic content still sitting there ready
 *  to resurface if classic is later re-enabled. A module absent from the
 *  bundle ends up cleared but not re-imported — empty, matching the source.
 *  Refuses outright on a live event (see `EventLiveError`) — this must never
 *  run while contestants can still play.
 *
 *  Only `EVENT_POLICY_FIELDS` keys present in `bundle.settings` are applied
 *  to admin settings; schedule/run fields (`paused`, `scoringStartsAt`, etc.)
 *  are never in that allowlist (see event-io.ts's header) and so can never
 *  leak into the patch. Branding (`event.yaml`-baked name/logo/theme) and
 *  Secure Development content are outside what a bundle can carry at all —
 *  both are reported back in `skipped` rather than silently dropped.
 *
 *  Fail-fast ordering: the settings patch is built and applied FIRST, right
 *  after the live-guard and before anything destructive. `updateAdminSettings`
 *  VALIDATES the patch and throws `AdminValidationError` on a bad one (e.g. an
 *  `enabledModuleIds` naming a module the box wasn't built with, or any
 *  invalid module id) — applying it before `resetEvent`/clear/import means a
 *  malformed bundle is rejected with NOTHING destructive done yet, instead of
 *  failing after the board has already been wiped and half-replaced.
 *  `resetEvent` is safe to run after: it keeps `ctf:admin:settings` (see its
 *  own doc comment in admin-store.ts) — it only freezes scoring and bumps the
 *  reset epoch — so it can never clobber the policy fields just written.
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

  // Apply (and validate) the settings patch BEFORE any destructive step. A
  // bad bundle throws `AdminValidationError` here, before `resetEvent` or any
  // clear/import has run — see the fail-fast note above.
  const { patch, skipped: moduleSkipped } = buildPolicyPatch(bundle.settings);
  if (Object.keys(patch).length > 0) {
    await updateAdminSettings(patch, actor);
  }

  // Sweep run-state before touching content, so a mid-import failure never
  // leaves stale team/solve/hint state pointing at content that no longer
  // exists.
  await resetEvent(actor);

  // Replace-ALL: both archivable content stores are cleared regardless of
  // which module sections this bundle carries. A quiz-only archive must wipe
  // any classic content already on the target (and vice-versa) — this is a
  // replace of the box's whole content state to match the archive, not a
  // merge, so stale content from a module absent in the bundle must not
  // resurface later if that module gets re-enabled.
  await clearChallenges();
  await clearQuestions();

  const summary: EventImportSummary = {};

  if (bundle.classic) {
    const c = await importClassic(bundle.classic);
    summary.classic = { created: c.created, updated: c.updated };
  }

  if (bundle.quiz) {
    const q = await importQuiz(bundle.quiz);
    summary.quiz = { created: q.created, updated: q.updated };
  }

  const skipped: string[] = [BRANDING_SKIPPED, ...moduleSkipped];

  return { summary, skipped };
}

const SD_ID: ModuleId = "secure-development";

/** Reconciles a bundle's `enabledModuleIds` against the BOX's own baked
 *  module set (`bakedModuleIds`, from `event.yaml`'s `modules:` at build
 *  time) before it ever reaches `updateAdminSettings`. `updateAdminSettings`
 *  throws `AdminValidationError` on any set whose `secure-development`
 *  membership differs from `bakedModuleIds` in either direction
 *  (admin-store.ts's "Refusal 2") — importing an SD-enabled event's archive
 *  into a non-SD box, or a non-SD archive into an SD box, must not 500. It
 *  should apply everything the box can actually serve and report the rest,
 *  never throw.
 *
 *  - Drops any id the box was not built with — a module that cannot run
 *    without its build-time config/services. `secure-development` is the
 *    only module id that currently carries such a requirement (its own
 *    scorer/sync services and provisioned forks), so in practice this only
 *    ever drops that one id.
 *  - If the box WAS built with `secure-development` but the reconciled set
 *    doesn't carry it, `secure-development` is added back — admin-store
 *    refuses to let an SD box ever end up with SD disabled at runtime (the
 *    other direction of Refusal 2).
 *
 *  Either adjustment is reported back via `skipped` so the caller can
 *  surface it; a set that already matches the box produces no messages. */
function reconcileEnabledModuleIds(incoming: ModuleId[]): { ids: ModuleId[]; skipped: string[] } {
  const skipped: string[] = [];
  const kept = incoming.filter((id) => {
    if (bakedModuleIds.includes(id)) return true;
    skipped.push(`Module "${id}" cannot be imported — this box was not built with it, so it was dropped from enabled modules.`);
    return false;
  });

  if (bakedModuleIds.includes(SD_ID) && !kept.includes(SD_ID)) {
    skipped.push(
      "This box was built with Secure Development, which cannot be disabled at runtime — it was kept enabled even though the bundle's enabled modules did not include it.",
    );
    return { ids: [...kept, SD_ID], skipped };
  }

  return { ids: kept, skipped };
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
 *  analogue: an event can never end up with zero enabled modules).
 *
 *  `enabledModuleIds` is additionally reconciled against this box's baked
 *  module set via `reconcileEnabledModuleIds` before landing in the patch —
 *  see that function's doc comment. The reconciliation's own messages are
 *  returned alongside the patch so `importEventBundle` can fold them into
 *  its `skipped` array instead of letting a mismatch throw. */
function buildPolicyPatch(settings: EventPolicySettings): { patch: SettingsPatch; skipped: string[] } {
  const patch: SettingsPatch = {};
  const skipped: string[] = [];
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
      if (Array.isArray(ids) && ids.length > 0) {
        const reconciled = reconcileEnabledModuleIds(ids);
        skipped.push(...reconciled.skipped);
        if (reconciled.ids.length > 0) patch.enabledModules = reconciled.ids;
      }
    } else {
      // The 10 scalar policy fields are `X | null` on AdminSettings/the
      // bundle (null = "no override"), but SettingsPatch types them
      // non-nullable and updateAdminSettings throws on a null. Skip, same as
      // the moduleOverrides/enabledModuleIds null guards above — forwarding
      // null here would round-trip a fresh export straight into a throw.
      if (value === null || value === undefined) continue;
      (patch as Record<string, unknown>)[field] = value;
    }
  }
  return { patch, skipped };
}
