// AppBreakdown renders the per-target progress inside a profile or an
// expanded leaderboard row. Until issue #200 (2.4) it rendered every target
// carrying a challenge catalogue TWICE back to back — a stats-grid card, then
// a second card repeating the name and patched count verbatim to host the
// collapsible challenge list — so these tests pin the merged single-card
// shape by counting name occurrences, not just checking presence.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AppBreakdown from "@/components/app-breakdown";
import type { LeaderboardEntry } from "@/lib/leaderboard/types";

function entry(overrides: Partial<LeaderboardEntry>): LeaderboardEntry {
  return {
    rank: 1,
    login: "ada",
    team: null,
    points: 100,
    patched: 3,
    failed: 0,
    total: 3,
    apps: {},
    updatedAt: null,
    ...overrides,
  };
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("AppBreakdown", () => {
  it("renders a target with a challenge list ONCE — stats and list in one card", () => {
    const html = renderToStaticMarkup(
      <AppBreakdown
        showPoints
        entry={entry({
          apps: {
            dvwa: {
              app: "dvwa",
              points: 30,
              maxPoints: 60,
              patched: 1,
              total: 2,
              challenges: [
                { key: "sqli-low", name: "SQL Injection (Low)", points: 10, status: "patched", owasp: "A05" },
                { key: "xss-low", name: "XSS (Low)", points: 20, status: "open", owasp: "A05" },
              ],
            },
          },
        })}
      />,
    );
    // The duplication this replaces rendered the name in the grid AND above
    // the list — exactly the regression a bare `toContain` cannot catch.
    expect(count(html, "DVWA")).toBe(1);
    expect(html).toContain("1 / 2 patched");
    // The stats moved INTO the list card rather than being dropped.
    expect(html).toContain("/ 60 pts");
    expect(html).toContain("Show 2 challenges");
  });

  it("keeps the compact grid for targets without a catalogue", () => {
    const html = renderToStaticMarkup(
      <AppBreakdown
        entry={entry({
          apps: { dvwa: { app: "dvwa", points: 0, maxPoints: 0, patched: 1, total: 2 } },
        })}
      />,
    );
    expect(count(html, "DVWA")).toBe(1);
    expect(html).not.toContain("Show ");
  });
});
