"use client";

// Collapsible per-challenge list inside a profile app card. Client Component
// because it's pure local expand/collapse state — collapsed by default since
// some targets (vulnerableapp) have 100+ challenges.

import { useState } from "react";
import type { ChallengeResult } from "@/lib/leaderboard/types";

const STATUS_STYLE: Record<ChallengeResult["status"], { dot: string; label: string }> = {
  patched: { dot: "#22c55e", label: "Patched" },
  open: { dot: "#e53e3e", label: "Open" },
  missing: { dot: "#71717a", label: "Not attempted" },
};

export default function AppChallengeList({ challenges }: { challenges: ChallengeResult[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
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
              <li key={c.key} className="flex items-center gap-2 py-0.5 text-xs">
                <span
                  className="h-1.5 w-1.5 flex-none rounded-full"
                  style={{ background: style.dot }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-zinc-300">{c.name}</span>
                {c.owasp && (
                  <span className="flex-none rounded border border-white/10 px-1 text-[10px] text-muted">
                    {c.owasp}
                  </span>
                )}
                <span className="flex-none font-mono text-[10px] text-muted">{c.points}pt</span>
                <span className="w-20 flex-none text-right text-[10px] uppercase tracking-wide" style={{ color: style.dot }}>
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
