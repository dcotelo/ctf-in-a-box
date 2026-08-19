import type { ModuleId } from "@/lib/modules";
import type { LeaderboardEntry, ModuleProgress } from "@/lib/leaderboard/types";
import AppBreakdown from "@/components/app-breakdown";

/** Renders one module's detail block. Deliberately a switch over the known
 *  modules rather than a generic data-driven renderer: at three modules a
 *  generic one would be an invented abstraction, and the module contract only requires
 *  that each module define its OWN progress semantics. Narrows on
 *  `progress.detail.kind` rather than `moduleId` so the compiler proves each
 *  branch's shape instead of relying on an unchecked cast. */
export default function ModuleDetail({
  progress,
  entry,
  showPoints,
}: {
  moduleId: ModuleId;
  progress: ModuleProgress;
  entry: LeaderboardEntry;
  /** Forwarded verbatim to `AppBreakdown` — see its doc comment. Unset here
   *  too by every existing (leaderboard) call site. */
  showPoints?: boolean;
}) {
  const { detail } = progress;
  if (detail.kind === "secure-development") {
    return <AppBreakdown entry={{ ...entry, apps: detail.apps }} showPoints={showPoints} />;
  }
  // Every variant gets its OWN explicit narrow — no unguarded fallthrough. The
  // quiz branch used to be the fallthrough, which silently rendered any new
  // module's block with quiz's numbers and quiz's noun ("answered"). With each
  // `kind` named, adding a fourth module is a compile error here (`detail` is
  // `never` at the end) instead of a mislabelled row on a live board.
  if (detail.kind === "quiz") {
    return (
      <p className="font-mono text-sm tabular-nums text-white">
        {detail.answered} / {detail.total}
        <span className="ml-1 text-xs text-muted">answered</span>
      </p>
    );
  }
  return (
    <p className="font-mono text-sm tabular-nums text-white">
      {detail.solved} / {detail.total}
      <span className="ml-1 text-xs text-muted">flags</span>
    </p>
  );
}
