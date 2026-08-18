import type { ModuleId } from "@/lib/modules";
import type { LeaderboardEntry, ModuleProgress, QuizDetail, SecureDevelopmentDetail } from "@/lib/leaderboard/types";
import AppBreakdown from "@/components/app-breakdown";

/** Renders one module's detail block. Deliberately a switch over the known
 *  modules rather than a generic data-driven renderer: at two modules a generic
 *  one would be an invented abstraction, and the module contract only requires
 *  that each module define its OWN progress semantics. */
export default function ModuleDetail({
  moduleId,
  progress,
  entry,
}: {
  moduleId: ModuleId;
  progress: ModuleProgress;
  entry: LeaderboardEntry;
}) {
  if (moduleId === "secure-development") {
    const detail = progress.detail as SecureDevelopmentDetail;
    return <AppBreakdown entry={{ ...entry, apps: detail.apps }} />;
  }
  const detail = progress.detail as QuizDetail;
  return (
    <p className="font-mono text-sm tabular-nums text-white">
      {detail.answered} / {detail.total}
      <span className="ml-1 text-xs text-muted">answered</span>
    </p>
  );
}
