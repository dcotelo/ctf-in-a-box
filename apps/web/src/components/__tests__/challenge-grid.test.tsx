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
  challengeCount: 2,
  maxPoints: 4,
  stars: [1, 3],
  accent: "#e53e3e",
  icon: "M0 0",
};

const forkUrls = { dvwa: "https://github.com/OWASP-CTF/DVWA" };

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

  // The whole-board strip and the per-target header both carry POINT totals,
  // not just counts — and the strip's numbers come from the full catalogue,
  // so they must match regardless of any filter state at render time.
  it("summarizes whole-board and per-target progress with point denominators", () => {
    const html = renderToStaticMarkup(
      <ChallengeGrid apps={[dvwa]} catalog={{ dvwa: rows }} hints={{}} solved={{ dvwa: ["sqli-low"] }} />,
    );
    // The strip: 1 of 2 patched, 1 of 2 points banked.
    expect(html).toContain("/ 2 patched");
    expect(html).toContain("/ 2 pts");
    // The target header adds its own earned/available pair.
    expect(html).toContain("1/2 pts");
  });

  // The at-rest shape: a stack of target progress cards, not a row wall.
  // Rows render only for an expanded section — a single-target event
  // auto-opens (which is why every fixture above sees its rows), and any
  // active filter force-opens matching sections client-side.
  it("collapses every target to a progress card when the event has more than one", () => {
    const juice: AppMeta = { ...dvwa, id: "juice-shop", name: "Juice Shop" };
    const juiceRows: CatalogChallenge[] = [
      { app: "juice-shop", id: "xss-low", description: "DOM XSS", points: 1, owasp: { code: "A03", label: "Injection", url: null } },
    ];
    const html = renderToStaticMarkup(
      <ChallengeGrid
        apps={[dvwa, juice]}
        catalog={{ dvwa: rows, "juice-shop": juiceRows }}
        hints={{}}
        solved={{ dvwa: ["sqli-low"] }}
      />,
    );
    // Headers carry the summary (name, progress, per-target bar)…
    expect(html).toContain("DVWA");
    expect(html).toContain("Juice Shop");
    expect(html).toContain("1/2 patched");
    expect(html).toContain('aria-expanded="false"');
    // …and the rows themselves stay behind the toggle.
    expect(html).not.toContain("SQL Injection (Low)");
    expect(html).not.toContain("DOM XSS");
  });

  it("shows a signed-out viewer each card's size instead of progress", () => {
    const juice: AppMeta = { ...dvwa, id: "juice-shop", name: "Juice Shop" };
    const html = renderToStaticMarkup(
      <ChallengeGrid apps={[dvwa, juice]} catalog={{ dvwa: rows, "juice-shop": [] }} hints={{}} />,
    );
    expect(html).toContain("2 challenges · 2 pts");
    expect(html).not.toContain("patched");
  });

  it("falls back to summary cards without a live catalogue", () => {
    const html = renderToStaticMarkup(
      <ChallengeGrid apps={[dvwa]} catalog={null} hints={{}} forkUrls={forkUrls} />,
    );
    expect(html).toContain("DVWA");
    expect(html).toContain("1–3 pts per challenge");
    expect(html).not.toContain("All targets");
  });

  // Fork links come from the runtime GITHUB_ORG (config v2: PR 3A) — the page
  // hands down `forkUrls`, and the grid renders a link when it has one for a
  // target and plain repo-name text (never a broken `github.com//DVWA` link)
  // when it doesn't.
  it("renders a fork link when the org is configured", () => {
    const html = renderToStaticMarkup(
      <ChallengeGrid apps={[dvwa]} catalog={null} hints={{}} forkUrls={forkUrls} />,
    );
    expect(html).toContain('href="https://github.com/OWASP-CTF/DVWA"');
    expect(html).toContain("OWASP-CTF/DVWA");
  });

  it("falls back to plain repo-name text when no org is configured", () => {
    const html = renderToStaticMarkup(
      <ChallengeGrid apps={[dvwa]} catalog={null} hints={{}} forkUrls={{ dvwa: null }} />,
    );
    expect(html).not.toContain("<a ");
    expect(html).toContain("DVWA");
    // The unlinked repo name must not carry link-affordance classes either
    // (#386 review) — a `ds-link` underline on unclickable text reads as a
    // broken link, not as plain text.
    expect(html).not.toContain("ds-link");
  });
});
