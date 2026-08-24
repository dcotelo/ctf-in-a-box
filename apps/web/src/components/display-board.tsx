"use client";

// Display mode — the projector surface (DESIGN.md: "legible from the back of
// a room"). Reached from the leaderboard's Display button (?display=1): no
// nav, no search, no chrome — the top ten as a wall of type, plus the phase
// answer projected where the whole room reads it.
//
// Refreshes itself with router.refresh() every 30 seconds: the board is a
// Server Component's data, so a refresh re-reads the standings without a full
// reload — the cadence poll-mode scores land at anyway. The interval is
// cleared on unmount and skipped entirely under reduced data? No — refresh is
// data, not motion; reduced-motion governs animation and this is neither.

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type DisplayRow = {
  key: string;
  rank: number;
  name: string;
  points: number;
  /** Items completed — the breadth figure the individual board ranks by.
   *  Absent on team rows: a team's breadth isn't computed here. */
  solved?: number;
};

const PODIUM: Record<number, string> = { 1: "#d29922", 2: "#a1a1aa", 3: "#b87333" };

export default function DisplayBoard({
  rows,
  eventName,
  phaseLabel,
}: {
  rows: DisplayRow[];
  eventName: string;
  phaseLabel: string | null;
}) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(id);
  }, [router]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0b0e14] px-[4vw] py-[3vh]">
      <div className="flex items-baseline justify-between gap-6">
        <h1 className="truncate font-display text-[3.5vh] font-black tracking-tight text-white">
          {eventName}
        </h1>
        <div className="flex items-baseline gap-6">
          {phaseLabel && (
            <span className="font-mono text-[2vh] uppercase tracking-widest text-[#9ba7b4]">
              {phaseLabel}
            </span>
          )}
          <Link href="/leaderboard" className="ds-link font-mono text-[1.6vh]">
            exit
          </Link>
        </div>
      </div>

      <ol className="mt-[3vh] flex flex-1 flex-col justify-evenly">
        {rows.map((row) => (
          <li key={row.key} className="flex items-baseline gap-[2vw]">
            <span
              className="w-[6vw] flex-none text-right font-display text-[4.2vh] font-black tabular-nums"
              style={{ color: PODIUM[row.rank] ?? "#9ba7b4" }}
            >
              {row.rank}
            </span>
            <span className="min-w-0 flex-1 truncate font-display text-[4.2vh] font-bold text-[#e6edf3]">
              {row.name}
            </span>
            {row.solved !== undefined && (
              <span className="flex-none font-mono text-[2vh] tabular-nums text-[#3fb950]">
                {row.solved} solved
              </span>
            )}
            <span className="w-[14vw] flex-none text-right font-mono text-[4.2vh] font-bold tabular-nums text-white">
              {row.points.toLocaleString("en-US")}
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-[2vh] text-right font-mono text-[1.4vh] text-[#9ba7b4]/60">
        refreshes every 30s
      </p>
    </div>
  );
}
