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
import type { LeaderboardData, LeaderboardEntry, TeamStanding } from "@/lib/leaderboard/types";

type View = "individual" | "teams";
type SortKey = "rank" | "points" | "patched";

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
      className="flex h-9 w-9 flex-none items-center justify-center rounded-md font-mono text-sm font-bold tabular-nums"
      style={{
        color: podium ?? "#71717a",
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

function AppBreakdown({ entry }: { entry: LeaderboardEntry }) {
  const attempted = appList.filter((app) => entry.apps[app.id]);
  if (attempted.length === 0) {
    return <p className="text-sm text-muted">No app breakdown reported yet.</p>;
  }
  return (
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

function EntryRow({
  entry,
  topPoints,
  isOwn,
  isOpen,
  onToggle,
  capabilities,
}: {
  entry: LeaderboardEntry;
  topPoints: number;
  isOwn: boolean;
  isOpen: boolean;
  onToggle: () => void;
  capabilities: LeaderboardData["capabilities"];
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className={`ds-card group w-full rounded-lg border bg-[#16162a] p-4 text-left transition-all hover:border-[#2563eb]/40 hover:bg-[#1a1a30] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb] ${
          isOwn ? "border-[#2563eb]/60" : "border-white/[0.06]"
        }`}
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
                <span className="flex-none rounded border border-[#2563eb]/50 bg-[#2563eb]/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--accent-blue-link)]">
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
              <p className="font-mono text-base font-bold tabular-nums text-white">
                {entry.points.toLocaleString()}
              </p>
              <p className="text-[11px] uppercase tracking-wide text-muted">pts</p>
              {entry.hintPenalty ? (
                <p className="font-mono text-[10px] tabular-nums text-[#d4a017]/80" title="Points spent on hints (already deducted)">
                  −{entry.hintPenalty} hints
                </p>
              ) : null}
            </div>
            <div className="hidden sm:block">
              <p className="font-mono text-base tabular-nums text-[#22c55e]">{entry.patched}</p>
              <p className="text-[11px] uppercase tracking-wide text-muted">patched</p>
            </div>
            <div className="hidden sm:block">
              <p className="font-mono text-base tabular-nums text-zinc-300">
                {Math.max(0, entry.total - entry.patched)}
              </p>
              <p className="text-[11px] uppercase tracking-wide text-muted">non-patched</p>
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

        {isOpen && (
          <div className="mt-4 border-t border-white/[0.06] pt-4">
            <div className="mb-3 flex items-center justify-between text-xs text-muted">
              <span className="uppercase tracking-wider">
                {capabilities.apps ? "App breakdown" : "Summary"}
              </span>
              {entry.updatedAgo && <span>Last update {entry.updatedAgo}</span>}
            </div>
            {capabilities.apps ? <AppBreakdown entry={entry} /> : <LegacyBreakdown entry={entry} />}
          </div>
        )}
      </button>
    </li>
  );
}

function TeamRow({ team, topPoints, isOpen, onToggle }: { team: TeamStanding; topPoints: number; isOpen: boolean; onToggle: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="ds-card group w-full rounded-lg border border-white/[0.06] bg-[#16162a] p-4 text-left transition-all hover:border-[#2563eb]/40 hover:bg-[#1a1a30] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
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
              <p className="font-mono text-base font-bold tabular-nums text-white">
                {team.points.toLocaleString()}
              </p>
              <p className="text-[11px] uppercase tracking-wide text-muted">pts</p>
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
        {isOpen && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
            {team.members.map((login) => (
              <span
                key={login}
                className="flex items-center gap-1.5 rounded-full border border-white/10 bg-[#12121e] py-1 pl-1 pr-2.5 text-xs text-zinc-300"
              >
                <Avatar login={login} size={18} />
                {login}
              </span>
            ))}
          </div>
        )}
      </button>
    </li>
  );
}

/** Shown when the board holds no contestants at all (pre-event, or after a
 *  reset) — distinct from a search that simply matched nothing. The framing is
 *  deliberately an invitation rather than an error: the podium is drawn empty
 *  and the copy points at the challenges. */
function EmptyBoard() {
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
        <p className="mx-auto max-w-md text-sm text-zinc-400">
          No flags captured yet. Every rank is unclaimed. Patch your first challenge and
          you&rsquo;ll be the one everyone else is chasing.
        </p>
      </div>
      <Link
        href="/challenges"
        className="rounded-md border border-[#2563eb]/60 bg-[#2563eb]/10 px-4 py-2 font-mono text-sm text-[var(--accent-blue-link)] transition-colors hover:bg-[#2563eb]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
      >
        $ pick a challenge
      </Link>
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
        className="mt-1 rounded-md border border-white/10 px-3 py-1.5 font-mono text-xs text-zinc-300 transition-colors hover:border-[#2563eb]/60 hover:text-[#2563eb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
      >
        $ clear search
      </button>
    </div>
  );
}

export default function Leaderboard({
  data,
  viewerLogin,
}: {
  data: LeaderboardData;
  viewerLogin: string | null;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("individual");
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

  const visibleEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.entries
      .filter((e) => (q === "" ? true : e.login.toLowerCase().includes(q) || e.team?.toLowerCase().includes(q)))
      .sort((a, b) => {
        if (sort === "rank") return a.rank - b.rank;
        if (sort === "points") return b.points - a.points;
        return b.patched - a.patched;
      });
  }, [data.entries, query, sort]);

  const visibleTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.teams
      .filter((t) => (q === "" ? true : t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q)))
      .sort((a, b) => a.rank - b.rank);
  }, [data.teams, query]);

  const showTeamsToggle = data.capabilities.teams && data.teams.length > 0;
  /** Nothing to search, sort, or count — suppress the chrome so the empty
   *  state stands alone. Teams can exist before anyone has solved anything, so
   *  this checks both collections rather than just `entries`. */
  const boardIsEmpty = data.entries.length === 0 && data.teams.length === 0;

  return (
    <div className="flex flex-col gap-5">
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
            className="w-full rounded-md border border-white/10 bg-white/[0.03] py-2 pl-9 pr-3 text-sm text-white placeholder:text-muted focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
          />
        </div>

        {showTeamsToggle && (
          <div className="flex flex-wrap items-center gap-2">
            {(["individual", "teams"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb] ${
                  view === v
                    ? "border-[#2563eb] bg-[#2563eb]/10 text-[var(--accent-blue-link)]"
                    : "border-white/10 text-zinc-400 hover:text-white"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      {view === "individual" && data.entries.length > 0 && (
        <div className="flex items-center gap-4 px-1 text-xs uppercase tracking-wider text-muted">
          <span>Sort:</span>
          {(["rank", "points", "patched"] as SortKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              className={`transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb] ${
                sort === key ? "text-[#14b8a6]" : "hover:text-zinc-300"
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      )}

      {view === "individual" ? (
        data.entries.length === 0 ? (
          <EmptyBoard />
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
