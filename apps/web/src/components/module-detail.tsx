import type { ModuleId } from "@/lib/modules";
import type { LeaderboardEntry, ModuleProgress } from "@/lib/leaderboard/types";
import AppBreakdown from "@/components/app-breakdown";

/** Renders one module's detail block. Deliberately a switch over the known
 *  modules rather than a generic data-driven renderer: at two modules a generic
 *  one would be an invented abstraction, and the module contract only requires
 *  that each module define its OWN progress semantics. Narrows on
 *  `progress.detail.kind` rather than `moduleId` so the compiler proves each
 *  branch's shape instead of relying on an unchecked cast. */
export default function ModuleDetail({
  progress,
  entry,
}: {
  moduleId: ModuleId;
  progress: ModuleProgress;
  entry: LeaderboardEntry;
}) {
  const { detail } = progress;
  if (detail.kind === "secure-development") {
    return <AppBreakdown entry={{ ...entry, apps: detail.apps }} />;
  }
  return (
    <p className="font-mono text-sm tabular-nums text-white">
      {detail.answered} / {detail.total}
      <span className="ml-1 text-xs text-muted">answered</span>
    </p>
  );
}
