import type { ModuleId } from "@/lib/modules";
import type { LeaderboardEntry, ModuleProgress } from "@/lib/leaderboard/types";
import AppBreakdown from "@/components/app-breakdown";

/** Renders one module's detail block. Deliberately a switch over the known
 *  modules rather than a generic data-driven renderer: at four modules a
 *  generic one would be an invented abstraction, and the module contract only requires
 *  that each module define its OWN progress semantics. Narrows on
 *  `progress.detail.kind` rather than `moduleId` so the compiler proves each
 *  branch's shape instead of relying on an unchecked cast, and closes with a
 *  `never` assignment so a new module cannot be added without a branch here
 *  (see the note above it). */
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
  // quiz branch used to BE the fallthrough, which silently rendered any new
  // module's block with quiz's numbers and quiz's noun ("answered").
  if (detail.kind === "quiz") {
    return (
      <p className="font-mono text-sm tabular-nums text-white">
        {detail.answered} / {detail.total}
        <span className="ml-1 text-xs text-muted">answered</span>
      </p>
    );
  }
  if (detail.kind === "classic") {
    return (
      <p className="font-mono text-sm tabular-nums text-white">
        {detail.solved} / {detail.total}
        <span className="ml-1 text-xs text-muted">flags</span>
      </p>
    );
  }
  if (detail.kind === "ai") {
    return (
      <p className="font-mono text-sm tabular-nums text-white">
        {detail.solved} / {detail.total}
        <span className="ml-1 text-xs text-muted">challenges</span>
      </p>
    );
  }
  // Exhaustiveness check. Naming every `kind` above is NOT on its own what
  // makes a fourth module a compile error here — a returned last branch still
  // type-checks against whatever shape the new variant happens to have, and
  // `{ solved, total, points }` is exactly the shape a second capture-style
  // module would reuse, so it would have rendered silently as "flags". This
  // assignment is the real guard: once every known `kind` is narrowed away,
  // `detail` is `never`, and any new `ModuleDetail` variant fails to assign
  // here regardless of its fields. Rendering nothing is the safe runtime
  // fallback for the impossible case; the compile error is the actual alarm.
  const unhandled: never = detail;
  void unhandled;
  return null;
}
