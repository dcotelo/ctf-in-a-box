"use client";

// The admin panel's one polling loop (admin-redesign.md PR 2 "Live"), shared
// by Overview, Activity and Insights so the three screens refresh under one
// rule rather than three drifting copies of it:
//
//   - Nothing is fetched for a panel the organizer is not looking at. Every
//     panel is mounted (admin-controls.tsx hides the inactive ones), so
//     `visible` — is this the active destination — is what gates the first
//     load, not mount. An organizer opening the sidebar to reach Support
//     still pays no Redis read for Insights' O(contestants) fold.
//   - The loop runs only while the event phase is `live`. Before scoring
//     opens, and once it is frozen or over, the numbers do not move, so a
//     15-second poll would be load for nothing; the screen keeps its last
//     read and the stamp (admin-live-stamp.tsx) says the refresh is paused.
//   - A hidden browser tab never fetches. `document.visibilityState` is
//     checked on every tick, and the tab becoming visible again triggers an
//     immediate refresh so the organizer never reads a stale screen after
//     switching back.
//   - One request in flight at a time: a slow fold is not stacked behind
//     another when the interval fires again.
//
// `refresh` is also what the panels' Refresh buttons call, so a manual
// refresh and a timed one are the same code path and stamp the same clock.

import { useCallback, useEffect, useRef, useState } from "react";

/** Overview and Activity: the log and the funnel change by the second
 *  mid-event. */
export const LIVE_POLL_MS = 15_000;
/** Insights: an O(contestants) fold, so half as often — still inside the
 *  design's 15–30 s window. */
export const SLOW_POLL_MS = 30_000;

export function useLivePoll({
  visible,
  live,
  intervalMs,
  load,
}: {
  /** This panel is the active destination. Gates the first load and the loop. */
  visible: boolean;
  /** The event phase is `live` (components/phase.ts). Gates the loop only —
   *  a panel still loads once when first shown during registration or after
   *  the freeze, so it is never blank. */
  live: boolean;
  intervalMs: number;
  /** The panel's own fetch. Resolves to whether it REPLACED the panel's data
   *  — a loader that caught a failed read and kept what it had resolves
   *  false, so the stamp below never calls retained data "updated". May
   *  change identity every render (it usually closes over the panel's
   *  state); the latest one is what each tick calls. */
  load: () => Promise<boolean>;
}): {
  /** Epoch ms of the last SUCCESSFUL load — the stamp's input. `null` until
   *  the first one lands; unchanged by a failed refresh, so the age shown is
   *  the age of the data on screen. */
  updatedAt: number | null;
  /** Load now, stamping the clock when done. No-op while a load is in flight. */
  refresh: () => Promise<void>;
} {
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // The latest `load` without making it a dependency of the loop: re-arming
  // the interval on every render would reset the cadence each time the
  // panel's state changed, i.e. after every load.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    let replaced = false;
    try {
      replaced = await loadRef.current();
    } finally {
      inFlight.current = false;
      if (replaced) setUpdatedAt(Date.now());
    }
  }, []);

  // Whether this panel has ever loaded. Outside `live`, the loop is off and
  // only this first load happens; inside it, every tick loads.
  const loadedOnce = useRef(false);
  useEffect(() => {
    if (!visible) return;
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      if (!live && loadedOnce.current) return;
      loadedOnce.current = true;
      void refresh();
    };
    // setState happens inside `refresh` after the fetch, never in this
    // effect body — the clock and the network are the systems subscribed to.
    tick();
    document.addEventListener("visibilitychange", tick);
    const id = live ? setInterval(tick, intervalMs) : null;
    return () => {
      document.removeEventListener("visibilitychange", tick);
      if (id !== null) clearInterval(id);
    };
  }, [visible, live, intervalMs, refresh]);

  return { updatedAt, refresh };
}
