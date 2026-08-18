import { enabledApps as appList } from "@/lib/apps";
import AppChallengeList from "@/components/app-challenge-list";
import type { LeaderboardEntry } from "@/lib/leaderboard/types";

/** The contestant's per-target flag progress — extracted from `leaderboard.tsx`
 *  unchanged so it can be reused both as the pre-module fallback (a row with no
 *  `modules` map) and as secure-development's module detail block. */
export default function AppBreakdown({ entry }: { entry: LeaderboardEntry }) {
  const attempted = appList.filter((app) => entry.apps[app.id]);
  if (attempted.length === 0) {
    return <p className="text-sm text-muted">No app breakdown reported yet.</p>;
  }
  // Targets whose source carries the per-challenge catalogue — those get a
  // collapsible "which flags" list under the count grid.
  const withChallenges = attempted.filter((app) => (entry.apps[app.id]!.challenges?.length ?? 0) > 0);
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {attempted.map((app) => {
          const progress = entry.apps[app.id]!;
          const pct = progress.total > 0 ? (progress.patched / progress.total) * 100 : 0;
          return (
            <div key={app.id} className="rounded-md border border-white/[0.06] bg-[#12121e] px-3 py-2">
              <p className="text-xs" style={{ color: app.accent }}>
                {app.name}
              </p>
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
      {withChallenges.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          {withChallenges.map((app) => {
            const progress = entry.apps[app.id]!;
            return (
              <div key={app.id} className="rounded-md border border-white/[0.06] bg-[#12121e] px-3 py-2">
                <p className="text-sm">
                  <span style={{ color: app.accent }}>{app.name}</span>
                  <span className="ml-1.5 font-mono text-xs text-muted">
                    {progress.patched} / {progress.total} patched
                  </span>
                </p>
                <AppChallengeList challenges={progress.challenges!} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
