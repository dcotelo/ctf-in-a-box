import "server-only";
import { exportBundle as exportClassic } from "@/lib/classic-store";
import { exportBundle as exportQuiz } from "@/lib/quiz-store";
import { effectivePaused, getAdminSettings } from "@/lib/admin-store";
import { eventConfig } from "@/lib/event-config";
import { EVENT_BUNDLE_VERSION, EVENT_POLICY_FIELDS, type EventBundle, type EventPolicySettings } from "@/lib/event-io";

const SD_WARNING =
  "Secure Development is enabled — its content (target repos, forks, rubrics) is not in the box and is NOT included in this bundle.";
const LIVE_WARNING = "This event is live — do not publish this bundle while contestants can still play.";

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
