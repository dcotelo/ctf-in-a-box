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

/** The next instant strictly after `nowMs` at which `outsideWindow` flips for
 *  any of `windows`, or null when no bound lies ahead. A start bound flips at
 *  the bound itself (`now < s` stops holding); an end bound flips one ms
 *  after it (`now > e` starts holding). Unparseable bounds are ignored, as
 *  outsideWindow ignores them. App-only: the /admin shell uses it to re-stamp
 *  the "Right now" readout when a window opens or closes while the page is
 *  open, so the clock read stays in a timer callback rather than in render. */
export function nextScheduleBoundary(
  nowMs: number,
  windows: ReadonlyArray<{ startsAt: string | null; endsAt: string | null }>,
): number | null {
  let next: number | null = null;
  const consider = (at: number) => {
    if (Number.isFinite(at) && at > nowMs && (next === null || at < next)) next = at;
  };
  for (const { startsAt, endsAt } of windows) {
    if (startsAt) consider(Date.parse(startsAt));
    if (endsAt) consider(Date.parse(endsAt) + 1);
  }
  return next;
}
