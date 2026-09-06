"use client";

// "updated 12s ago · refreshes every 15 s" — the line that makes a polled
// screen trustworthy (admin-redesign.md PR 2). Without it an organizer
// cannot tell a number that just refreshed from one that has been sitting
// there since they opened the tab, which is exactly the doubt Overview and
// the two live views exist to remove.
//
// Renders nothing until mounted AND a first load has landed, for the same
// reason every other ticking readout here does (see `ChangedAt` in
// admin-controls.tsx and components/event-countdown.tsx): this is a Client
// Component that still server-renders, and a clock read during render
// disagrees with the server's render. The age then ticks once a second —
// under a minute that is the whole signal.

import { useEffect, useState } from "react";
import { formatRelativeTime } from "@/lib/relative-time";

/** "12s ago" under a minute, then the shared "4m ago" / "2h ago" scale.
 *  Exported for direct testing — the component's output is behind an effect. */
export function describeAge(updatedAtMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - updatedAtMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return formatRelativeTime(new Date(updatedAtMs).toISOString(), nowMs);
}

/** The cadence half of the line. Said in words, not implied by a moving
 *  number, so a screen whose loop is off (phase not live) never looks like
 *  one that has silently stopped working. */
export function describeCadence(live: boolean, intervalMs: number): string {
  return live ? `refreshes every ${Math.round(intervalMs / 1000)} s` : "auto-refresh paused while the event is not live";
}

export default function AdminLiveStamp({
  updatedAt,
  live,
  intervalMs,
}: {
  /** `useLivePoll`'s `updatedAt`: epoch ms of the last completed load, or null. */
  updatedAt: number | null;
  live: boolean;
  intervalMs: number;
}) {
  const [age, setAge] = useState<string | null>(null);
  useEffect(() => {
    if (updatedAt === null) return;
    const tick = () => setAge(describeAge(updatedAt, Date.now()));
    // Deferred so this reads as subscribing to the clock, not a render-time
    // computation — the same shape as ChangedAt / ScheduleField.
    const timeout = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [updatedAt]);

  if (updatedAt === null || age === null) return null;
  return (
    <span className="text-sm text-muted">
      <time dateTime={new Date(updatedAt).toISOString()}>updated {age}</time> · {describeCadence(live, intervalMs)}
    </span>
  );
}
