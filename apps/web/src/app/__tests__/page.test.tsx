// Landing page, on the SHIPPED event config (event-config.generated.ts, which
// enables secure-development only). This file deliberately does NOT mock
// `@/lib/event-config`: it pins the composed page against the configuration
// every event has shipped so far, so a refactor that quietly drops a module's
// copy fails here first.
//
// The other fixtures — quiz-only, two-module, and a module with no home block —
// each need their own event config, and `vi.mock` hoists per FILE, so they live
// in sibling files (page-quiz-only, page-two-modules, page-no-home), the same
// split lib/__tests__/modules-resolve.test.ts uses.
//
// @testing-library/react is not a dependency here and must not be added for
// this; renderToStaticMarkup (ships with react-dom) is enough, since these
// assertions are all on markup text.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// getResolvedModules is exercised for real (it is what pairs a module's home
// block with its organizer-resolved title), so its server-side deps are
// stubbed the same way lib/__tests__/resolved-modules.test.ts stubs them:
// `server-only` throws outside an RSC build, and the real `connection()`
// throws outside a Next request store.
vi.mock("server-only", () => ({}));
// The redesigned landing reads the session (for the state-aware primary CTA),
// the viewer's team, and — once the event is past registration — the top of
// the leaderboard. These fixtures render signed-out with the board read
// failing, which the page must tolerate by hiding the strip.
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/lib/team-store", () => ({ hasTeam: async () => false, getViewerTeam: async () => null }));
// Switchable: the default fixture renders with the board read FAILING (the
// page must hide the strip), and the standings-strip test below swaps in a
// synthetic board for one render.
const board = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/lib/leaderboard/source", () => ({
  getLeaderboardSource: () => ({
    getLeaderboard: async () => {
      if (board.data) return board.data;
      throw new Error("no leaderboard in this fixture");
    },
  }),
}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/admin-store", () => ({
  getAdminSettings: async () => ({ moduleOverrides: {} }),
}));
vi.mock("@/lib/challenges", () => ({ getChallengeCatalog: async () => null }));
// layout.tsx is imported for its `metadata` export; its font loaders are
// build-time Next magic with no runtime implementation under Vitest.
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "" });
  return { Poppins: font, Barlow: font, Geist_Mono: font };
});
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

import Home from "@/app/page";
import { metadata } from "@/app/layout";
import { eventConfig } from "@/lib/event-config";

const html = await Home().then(renderToStaticMarkup);

describe("landing page frame", () => {
  it("renders the event name as the headline", () => {
    expect(html).toContain(eventConfig.name);
  });

  // The redesigned frame: one primary action (state-aware — this fixture is
  // signed-out on a dateless event, so "Sign in and play"), the quiet
  // how-it-works link, and the evaluator card instead of the old five-CTA row
  // and tracking section (issue #200 / DESIGN.md).
  it("renders one primary action and the platform frame", () => {
    expect(html).toContain("Sign in and play");
    expect(html).toContain("How it works");
    expect(html).toContain("Run this for your own group");
    // The old equal-weight CTA row is gone.
    expect(html).not.toContain("Live leaderboard");
    expect(html).not.toContain("Track your progress live");
  });
});

describe("landing page with secure-development enabled", () => {
  it("renders the module's tagline under the event name", () => {
    expect(html).toContain("Secure Development CTF");
  });

  it("renders the module's hero intro with the live target count", () => {
    expect(html).toContain(
      "Break real vulnerabilities in 6 OWASP training apps, patch them for real, and ship the fix as a GitHub pull request.",
    );
  });

  it("renders the module's CTA into its own route", () => {
    expect(html).toContain('href="/challenges"');
    expect(html).toContain("Browse targets");
  });

  // The apostrophes are U+2019, exactly as the JSX's `&rsquo;` rendered them
  // before this copy moved into the registry — renderToStaticMarkup emits the
  // literal character, not an entity. Asserting on an ASCII "'" here would
  // quietly license a copy change.
  // The what-to-expect essay and the numbered steps left the landing page —
  // they are How to play's material, and the pitch page renders a game card
  // instead (DESIGN.md: "grading rules never live here").
  it("renders the game card, not the how-to steps", () => {
    expect(html).toContain("The game");
    expect(html).toContain("6 apps");
    expect(html).not.toContain("Pick a target");
    expect(html).not.toContain("Get scored automatically");
    expect(html).not.toContain("What to expect");
  });

  it("renders the module's bring-your-agent section", () => {
    expect(html).toContain("Bring your agent");
    expect(html).toContain("Please use AI");
    expect(html).toContain("the skill this event exists to build");
  });

  it("renders the Secure Agent Playbook card alongside it", () => {
    expect(html).toContain("Start with the OWASP Secure Agent Playbook");
    expect(html).toContain("https://github.com/OWASP/secure-agent-playbook");
  });

  it("renders the targets grid", () => {
    expect(html).toContain("6 real targets");
    expect(html).toContain("Juice Shop");
    expect(html).toContain("VAmPI");
  });

  // One module: the games section is headed "The game", singular.
  it("heads a single-module event's games section in the singular", () => {
    expect(html).toContain("The game<");
  });
});

describe("the hero standings strip", () => {
  // The default fixture's failing board read proves the strip HIDES (the
  // frame tests above render without it). This one proves what it says when
  // there is a board: the kicker names WHAT the rows are — three bare names
  // and numbers mean nothing to a first-time visitor — and points carry
  // their unit, like everywhere else in the app.
  it("labels the rows as teams and the numbers as points", async () => {
    board.data = {
      entries: [],
      teams: [
        { rank: 1, slug: "byte-me", name: "Byte Me", captain: "ada", points: 1458, members: ["ada"] },
        { rank: 2, slug: "zero-cool", name: "Zero Cool", captain: "kev", points: 750, members: ["kev"] },
      ],
      generatedAt: "2026-08-24T00:00:00.000Z",
      capabilities: { apps: false, teams: true, challenges: false },
    };
    try {
      const withBoard = await Home().then(renderToStaticMarkup);
      expect(withBoard).toContain("Top teams right now");
      expect(withBoard).toContain("Byte Me");
      expect(withBoard).toContain("1,458");
      expect(withBoard).toContain("pts");
      expect(withBoard).toContain("Full standings");
    } finally {
      board.data = null;
    }
  });

  it("hides itself when the board read fails", () => {
    expect(html).not.toContain("right now");
    expect(html).not.toContain("Full standings");
  });
});

describe("root metadata", () => {
  it("describes the event with the enabled modules' taglines", () => {
    expect(metadata.description).toBe("CTF-in-a-box — Secure Development CTF.");
  });

  it("no longer hardcodes secure-development copy onto every page", () => {
    expect(metadata.description).not.toContain("patch real vulnerabilities");
  });
});
