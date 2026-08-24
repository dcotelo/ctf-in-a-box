"use client";

// Interactive leaderboard.
//
// This is a Client Component because everything here needs the browser:
// useState for the query/view/sort/expand state. The server page loads the
// data (and the viewer's session) and hands both down as props — data
// fetching and auth stay on the server, interactivity on the client.

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { enabledApps as appList } from "@/lib/apps";
import { completedCount } from "@/lib/leaderboard/rank";
import type { ResolvedModule } from "@/lib/modules";
import ScoreTimeChart from "@/components/score-time-chart";
import AppChallengeList from "@/components/app-challenge-list";
import AppBreakdown from "@/components/app-breakdown";
import ModuleDetail from "@/components/module-detail";
import type { LeaderboardData, LeaderboardEntry, TeamStanding } from "@/lib/leaderboard/types";

type View = "individual" | "teams";
type SortKey = "rank" | "points" | "solved";

// Podium accents for the top three, drawn from the design tokens.
const PODIUM: Record<number, string> = {
  1: "#d4a017", // gold
  2: "#a1a1aa", // silver
  3: "#14b8a6", // teal-bronze
};

function Avatar({ login, size = 32 }: { login: string; size?: number }) {
  return (
    <Image
      src={`https://avatars.githubusercontent.com/${login}`}
      alt=""
      width={size}
      height={size}
      className="flex-none rounded-full border border-white/10"
      unoptimized
    />
  );
}

function RankChip({ rank }: { rank: number }) {
  const podium = PODIUM[rank];
  return (
    <span
      className="flex h-10 w-10 flex-none items-center justify-center rounded-md font-display text-lg font-black tabular-nums"
      style={{
        color: podium ?? "#8f8f9b",
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: podium ? `${podium}66` : "rgba(255,255,255,0.08)",
        background: podium ? `${podium}14` : "transparent",
      }}
    >
      {rank}
    </span>
  );
}

/** The team's per-target flag progress — every challenge, marked patched
 *  (solved by the union of members) or open (still pending). Reuses the same
 *  collapsible AppChallengeList as a contestant's breakdown so both views read
 *  identically. Rendered only when the source carries per-challenge data. */
