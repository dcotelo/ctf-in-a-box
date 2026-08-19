// Clock math for the live countdowns, kept pure and React-free.
//
// Deliberately NOT a shared component or hook. Two callers tick to the same
// arithmetic but nothing else: the event countdown paints day/hour/minute/
// second blocks once a second on the landing page, while a quiz question's
// cooldown paints one short inline phrase and re-enables a form when it
// reaches zero. Sharing the arithmetic removes the duplication that would
// actually drift; sharing the plumbing would mean one component growing
// variants for two unrelated layouts.
//
// Every caller that ticks must still handle hydration itself: a live
// `Date.now()` read during render disagrees with the server's render and
// trips a mismatch. The established pattern in this codebase is to paint a
// stable placeholder for the server render AND the client's first paint, then
// start ticking from a `useEffect` — see `components/event-countdown.tsx`.

export type Remaining = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

/** Time left until `targetMs`, or `null` once it has passed. `null` rather
 *  than a zeroed struct so callers must decide what "done" looks like instead
 *  of rendering a row of zeroes by accident. */
export function getRemaining(targetMs: number, now: number = Date.now()): Remaining | null {
  const diff = targetMs - now;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  const totalSeconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

/** A short inline duration: "45s", "4m 12s", "1h 04m", "2d 3h".
 *
 *  Shows at most two units, largest first — enough to judge whether to wait
 *  or move on, without a row of numbers to parse. The seconds tick visibly
 *  under a minute and inside "Xm Ys", which is what makes a cooldown feel
 *  like it is running rather than stuck. */
export function formatCompact(remaining: Remaining): string {
  const { days, hours, minutes, seconds } = remaining;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
