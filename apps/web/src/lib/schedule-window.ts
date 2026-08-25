// The scheduled-window check, in a dependency-free leaf.
//
// This is the app's copy of the pause/schedule contract's window logic —
// kept IDENTICAL in scorer/src/store.js and sync/src/redis.js; change all
// three together (AGENTS.md: "the pause/schedule contract lives in THREE
// readers"). It lives here rather than in admin-store.ts because admin-store
// is `server-only` and the /admin Event tab (a Client Component) needs the
// same function to render its "right now" readout — a client-side
// re-implementation would have been a FOURTH copy of the contract, which is
// the exact drift the three-reader rule exists to prevent. admin-store
// re-exports it, so its own callers and tests are unchanged.

/** True when a scheduled window puts `now` outside [startsAt, endsAt].
 *  Unparseable/absent bounds are ignored (treated as no bound) so a bad
 *  value can never wedge scoring off. */
export function outsideWindow(nowMs: number, startsAt: string | null, endsAt: string | null): boolean {
  const s = startsAt ? Date.parse(startsAt) : NaN;
  const e = endsAt ? Date.parse(endsAt) : NaN;
  if (Number.isFinite(s) && nowMs < s) return true;
  if (Number.isFinite(e) && nowMs > e) return true;
  return false;
}