function TeamFlags({ team }: { team: TeamStanding }) {
  if (!team.apps) return null;
  const groups = appList
    .map((app) => ({ app, challenges: team.apps![app.id]?.challenges ?? [] }))
    .filter((g) => g.challenges.length > 0);
  if (groups.length === 0) return null;
  return (
    <div className="mt-4 border-t border-white/[0.06] pt-4">
      <p className="mb-3 text-xs uppercase tracking-wider text-muted">Target breakdown</p>
      <div className="flex flex-col gap-3">
        {groups.map(({ app, challenges }) => {
          const patched = challenges.filter((c) => c.status === "patched").length;
          return (
            <div key={app.id} className="rounded-md border border-white/[0.06] bg-[#12121e] px-3 py-2">
              <p className="text-sm">
                <span style={{ color: app.accent }}>{app.name}</span>
                <span className="ml-1.5 font-mono text-xs text-muted">
                  {patched} / {challenges.length} patched
                </span>
              </p>
              <AppChallengeList challenges={challenges} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LegacyBreakdown({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-400">
      <span>
        {entry.patched} patched / {entry.total} attempted
      </span>
      {entry.lastPr != null && <span>PR #{entry.lastPr}</span>}
      {entry.lastSha && <span className="font-mono text-xs text-muted">{entry.lastSha.slice(0, 7)}</span>}
    </div>
  );
}

/** Exported (alongside the default `Leaderboard`) so tests can render an
 *  expanded row directly with `isOpen` — the toggle only flips client state a
 *  static render can't drive. */
/** Does this event run secure-development?
 *
 *  "patched" / "non-patched" is that module's own vocabulary — a regression
 *  test passing against a submitted patch — so the columns and the sort key
 *  built on it are gated on it, exactly as /profile gates the identical trio
 *  on `secureDevEnabled`. The two surfaces render the same three numbers and
 *  must not disagree about whether the event has them.
 *
 *  Read off the `modules` prop rather than by importing `isModuleEnabled`, for
 *  the reason spelled out on `multiModule` below: this is a Client Component
 *  and keeps no registry import. Which modules are enabled is build-time truth
 *  either way. */
function hasSecureDev(modules: readonly ResolvedModule[]): boolean {
  return modules.some((m) => m.id === "secure-development");
}

export function EntryRow({
  entry,
  topPoints,
  isOwn,
  isOpen,
  onToggle,
  capabilities,
  modules,
  completable,
}: {
  entry: LeaderboardEntry;
  topPoints: number;
  isOwn: boolean;
  isOpen: boolean;
  onToggle: () => void;
  capabilities: LeaderboardData["capabilities"];
  modules: readonly ResolvedModule[];
  /** The EVENT's total completable items, for the solved column's
   *  denominator. Undefined when nothing stamped it — the column then shows a
   *  bare count rather than inventing a total. */
  completable?: number;
}) {
  // A single-module event has nothing to disambiguate: the row's own points
  // ARE that module's, so a per-module heading would just restate the header
  // above it. Show it only once a second module can contribute.
  //
  // The count comes off the `modules` prop rather than importing
  // `enabledModules` here, so this stays a Client Component with no registry
  // import — but WHICH modules are on is still build-time truth
  // (`resolveModules` maps `enabledModules`, i.e. `eventConfig.modules`).
  // Only a module's NAME is runtime; enabling or disabling one is a rebuild.
  const multiModule = modules.length > 1;
  const secureDev = hasSecureDev(modules);
  // The same function the comparator ranks on — see `completedCount`.
  const solved = completedCount(entry);
  // Clamped to the row's own numerator: a failed module-count read leaves
  // `completable` short (see withModuleContributions), and "28 / 21" is worse
  // than no denominator at all. Hidden entirely when there is nothing
  // trustworthy to divide by.
  const solvedTotal = completable && completable > 0 ? Math.max(completable, solved) : null;
  return (
    <li
      className={`ds-card group rounded-lg border bg-[#16162a] transition-all hover:border-[#2563eb]/40 hover:bg-[#1a1a30] ${
        isOwn ? "border-[#2563eb]/60" : "border-white/[0.06]"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full rounded-lg p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
      >
        <div className="flex items-center gap-4">
          <RankChip rank={entry.rank} />
          <Avatar login={entry.login} />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-mono font-medium text-white">{entry.login}</span>
              {entry.team && (
                <span className="flex-none rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                  {entry.team}
                </span>
              )}
              {isOwn && (
                <span className="flex-none rounded border border-[#2563eb]/45 bg-white/[0.06] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--accent-blue-link)]">
                  you
                </span>
              )}
            </div>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#2563eb] to-[#14b8a6]"
                style={{ width: `${topPoints > 0 ? (entry.points / topPoints) * 100 : 0}%` }}
              />
            </div>
          </div>

          <div className="flex flex-none items-center gap-5 text-right">
            <div>
              <p className="font-mono text-xl font-bold tabular-nums text-white">
                {entry.points.toLocaleString()}
              </p>
              <p className="text-[11px] uppercase tracking-wide text-muted">pts</p>
              {entry.hintPenalty ? (
                <p className="font-mono text-[10px] tabular-nums text-[#d4a017]/80" title="Points spent on hints (already deducted)">
                  −{entry.hintPenalty} hints
                </p>
              ) : null}
            </div>
            {/* ONE column, and deliberately the one the board RANKS by.
                It replaced a `patched` + `non-patched` pair that was both
                cluttered and unexplanatory: the two always summed to the
                catalogue, so `non-patched` carried no information `patched`
                didn't already, and NEITHER was the figure the ordering came
                from — leaving rows like "1,061 pts at rank 3, above 550 pts
                at rank 1" with nothing on screen to explain them.
                `completedCount` is imported from the comparator itself so the
                number shown and the number sorted on cannot drift apart.
                Ungated by module, unlike the pair before it: breadth is what
                every event ranks on, including one with no patching in it. */}
            <div className="hidden sm:block">
              <p className="font-mono text-base tabular-nums text-[#22c55e]">
                {solved}
                {solvedTotal !== null && (
                  <span className="text-zinc-500"> / {solvedTotal}</span>
                )}
              </p>
              <p className="text-[11px] uppercase tracking-wide text-muted">solved</p>
            </div>
            <svg
              className={`text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
              width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-white/[0.06] px-4 pb-4 pt-4">
          <div className="mb-3 flex items-center justify-between text-xs text-muted">
            <span className="uppercase tracking-wider">
              {capabilities.apps ? "App breakdown" : "Summary"}
            </span>
            {entry.updatedAgo && <span>Last update {entry.updatedAgo}</span>}
          </div>
          {entry.modules && Object.keys(entry.modules).length > 0 ? (
            modules
              .filter((m) => entry.modules?.[m.id])
              .map((m) => (
                <div key={m.id} className="mb-4 last:mb-0">
                  {multiModule && (
                    <p className="mb-2 text-xs uppercase tracking-wider text-muted">
                      {m.title}
                      <span className="ml-2 font-mono text-zinc-300">{entry.modules![m.id]!.points} pts</span>
                    </p>
                  )}
                  <ModuleDetail moduleId={m.id} progress={entry.modules![m.id]!} entry={entry} />
                </div>
              ))
          ) : capabilities.apps ? (
            <AppBreakdown entry={entry} />
          ) : (
            <LegacyBreakdown entry={entry} />
          )}
        </div>
      )}
    </li>
  );
}

/** Exported (in addition to the page's default `Leaderboard`) purely so
 *  tests can render an expanded row directly with `isOpen` — the toggle
 *  itself only flips client-side state that a static render can't drive. */
export function TeamRow({ team, topPoints, pointsByLogin, isOpen, onToggle, modules = [] }: { team: TeamStanding; topPoints: number; pointsByLogin?: Map<string, number>; isOpen: boolean; onToggle: () => void; modules?: readonly ResolvedModule[] }) {
  // Per-module vocabulary for the completed count — the same distinction the
  // module guides draw ("answered" a question, "solved" a flag/challenge).
  const completedNoun = (id: string) => (id === "quiz" ? "answered" : "solved");
  return (
    <li className="ds-card group rounded-lg border border-white/[0.06] bg-[#16162a] transition-all hover:border-[#2563eb]/40 hover:bg-[#1a1a30]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full rounded-lg p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
      >
        <div className="flex items-center gap-4">
          <RankChip rank={team.rank} />
          <div className="min-w-0 flex-1">
            <span className="truncate font-medium text-white">{team.name}</span>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#2563eb] to-[#14b8a6]"
                style={{ width: `${topPoints > 0 ? (team.points / topPoints) * 100 : 0}%` }}
              />
            </div>
          </div>
          <div className="flex flex-none items-center gap-5 text-right">
            <div>
              <p className="font-mono text-xl font-bold tabular-nums text-white">
                {team.points.toLocaleString()}
              </p>
              <p className="text-[11px] uppercase tracking-wide text-muted">pts</p>
              {team.hintPenalty ? (
                <p
                  className="font-mono text-[10px] tabular-nums text-[#d4a017]/80"
                  title="Points its members spent on hints (already deducted)"
                >
                  −{team.hintPenalty} hints
                </p>
              ) : null}
            </div>
            <div className="hidden sm:block">
              <p className="font-mono text-base tabular-nums text-zinc-300">{team.members.length}</p>
              <p className="text-[11px] uppercase tracking-wide text-muted">members</p>
            </div>
            <svg
              className={`text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
              width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </div>
      </button>
      {isOpen && (
        <div className="px-4 pb-4">
          <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
            {team.members.map((login) => (
              <span
                key={login}
                className="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#12121e] py-1 pl-1 pr-2 text-xs text-zinc-300"
              >
                <Avatar login={login} size={18} />
                {login}
                {login === team.captain && (
                  <span className="flex-none rounded border border-[#d4a017]/50 bg-[#d4a017]/10 px-1 py-0.5 text-[9px] uppercase tracking-wide text-[#d4a017]">
                    captain
                  </span>
                )}
                <span className="flex-none rounded-full bg-white/[0.06] px-1.5 py-0.5 font-mono tabular-nums text-[11px] text-zinc-200">
                  {(pointsByLogin?.get(login) ?? 0).toLocaleString()} pts
                </span>
              </span>
            ))}
          </div>
          {/* Where the total CAME from. Without this, a team on a
              multi-module event expands its row and finds only the
              secure-development targets below — most of its points
              unexplained by the very panel that exists to explain them
              (issue #200, 2.2). Same source as EntryRow's blocks:
              `team.modules` is the union-deduped per-module fold. */}
          {team.modules && Object.keys(team.modules).length > 0 && modules.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
              {modules
                .filter((m) => team.modules?.[m.id])
                .map((m) => {
                  const progress = team.modules![m.id]!;
                  return (
                    <div key={m.id} className="rounded-md border border-white/[0.06] bg-[#12121e] px-3 py-2 text-sm">
                      <span className="text-xs uppercase tracking-wider text-muted">{m.title}</span>
                      <span className="ml-2 font-mono tabular-nums text-white">
                        {progress.points.toLocaleString()} pts
                      </span>
                      <span className="ml-2 font-mono text-xs tabular-nums text-muted">
                        {progress.completed} {completedNoun(m.id)}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
          <TeamFlags team={team} />
        </div>
      )}
    </li>
  );
}

/** Shown when the board holds no contestants at all (pre-event, or after a
 *  reset) — distinct from a search that simply matched nothing. The framing is
 *  deliberately an invitation rather than an error: the podium is drawn empty
 *  and the copy points at the way onto the board.
 *
 *  WHICH way is the module's to say, not this component's: "patch your first
 *  challenge", pointing at /challenges, is nonsense on a quiz-only event that
 *  has no challenges page at all. The sentence and its destination come from
 *  the first enabled module carrying `emptyBoard` (registry order decides on a
 *  multi-module event, so a secure-development event keeps today's wording and
 *  link verbatim). A module with none contributes nothing and the invitation
 *  degrades to the heading alone rather than to a dead link. */
export function EmptyBoard({ modules }: { modules: readonly ResolvedModule[] }) {
  const copy = modules.find((m) => m.emptyBoard)?.emptyBoard;
  return (
    <div className="flex flex-col items-center gap-5 rounded-lg border border-white/[0.06] bg-[#16162a] px-6 py-10 text-center">
      <Image
        src="/leaderboard-empty.svg"
        alt="An empty winners' podium with an unclaimed flag on the top step"
        width={420}
        height={260}
        className="h-auto w-full max-w-[420px]"
        priority={false}
        unoptimized
      />
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold uppercase tracking-widest text-white">
          The board is wide open
        </h2>
        {copy && <p className="mx-auto max-w-md text-sm text-zinc-400">{copy.line}</p>}
      </div>
      {copy && (
        <Link
          href={copy.cta.href}
          className="rounded-md border border-[#2563eb]/60 bg-white/[0.06] px-4 py-2 font-mono text-sm text-[var(--accent-blue-link)] transition-colors hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
        >
          {copy.cta.label}
        </Link>
      )}
    </div>
  );
}

/** Shown when the board has contestants but the query matched none of them.
 *  Always offers the way out (clearing the search) rather than dead-ending. */
function NoMatch({ noun, query, onClear }: { noun: string; query: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-white/[0.06] bg-[#16162a] px-5 py-10 text-center">
      <p className="text-base text-zinc-300">
        No {noun} matching <span className="font-mono text-white">&ldquo;{query}&rdquo;</span> on the
        board yet.
      </p>
      <p className="text-sm text-muted">Double-check the spelling, or take another look at everyone.</p>
      <button
        type="button"
        onClick={onClear}
        className="mt-1 rounded-md border border-white/10 px-3 py-1.5 font-mono text-xs text-zinc-300 transition-colors hover:border-[#2563eb]/60 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
      >
        $ clear search
      </button>
    </div>
  );
}

export default function Leaderboard({
  data,
  viewerLogin,
  modules,
}: {
  data: LeaderboardData;
  viewerLogin: string | null;
  modules: readonly ResolvedModule[];
}) {
  // Teams are the primary competitive unit once they exist — default there
  // and let individual standings be the secondary, opt-in view.
  const showTeamsToggle = data.capabilities.teams && data.teams.length > 0;
  // All three keys are offered on every event now. The third used to be
  // "patched" and was gated on hasSecureDev, because it sorted a column a
  // quiz-only event does not have; it sorts on cross-module completion
  // instead, which every event has, so the gate went with the column.
  const sortKeys: SortKey[] = ["rank", "points", "solved"];

  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>(showTeamsToggle ? "teams" : "individual");
  const [sort, setSort] = useState<SortKey>("rank");
  const [expanded, setExpanded] = useState<string | null>(null);

  const topPoints = useMemo(
    () => data.entries.reduce((max, e) => Math.max(max, e.points), 0),
    [data.entries],
  );
  const topTeamPoints = useMemo(
    () => data.teams.reduce((max, t) => Math.max(max, t.points), 0),
    [data.teams],
  );
  // Each member's individual score, for the expanded team row. A member's own
  // total can exceed their marginal contribution (the team dedupes flags two
  // members both solved), so this is "their points", not "what they added".
  const pointsByLogin = useMemo(
    () => new Map(data.entries.map((e) => [e.login, e.points])),
    [data.entries],
  );

  const visibleEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.entries
      .filter((e) => (q === "" ? true : e.login.toLowerCase().includes(q) || e.team?.toLowerCase().includes(q)))
      .sort((a, b) => {
        if (sort === "rank") return a.rank - b.rank;
        if (sort === "points") return b.points - a.points;
        // Same figure the column shows and the comparator ranks on.
        return completedCount(b) - completedCount(a);
      });
  }, [data.entries, query, sort]);

  const visibleTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.teams
      .filter((t) => (q === "" ? true : t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q)))
      .sort((a, b) => a.rank - b.rank);
  }, [data.teams, query]);

  /** Nothing to search, sort, or count — suppress the chrome so the empty
   *  state stands alone. Teams can exist before anyone has solved anything, so
   *  this checks both collections rather than just `entries`. */
  const boardIsEmpty = data.entries.length === 0 && data.teams.length === 0;

  // The series is the SOURCE's history — secure-development scoring events
  // from the scorer. Quiz and classic points are stamped on afterwards by
  // withModuleContributions as aggregate totals with no timeline, so on a
  // multi-module event the chart's ceiling and the rows' totals legitimately
  // disagree (issue #200, 2.3). Until the app-side modules contribute series
  // events of their own, the chart has to SAY what it plots — an unlabeled
  // chart whose max is a tenth of the visible totals reads as broken.
  const sdModule = modules.find((m) => m.id === "secure-development");
  const appSideTitles = modules.filter((m) => m.id !== "secure-development").map((m) => m.title);
  const chartNote =
    sdModule && appSideTitles.length > 0
      ? `Plots ${sdModule.title} scoring only — ${appSideTitles.join(" and ")} points count toward the totals below but are not charted.`
      : undefined;

  return (
    <div className="flex flex-col gap-5">
      {/* Chart follows the active view: team lines in "teams", player lines
          in "individual" — only one of the two props is ever passed, so
          ScoreTimeChart never has to choose between them. */}
      <ScoreTimeChart
        series={view === "individual" ? data.series : undefined}
        teamSeries={view === "teams" ? data.teamSeries : undefined}
        note={chartNote}
      />

      {/* Controls */}
      {!boardIsEmpty && (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <input
            type="search"
            id="leaderboard-search"
            name="leaderboard-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={view === "individual" ? "Search contestants…" : "Search teams…"}
            aria-label="Search leaderboard"
            className="w-full rounded-md border border-white/10 bg-white/[0.03] py-2 pl-9 pr-3 text-sm text-white placeholder:text-muted focus-visible:border-[#d4a017]/70 focus-visible:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* The projector surface: chrome-free top ten at wall size. A link,
              not state — organizers open it in its own tab/window. */}
          <Link
            href="/leaderboard?display=1"
            className="rounded-full border border-white/10 px-3 py-1 text-xs font-medium text-zinc-400 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
          >
            Display mode
          </Link>
        {showTeamsToggle && (
          <div className="flex flex-wrap items-center gap-2">
            {(["individual", "teams"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017] ${
                  view === v
                    ? "border-[#2563eb]/70 bg-white/[0.06] text-[var(--accent-blue-link)]"
                    : "border-white/10 text-zinc-400 hover:text-white"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        )}
        </div>
      </div>
      )}

      {view === "individual" && data.entries.length > 0 && (
        <div className="flex items-center gap-4 px-1 text-xs uppercase tracking-wider text-muted">
          <span>Sort:</span>
          {sortKeys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              className={`transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017] ${
                sort === key ? "text-[#14b8a6]" : "hover:text-zinc-300"
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      )}

      {/* The default order is breadth-first (compareStanding: items solved
          across every module, then points, then earliest activity) — which
          means the top row is NOT necessarily the highest points, and a
          contestant reading "#3" next to the biggest PTS figure on the board
          concludes the ranking is broken unless the rule is stated where the
          ranking is (issue #200, 2.1). Shown only while that order is active:
          the points/solved sorts are self-describing. */}
      {view === "individual" && data.entries.length > 0 && sort === "rank" && (
        <p className="px-1 text-xs leading-relaxed text-muted">
          Rank rewards breadth: challenges solved across every module first, then points as the
          tiebreak, then whoever got there first.
        </p>
      )}

      {view === "individual" ? (
        data.entries.length === 0 ? (
          <EmptyBoard modules={modules} />
        ) : visibleEntries.length === 0 ? (
          <NoMatch noun="contestants" query={query.trim()} onClear={() => setQuery("")} />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {visibleEntries.map((entry) => (
              <EntryRow
                key={entry.login}
                entry={entry}
                topPoints={topPoints}
                isOwn={viewerLogin === entry.login}
                isOpen={expanded === entry.login}
                onToggle={() => setExpanded(expanded === entry.login ? null : entry.login)}
                capabilities={data.capabilities}
                modules={modules}
                completable={data.completable}
              />
            ))}
          </ul>
        )
      ) : visibleTeams.length === 0 ? (
        <NoMatch noun="teams" query={query.trim()} onClear={() => setQuery("")} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {visibleTeams.map((team) => (
            <TeamRow
              key={team.slug}
              team={team}
              topPoints={topTeamPoints}
              pointsByLogin={pointsByLogin}
              modules={modules}
              isOpen={expanded === team.slug}
              onToggle={() => setExpanded(expanded === team.slug ? null : team.slug)}
            />
          ))}
        </ul>
      )}

      {!boardIsEmpty && (
        <p className="px-1 text-xs text-muted">
          {view === "individual"
            ? `Showing ${visibleEntries.length} of ${data.entries.length} contestants`
            : `Showing ${visibleTeams.length} of ${data.teams.length} teams`}
          {" · click a row for the breakdown"}
        </p>
      )}
    </div>
  );
}
