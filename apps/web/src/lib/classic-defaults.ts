/**
 * Classic submission-cooldown default that BOTH the server and the admin UI
 * need — see `hint-defaults.ts` for why this is a separate, dependency-free
 * module rather than a `server-only` store export.
 */

/** Seconds a contestant must wait between flag submissions on the same
 *  challenge. Seconds, not minutes: the job is blocking scripted brute force,
 *  not rationing tries. 0 (an admin override) means no cooldown — which is
 *  NOT the default. */
export const CLASSIC_COOLDOWN_SEC = 5;
