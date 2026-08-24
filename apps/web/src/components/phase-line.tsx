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

/** The current phase's node/chip color: green while scoring runs, amber for
 *  a freeze, brand blue for the lobby, paper for the final state. */
const PHASE_COLOR: Record<EventPhase, string> = {
  registration: "#2563eb",
  live: "#22c55e",
  frozen: "#d4a017",
  results: "#d4d4d8", // --foreground: the event's final, settled state

};

/** UTC pinned explicitly: this is a Server Component, so whatever the box's
 *  clock renders is what every visitor sees — an unlabeled server-local time
 *  would just be UTC wearing no badge. Saying "UTC" makes it honest. */
function fmt(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export default async function PhaseLine() {
  const resolved = await resolvePhase();
  if (!resolved) return null;
  const { phase, startsAt, endsAt } = resolved;
  // A live event that was never frozen skips the "frozen" stop entirely —
  // showing a phase that may never happen invites "when does it freeze?".
  const stops = phase === "frozen" ? STOPS : STOPS.filter((s) => s.id !== "frozen");
  const activeIn = stops.findIndex((s) => s.id === phase);
  const color = PHASE_COLOR[phase];

  // One boundary time, attached to the CURRENT phase — the moment a visitor
  // would actually plan around. (A manual freeze has no known end, so it
  // makes no promise.)
  const boundary =
    phase === "registration" && fmt(startsAt)
      ? `scoring opens ${fmt(startsAt)} UTC`
      : phase === "live" && fmt(endsAt)
        ? `until ${fmt(endsAt)} UTC`
        : phase === "results" && fmt(endsAt)
          ? `ended ${fmt(endsAt)} UTC`
          : null;

  return (
    <div className="border-b border-white/[0.09] bg-[#12121e]">
      <div className="mx-auto flex max-w-5xl items-center justify-center gap-3 overflow-x-auto px-6 py-2">
        <ol aria-label={`Event phase: ${phase}`} className="flex items-center">
          {stops.map((stop, i) => {
            const isActive = i === activeIn;
            const isPast = i < activeIn;
            return (
              <li key={stop.id} className="flex items-center">
                {/* Connectors read as the branch itself: solid where the
                    event has already travelled, dashed where it hasn't. */}
                {i > 0 &&
                  (i <= activeIn ? (
                    <span aria-hidden className="mx-2.5 h-[2px] w-8 rounded-full bg-[#2563eb]/60 sm:w-14" />
                  ) : (
                    <span aria-hidden className="mx-2.5 w-8 border-t border-dashed border-white/20 sm:w-14" />
                  ))}
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <span
                    aria-hidden
                    className={
                      isActive
                        ? "h-2.5 w-2.5 flex-none rounded-full"
                        : isPast
                          ? "h-2 w-2 flex-none rounded-full bg-[#2563eb]"
                          : "h-2 w-2 flex-none rounded-full border border-[#8f8f9b]/50"
                    }
                    style={
                      isActive
                        ? { background: color, animation: "head-breathe 4s ease-in-out infinite" }
                        : undefined
                    }
                  />
                  <span
                    className={`font-mono text-[11px] uppercase tracking-wider ${
                      isActive ? "font-semibold text-white" : isPast ? "text-[#8f8f9b]" : "text-[#8f8f9b]/60"
                    }`}
                  >
                    {stop.label}
                  </span>
                  {/* The HEAD marker as a git-style ref chip on the current
                      commit — what "◀ now" was reaching for and not saying. */}
                  {isActive && (
                    <span
                      className="rounded-sm border px-1 py-px font-mono text-[9px] lowercase"
                      style={{
                        color,
                        borderColor: `${color}80`,
                        background: `${color}1a`,
                      }}
                    >
                      now
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        {boundary && (
          <span className="hidden whitespace-nowrap font-mono text-[10px] text-[#8f8f9b] sm:inline">
            {boundary}
          </span>
        )}
      </div>
    </div>
  );
}
