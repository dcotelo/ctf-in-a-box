// The one shape "how far along" takes everywhere it appears: done/total in
// the module's own noun, points earned of points available, and a progress
// bar. The challenge browser, the quiz board, the classic board's rail and
// the profile's module blocks all render THIS component — a viewer who has
// learned to read one of them has learned them all, and a surface can't
// drift into its own private progress dialect again.
//
// Presentational and client-safe: no data reads, no state — callers own the
// numbers (and their denominators' clamping rules).

export default function ProgressSummary({
  label,
  done,
  total,
  noun,
  earned,
  available,
}: {
  /** Module or board name, when the surface doesn't already say it. */
  label?: string;
  done: number;
  total: number;
  /** The module's own word for a completed item: patched / answered / solved. */
  noun: string;
  /** Points pair — omit both when the surface has no point data. */
  earned?: number;
  available?: number;
}) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {label && <span className="text-sm font-semibold text-white">{label}</span>}
      <p className="whitespace-nowrap font-mono text-sm tabular-nums">
        <span className="text-[#22c55e]">{done}</span>
        <span className="text-muted">
          {" "}
          / {total} {noun}
        </span>
      </p>
      {earned != null && available != null && (
        <p className="whitespace-nowrap font-mono text-sm tabular-nums">
          <span className="text-white">{earned.toLocaleString("en-US")}</span>
          <span className="text-muted"> / {available.toLocaleString("en-US")} pts</span>
        </p>
      )}
      <div aria-hidden className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#2563eb] to-[#14b8a6]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
