/**
 * Hint policy defaults that BOTH the server and the admin UI need.
 *
 * `hint-store.ts` is `server-only`, so a Client Component cannot import from
 * it. The admin toggle has to render the same default the server resolves, or
 * it misreports the effective state — which is exactly the bug this file
 * exists to prevent: the toggle used to render `?? false` while the server
 * treated absent as ON, so a fresh event showed "off" while hints were live.
 *
 * Deliberately dependency-free: no `server-only`, no Redis, no env reads.
 */

/** Whether hints are on when an organizer has never touched the /admin
 *  toggle. Absent in `ctf:admin:settings` means "no override" — this is what
 *  it falls back to.
 *
 *  This is a hardcoded default, not an env var, on purpose. `/admin`'s toggle
 *  is the switch: it is live, persisted in Redis, and survives restarts,
 *  whereas an env var needs a container recreate to change. `HINT_COST` has
 *  always worked this way; hints-enabled was the odd one out. */
export const HINT_DEFAULT_ENABLED = true;
