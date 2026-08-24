// The phase line — the redesign's signature element (apps/web/DESIGN.md).
//
// A git-graph strip: the event's phases as commits on a branch, a HEAD marker
// on now. One glance answers the question the old app never did: what state
// is this event in? Pre-event, live, frozen and ended all looked identical
// (issue #200: "the app is state-blind"); this renders under the header on
// every screen, so the answer travels with the page.
//
// Phase resolution reuses the SAME primitives the enforcement reads
// (outsideWindow + the manual pause flag) — the strip must never say "live"
// while submissions refuse, or vice versa:
//
//   results       now past the scoring close
//   frozen        manual freeze, or a scheduled gap after the event started
//   registration  before the scoring open (the pre-event lobby)
//   live          otherwise — including a dateless always-on event
//
// FAILS SILENT, deliberately: if the settings read throws, render nothing.
// A Redis blip painting "FROZEN" across every page is a louder lie than a
// missing strip — same fail-open posture as the submission gates.

import { getAdminSettings } from "@/lib/admin-store";
import { outsideWindow } from "@/lib/schedule-window";

export type EventPhase = "registration" | "live" | "frozen" | "results";

export async function resolvePhase(): Promise<{
  phase: EventPhase;
  startsAt: string | null;
  endsAt: string | null;
} | null> {
  try {
    const s = await getAdminSettings();
    const now = Date.now();
    const start = s.scoringStartsAt ? Date.parse(s.scoringStartsAt) : NaN;
    const end = s.scoringEndsAt ? Date.parse(s.scoringEndsAt) : NaN;
    let phase: EventPhase;
    if (Number.isFinite(end) && now > end) phase = "results";
    else if (s.paused) phase = "frozen";
    else if (Number.isFinite(start) && now < start) phase = "registration";
    else if (outsideWindow(now, s.scoringStartsAt, s.scoringEndsAt)) phase = "frozen";
    else phase = "live";
    return { phase, startsAt: s.scoringStartsAt, endsAt: s.scoringEndsAt };
  } catch {
    return null;
  }
}

const STOPS: { id: EventPhase; label: string }[] = [
  { id: "registration", label: "registration" },
  { id: "live", label: "live" },
  { id: "frozen", label: "frozen" },
  { id: "results", label: "results" },
];

function fmt(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function PhaseLine() {
  const resolved = await resolvePhase();
  if (!resolved) return null;
  const { phase, startsAt, endsAt } = resolved;
  const activeIdx = STOPS.findIndex((s) => s.id === phase);
  // A live event that was never frozen skips the "frozen" stop entirely —
  // showing a phase that may never happen invites "when does it freeze?".
  const stops = phase === "frozen" ? STOPS : STOPS.filter((s) => s.id !== "frozen");
  const activeIn = stops.findIndex((s) => s.id === phase);
  void activeIdx;

  return (
    <div className="border-b border-white/[0.09] bg-[#12121e]">
      <ol
        aria-label={`Event phase: ${phase}`}
        className="mx-auto flex max-w-5xl items-center gap-0 overflow-x-auto px-6 py-1.5"
      >
        {stops.map((stop, i) => {
          const isActive = i === activeIn;
          const isPast = i < activeIn;
          const time = stop.id === "live" ? fmt(startsAt) : stop.id === "results" ? fmt(endsAt) : null;
          return (
            <li key={stop.id} className="flex items-center">
              {i > 0 && (
                <span
                  aria-hidden
                  className={`mx-2 h-px w-6 sm:w-10 ${isPast || isActive ? "bg-white/40" : "bg-white/15"}`}
                />
              )}
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span
                  aria-hidden
                  className={`h-2 w-2 flex-none rounded-full ${
                    isActive
                      ? phase === "live"
                        ? "bg-[#22c55e]"
                        : phase === "frozen"
                          ? "bg-[#d4a017]"
                          : "bg-[#2563eb]"
                      : isPast
                        ? "bg-white/50"
                        : "border border-[#8f8f9b]/50"
                  }`}
                  style={isActive ? { animation: "head-breathe 4s ease-in-out infinite" } : undefined}
                />
                <span
                  className={`font-mono text-[11px] uppercase tracking-wider ${
                    isActive ? "text-white" : "text-[#8f8f9b]/80"
                  }`}
                >
                  {stop.label}
                  {isActive && <span className="ml-1 text-[#8f8f9b]">◀ now</span>}
                </span>
                {time && !isActive && (
                  <span className="hidden font-mono text-[10px] text-[#8f8f9b]/60 sm:inline">{time}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
