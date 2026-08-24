// The redesigned challenge browser (DESIGN.md: a queue, not a card gallery).
// The old grid shipped with zero component tests — its rewrite passed the
// whole suite untouched, which is exactly the presence-not-discoverability
// hole these pin shut: solved rows must LOOK solved, the filters must exist,
// and the no-catalogue fallback must keep rendering.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: null, isPending: false }) },
}));

import ChallengeGrid from "@/components/challenge-grid";
import type { AppMeta } from "@/lib/apps";
import type { CatalogChallenge } from "@/lib/challenges";

const dvwa: AppMeta = {
  id: "dvwa",
  name: "DVWA",
  blurb: "PHP classics at three security levels.",
  repo: "https://github.com/OWASP-CTF/DVWA",
  challengeCount: 2,
  maxPoints: 4,
  stars: [1, 3],
  accent: "#e53e3e",
  icon: "M0 0",
};

const rows: CatalogChallenge[] = [
  { app: "dvwa", id: "sqli-low", description: "SQL Injection (Low)", points: 1, owasp: { code: "A05", label: "Injection", url: null } },
  { app: "dvwa", id: "csrf-low", description: "CSRF (Low)", points: 1, owasp: { code: "A01", label: "Access Control", url: null } },
];

describe("ChallengeGrid (queue)", () => {
  it("renders sticky target headers with the viewer's patched count and check-dot rows", () => {
    const html = renderToStaticMarkup(
      <ChallengeGrid apps={[dvwa]} catalog={{ dvwa: rows }} hints={{}} solved={{ dvwa: ["sqli-low"] }} />,
    );
    expect(html).toContain("DVWA");
    expect(html).toContain("1/2 patched");
    // Both rows and their point values render.
    expect(html).toContain("SQL Injection (Low)");
    expect(html).toContain("CSRF (Low)");
    expect(html).toContain("1 pt");
    // The solved row is visibly distinct (dim text + filled green dot) and
    // announced to screen readers — not just present.
    expect(html).toContain("bg-[#22c55e]");
    expect(html).toContain("(patched)");
    // The solved-state toggle appears once solved data exists.
    expect(html).toContain("Solved state");
    // Filters and the running count.
    expect(html).toContain("All targets");
    expect(html).toContain("All categories");
    expect(html).toContain("2 shown");
  });

  it("hides the solved-state toggle when no solved data exists (signed out)", () => {
    const html = renderToStaticMarkup(
      <ChallengeGrid apps={[dvwa]} catalog={{ dvwa: rows }} hints={{}} />,
    );
    expect(html).not.toContain("Solved state");
    expect(html).not.toContain("patched");
  });

  it("falls back to summary cards without a live catalogue", () => {
    const html = renderToStaticMarkup(<ChallengeGrid apps={[dvwa]} catalog={null} hints={{}} />);
    expect(html).toContain("DVWA");
    expect(html).toContain("1–3 pts per challenge");
    expect(html).not.toContain("All targets");
  });
});
