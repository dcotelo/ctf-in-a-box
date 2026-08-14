"use client";

// Fires one fire-and-forget ping per browser session so the organizers can see
// roughly which countries the event reached.
//
// What this deliberately does NOT do: it sends no body, sets no cookie, reads
// no storage beyond a single boolean flag, and carries no identifier of any
// kind. The server derives a country from its own edge headers and increments
// a bare tally — see src/lib/stats-store.ts and the /privacy page.
//
// sessionStorage (not localStorage) so the flag dies with the tab: it exists
// only to stop one browsing session counting on every navigation, not to
// recognise anyone across visits.

import { useEffect } from "react";

const SESSION_FLAG = "ctf-visit-counted";

export default function VisitBeacon() {
  useEffect(() => {
    // sessionStorage throws in some privacy modes; a visitor who blocks it
    // just isn't counted, which is the right way for this to fail.
    try {
      if (sessionStorage.getItem(SESSION_FLAG)) return;
      sessionStorage.setItem(SESSION_FLAG, "1");
    } catch {
      return;
    }

    // keepalive so the request survives an immediate navigation. Failures are
    // ignored on purpose — a counter must never surface an error to a visitor.
    void fetch("/api/stats/visit", { method: "POST", keepalive: true }).catch(() => {});
  }, []);

  return null;
}
