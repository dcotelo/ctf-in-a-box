/**
 * Scoring knobs shared by the server and the admin panel, in a module with NO
 * `server-only` marker — the panel is a Client Component and cannot import
 * `admin-store`. Same reasoning as `hint-defaults.ts` and `team-limits.ts`.
 */

/** Minutes between scored runs on the same PR when the organizer has set no
 *  override. MUST match `COOLDOWN_MINUTES` in
 *  `scorer/consumer-workflow.example.yml`, which is what a fork falls back to
 *  when it cannot reach the event. */
export const SCORE_COOLDOWN_MIN = 5;

/** Upper bound accepted for the override, in minutes. A day: long enough for
 *  any legitimate "one scored run per session" policy, short enough that a
 *  typo cannot silently freeze scoring for a week. */
export const SCORE_COOLDOWN_MIN_MAX = 1440;
