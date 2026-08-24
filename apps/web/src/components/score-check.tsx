// The check atom — the app's universal score shape (apps/web/DESIGN.md).
//
// Everywhere a score exists it renders in this one form: a status dot, a
// verdict, points. The vocabulary is a CI check line because that is the
// event's native medium — a pull request whose regression test goes green, an
// answer graded on submit. Four states:
//
//   solved   — green filled dot, the one color that always means "you scored"
//   pending  — amber, breathing: poll-mode latency made visible instead of
//              silent ("in review" is literally what the gap is)
//   failed   — red: a run that finished and did not score
//   open     — hollow: untouched, yours to attempt
//
// `justLanded` plays the single celebratory animation (check-land, 300ms) —
// callers set it when a score arrives while the surface is mounted. Under
// prefers-reduced-motion the keyframe collapses to an instant swap via the
// global reduced-motion rule; nothing here needs to branch.
//
// Purely presentational and server-safe: no state, no handlers.

export type CheckStatus = "solved" | "pending" | "failed" | "open";

const DOT: Record<CheckStatus, string> = {
  solved: "bg-[#3fb950]",
  pending: "bg-[#d29922]",
  failed: "bg-[#f85149]",
  open: "border border-[#9ba7b4]/60 bg-transparent",
};

const LABEL: Record<CheckStatus, string> = {
  solved: "solved",
  pending: "in review",
  failed: "failed",
  open: "open",
};

export default function ScoreCheck({
  status,
  points,
  label,
  justLanded = false,
  size = "sm",
}: {
  status: CheckStatus;
  /** Points to show after the verdict — omitted renders verdict alone. */
  points?: number | string;
  /** Verdict text override; defaults to the status's own word. */
  label?: string;
  justLanded?: boolean;
  size?: "sm" | "lg";
}) {
  const dot = size === "lg" ? "h-3 w-3" : "h-2 w-2";
  const text = size === "lg" ? "text-sm" : "text-xs";
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono ${text}`}>
      <span
        aria-hidden
        className={`${dot} flex-none rounded-full ${DOT[status]}`}
        style={{
          animation: justLanded
            ? "check-land 300ms ease-out"
            : status === "pending"
              ? "head-breathe 2.5s ease-in-out infinite"
              : undefined,
        }}
      />
      <span
        className={
          status === "solved"
            ? "text-[#3fb950]"
            : status === "failed"
              ? "text-[#f85149]"
              : status === "pending"
                ? "text-[#d29922]"
                : "text-[#9ba7b4]"
        }
      >
        {label ?? LABEL[status]}
        {points !== undefined && (
          <span className="tabular-nums"> · {typeof points === "number" ? `${points >= 0 ? "+" : ""}${points}` : points}</span>
        )}
      </span>
    </span>
  );
}
