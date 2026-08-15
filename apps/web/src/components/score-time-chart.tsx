// Leaderboard line chart — top-10 players' cumulative score over time,
// rendered above the leaderboard table (see the leaderboard page).
//
// Deliberately NOT a client component: it's a static SVG with no
// interactivity (no hover tooltip/crosshair — see the dataviz skill's
// interaction guidance, which this intentionally trades away for v1 so the
// leaderboard page doesn't need a client boundary just for this chart).
// Server-rendered once per request; never hydrated, so nothing here needs to
// produce byte-identical client/server markup.
//
// Colors: the dataviz skill's validated default categorical palette (dark
// steps), re-validated with the skill's validator against this app's actual
// --background (#1a1a2e) rather than the skill's generic dark surface — all
// eight slots clear the lightness/chroma/CVD/contrast gates in fixed order.
// A 9th+ line is never a generated hue (the skill's #1 anti-pattern): ranks
// 9-10 fold into a single shared muted "Other" entry instead.
import type { PlayerSeries } from "@/lib/leaderboard/types";

const SERIES_COLORS = [
  "#3987e5", // 1 blue
  "#d95926", // 2 orange
  "#199e70", // 3 aqua
  "#c98500", // 4 yellow
  "#d55181", // 5 magenta
  "#008300", // 6 green
  "#9085e9", // 7 violet
  "#e66767", // 8 red
] as const;

/** Shared color for any player past the fixed 8-hue categorical ceiling. */
const OTHER_COLOR = "#8f8f9b"; // --text-muted

const WIDTH = 720;
const HEIGHT = 300;
const MARGIN = { top: 12, right: 16, bottom: 28, left: 48 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;
const Y_TICK_COUNT = 4;
const X_TICK_COUNT = 5;

/** Rounds a maximum up to a "clean" axis ceiling (1/2/5 x a power of ten),
 *  per the skill's "round to clean numbers" y-axis guidance. */
function niceMax(value: number): number {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function formatTimeTick(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

type PlottedLine = {
  login: string;
  color: string;
  path: string | null; // null when there's only one point — a path would be degenerate
  points: { x: number; y: number }[];
};

export default function ScoreTimeChart({ series }: { series?: PlayerSeries[] }) {
  // No rubric (declarative-only deployment) or an older scorer that doesn't
  // send series at all — hide entirely rather than show a broken/empty chart.
  if (!series || series.length === 0) return null;

  const withPoints = series.filter((s) => s.points.length > 0);
  if (withPoints.length === 0) return null;

  const allTimes = withPoints.flatMap((s) => s.points.map((p) => Date.parse(p.t))).filter(Number.isFinite);
  if (allTimes.length === 0) return null;

  const minT = Math.min(...allTimes);
  const maxT = Math.max(...allTimes);

  // Every point across every player shares one instant — there's no time
  // range to draw an x-axis over. Note instead of a broken/zero-width chart.
  if (minT === maxT) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-[#16162a] px-4 py-6 text-center text-sm text-muted">
        Not enough score history yet to chart.
      </div>
    );
  }

  const allScores = withPoints.flatMap((s) => s.points.map((p) => p.score));
  const maxScore = niceMax(Math.max(0, ...allScores));

  const x = (ms: number) => MARGIN.left + ((ms - minT) / (maxT - minT)) * PLOT_W;
  const y = (score: number) => MARGIN.top + PLOT_H - (score / maxScore) * PLOT_H;

  // Highest final score first: that ordering also decides which players get
  // one of the 8 fixed categorical hues (color follows identity once
  // assigned — see the "recolor on filter" anti-pattern — but this fixture
  // is a fresh render each time, so ranking here is just the assignment
  // rule, not a live repaint).
  const ranked = [...withPoints].sort((a, b) => {
    const aFinal = a.points[a.points.length - 1]?.score ?? 0;
    const bFinal = b.points[b.points.length - 1]?.score ?? 0;
    return bFinal - aFinal;
  });

  const lines: PlottedLine[] = ranked.map((s, i) => {
    const color = i < SERIES_COLORS.length ? SERIES_COLORS[i] : OTHER_COLOR;
    const points = [...s.points]
      .filter((p) => Number.isFinite(Date.parse(p.t)))
      .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
      .map((p) => ({ x: x(Date.parse(p.t)), y: y(p.score) }));
    const path =
      points.length >= 2 ? points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ") : null;
    return { login: s.login, color, path, points };
  });

  const foldedCount = Math.max(0, lines.length - SERIES_COLORS.length);
  const yTicks = Array.from({ length: Y_TICK_COUNT + 1 }, (_, i) => (maxScore / Y_TICK_COUNT) * i);
  const xTicks = Array.from({ length: X_TICK_COUNT + 1 }, (_, i) => minT + ((maxT - minT) / X_TICK_COUNT) * i);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/[0.06] bg-[#16162a] p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white">Score over time</h2>
        <span className="text-xs text-muted">
          Top {lines.length} contestant{lines.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`Cumulative score over time for the top ${lines.length} contestant${lines.length === 1 ? "" : "s"}`}
          className="h-auto w-full min-w-[480px]"
        >
          <title>Score over time</title>

          {/* Gridlines: recessive hairlines, one step off the card surface. */}
          {yTicks.map((t) => (
            <line
              key={`grid-${t}`}
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={y(t)}
              y2={y(t)}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
          ))}

          {/* Axes */}
          <line
            x1={MARGIN.left}
            x2={MARGIN.left}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
            stroke="rgba(255,255,255,0.14)"
            strokeWidth={1}
          />
          <line
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={HEIGHT - MARGIN.bottom}
            y2={HEIGHT - MARGIN.bottom}
            stroke="rgba(255,255,255,0.14)"
            strokeWidth={1}
          />

          {/* Y-axis labels: rounded ceiling, so ticks land on clean numbers. */}
          {yTicks.map((t) => (
            <text
              key={`ytick-${t}`}
              x={MARGIN.left - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-current text-muted"
              fontSize={10}
            >
              {Math.round(t).toLocaleString("en-US")}
            </text>
          ))}

          {/* X-axis labels */}
          {xTicks.map((t) => (
            <text
              key={`xtick-${t}`}
              x={x(t)}
              y={HEIGHT - MARGIN.bottom + 16}
              textAnchor="middle"
              className="fill-current text-muted"
              fontSize={10}
            >
              {formatTimeTick(t)}
            </text>
          ))}

          {/* Lines + end markers. Straight segments between solve events
              (CTFd-style); a lone point renders only its marker — no
              zero/one-vertex path, which would be a degenerate no-op line
              anyway. */}
          {lines.map((line) => (
            <g key={line.login}>
              {line.path && (
                <path d={line.path} fill="none" stroke={line.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              )}
              {line.points.map((p, idx) => (
                <circle key={idx} cx={p.x} cy={p.y} r={4} fill={line.color} stroke="#16162a" strokeWidth={2} />
              ))}
            </g>
          ))}
        </svg>
      </div>

      {/* Legend: the dependable identity channel — a single series needs no
          legend box (the heading above already names it), but the leaderboard
          chart is almost always multi-player. */}
      {lines.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          {lines.slice(0, SERIES_COLORS.length).map((line) => (
            <li key={line.login} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: line.color }} />
              <span className="font-mono text-zinc-300">{line.login}</span>
            </li>
          ))}
          {foldedCount > 0 && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: OTHER_COLOR }} />
              <span className="text-muted">+{foldedCount} more</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
