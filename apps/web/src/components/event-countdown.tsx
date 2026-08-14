"use client";

// Live countdown to CTF start. Client Component because it ticks every
// second. To avoid a hydration mismatch, both the server render and the
// client's first paint show the same "not mounted yet" placeholder — the
// real countdown only appears after a useEffect runs post-hydration.

import { useEffect, useState } from "react";
import { event } from "@/lib/site";

type Remaining = { days: number; hours: number; minutes: number; seconds: number };

function getRemaining(targetMs: number): Remaining | null {
  const diff = targetMs - Date.now();
  if (diff <= 0) return null;
  const totalSeconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

const UNITS: [keyof Remaining, string][] = [
  ["days", "days"],
  ["hours", "hrs"],
  ["minutes", "min"],
  ["seconds", "sec"],
];

export default function EventCountdown({
  variant = "hero",
  hideWhenComplete = false,
}: {
  /** "hero" — large centered blocks for the homepage. "compact" — smaller
   *  inline row for embedding in a page banner (e.g. the leaderboard). */
  variant?: "hero" | "compact";
  /** When the countdown completes, render nothing instead of the "live"
   *  banner — for contexts where a sibling element already explains what
   *  happens at zero (e.g. the leaderboard's mock-data notice). */
  hideWhenComplete?: boolean;
}) {
  const targetMs = new Date(event.ctfStartsAt).getTime();
  const [mounted, setMounted] = useState(false);
  const [remaining, setRemaining] = useState<Remaining | null>(null);

  useEffect(() => {
    const tick = () => {
      setMounted(true);
      setRemaining(getRemaining(targetMs));
    };
    // Defer the first tick to a callback (rather than calling setState
    // synchronously in the effect body) so it reads as a subscription to the
    // clock, not a render-time computation — satisfies react-hooks/set-state-in-effect.
    const timeout = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [targetMs]);

  if (mounted && !remaining) {
    if (hideWhenComplete) return null;
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 px-6 py-3.5 text-sm font-medium text-[#22c55e]">
        <span
          className="h-2 w-2 flex-none rounded-full bg-[#22c55e]"
          style={{ animation: "blink 1s step-end infinite" }}
          aria-hidden="true"
        />
        The CTF is live. Go fix everything.
      </div>
    );
  }

  const display = remaining ?? { days: 0, hours: 0, minutes: 0, seconds: 0 };

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-1.5 font-mono">
        {UNITS.map(([key, label], i) => (
          <span key={key} className="flex items-baseline gap-1">
            <span className="text-sm font-bold tabular-nums text-white">
              {String(display[key]).padStart(2, "0")}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
            {i < UNITS.length - 1 && <span className="text-zinc-600">&middot;</span>}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs font-medium uppercase tracking-[0.25em] text-muted">
        {mounted ? "CTF opens in" : "CTF opens"}
      </p>
      <div className="flex items-center gap-2.5 sm:gap-3">
        {UNITS.map(([key, label]) => (
          <div
            key={key}
            className="flex min-w-[3.75rem] flex-col items-center rounded-md border border-white/10 bg-[#12121e] px-2.5 py-2 sm:min-w-[4.5rem] sm:px-3.5"
          >
            <span className="font-mono text-xl font-bold tabular-nums text-white sm:text-2xl">
              {String(display[key]).padStart(2, "0")}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
