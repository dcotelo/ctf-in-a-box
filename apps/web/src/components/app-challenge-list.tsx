"use client";

// Collapsible per-challenge list, reused across the profile app cards, the
// leaderboard breakdown (a contestant's expanded row), and the team flags
// view. Client Component because it's pure local expand/collapse state —
// collapsed by default since some targets (vulnerableapp) have 100+
// challenges.

import { useState } from "react";
import type { ChallengeResult } from "@/lib/leaderboard/types";
import OwaspBadge from "@/components/owasp-badge";

const STATUS_STYLE: Record<ChallengeResult["status"], { dot: string; label: string }> = {
  patched: { dot: "#22c55e", label: "Patched" },
  open: { dot: "#e53e3e", label: "Open" },
  missing: { dot: "#8f8f9b", label: "Not attempted" },
};

export default function AppChallengeList({ challenges }: { challenges: ChallengeResult[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
      >
        <svg
          className={`transition-transform ${open ? "rotate-90" : ""}`}
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
        {open ? "Hide" : "Show"} {challenges.length} challenges
      </button>

      {open && (
        <ul className="mt-2 flex flex-col gap-1 border-l border-white/[0.06] pl-3">
          {challenges.map((c) => {
            const style = STATUS_STYLE[c.status];
            return (
              <li key={c.key} className="flex items-center gap-2 py-1 text-sm">
                <span
                  className="h-1.5 w-1.5 flex-none rounded-full"
                  style={{ background: style.dot }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-zinc-300">{c.name}</span>
                {c.owasp && <OwaspBadge code={c.owasp} />}
                <span className="flex-none font-mono text-xs text-muted">{c.points}pt</span>
                <span className="w-20 flex-none text-right text-xs uppercase tracking-wide" style={{ color: style.dot }}>
                  {style.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
