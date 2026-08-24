import { enabledApps as appList } from "@/lib/apps";
import AppChallengeList from "@/components/app-challenge-list";
import type { LeaderboardEntry } from "@/lib/leaderboard/types";

/** The contestant's per-target flag progress — extracted from `leaderboard.tsx`
 *  unchanged so it can be reused both as the pre-module fallback (a row with no
 *  `modules` map) and as secure-development's module detail block.
 *
 *  `showPoints` is opt-in and defaults to unset/falsy so every existing
 *  leaderboard call site (which passes none) renders byte-identically to
 *  before it existed. `/profile` is the one caller that sets it — the
 *  per-app `points / maxPoints` figure it shows is real data `AppProgress`
 *  already carries, just never rendered by this component until now. */
export default function AppBreakdown({ entry, showPoints }: { entry: LeaderboardEntry; showPoints?: boolean }) {
  const attempted = appList.filter((app) => entry.apps[app.id]);
  if (attempted.length === 0) {
    return <p className="text-sm text-muted">No app breakdown reported yet.</p>;
  }
  // Targets whose source carries the per-challenge catalogue get ONE card
  // holding both the stats and the collapsible list. This used to be two
  // sections — a stats grid, then a second card list repeating each target's
  // name and patched count verbatim just to host the list — so a profile
  // showed every target twice back to back (issue #200, 2.4). Targets
  // without a catalogue keep the compact grid.
  const withChallenges = attempted.filter((app) => (entry.apps[app.id]!.challenges?.length ?? 0) > 0);
  const gridOnly = attempted.filter((app) => (entry.apps[app.id]!.challenges?.length ?? 0) === 0);
  return (
    <div>
      {gridOnly.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {gridOnly.map((app) => {
            const progress = entry.apps[app.id]!;
            const pct = progress.total > 0 ? (progress.patched / progress.total) * 100 : 0;
            return (
              <div key={app.id} className="rounded-md border border-white/[0.06] bg-[#12121e] px-3 py-2">
                <p className="text-xs" style={{ color: app.accent }}>
                  {app.name}
                </p>
                {/* Sources without per-app point data (lambda) report
                    maxPoints 0 — showing "0 / 0 pts" reads as broken, so only
                    render the stat when it exists AND the caller opted in. */}
                {showPoints && progress.maxPoints > 0 && (
                  <p className="font-mono text-xs text-zinc-400">
                    {progress.points}
                    <span className="text-muted"> / {progress.maxPoints} pts</span>
                  </p>
                )}
                <p className="font-mono text-sm tabular-nums text-white">
                  {progress.patched}
                  <span className="ml-1 text-xs text-muted">/ {progress.total} patched</span>
                </p>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: app.accent }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {withChallenges.length > 0 && (
        <div className={`flex flex-col gap-3 ${gridOnly.length > 0 ? "mt-3" : ""}`}>
          {withChallenges.map((app) => {
            const progress = entry.apps[app.id]!;
            const pct = progress.total > 0 ? (progress.patched / progress.total) * 100 : 0;
            return (
              <div key={app.id} className="rounded-md border border-white/[0.06] bg-[#12121e] px-3 py-2">
                <p className="text-sm">
                  <span style={{ color: app.accent }}>{app.name}</span>
                  <span className="ml-1.5 font-mono text-xs text-muted">
                    {progress.patched} / {progress.total} patched
                  </span>
                  {showPoints && progress.maxPoints > 0 && (
                    <span className="ml-1.5 font-mono text-xs text-zinc-400">
                      {progress.points}
                      <span className="text-muted"> / {progress.maxPoints} pts</span>
                    </span>
                  )}
                </p>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: app.accent }} />
                </div>
                <AppChallengeList challenges={progress.challenges!} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
