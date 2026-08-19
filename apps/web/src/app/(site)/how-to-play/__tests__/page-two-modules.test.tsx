// /how-to-play on an event running BOTH modules: the page has to compose them
// rather than pick one. Own file for the usual reason — `vi.mock` hoists per
// file and this needs its own event config.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/admin-store", () => ({
  getAdminSettings: async () => ({ moduleOverrides: { quiz: { title: "Round 1" } } }),
}));

vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    name: "Two Module CTF",
    theme: "",
    dates: "",
    location: "",
    ctfStartsAt: null,
    url: "http://localhost:3000",
    contactEmail: "",
    githubOrg: "OWASP-CTF",
    discordUrl: "",
    modules: [
      { id: "secure-development", targets: ["dvwa"], scoreIngest: "poll" },
      { id: "quiz" },
    ],
    targets: ["dvwa"],
    admins: [],
  },
}));

import HowToPlay, { metadata } from "@/app/(site)/how-to-play/page";

const html = await HowToPlay().then(renderToStaticMarkup);

describe("/how-to-play in a two-module event", () => {
  it("renders both modules' steps", () => {
    expect(html).toContain("Patch it and open a pull request");
    expect(html).toContain("Open the question set");
  });

  it("heads each module's block with its organizer-resolved title", () => {
    expect(html).toContain(">Secure Development</h2>");
    expect(html).toContain(">Round 1</h2>");
  });

  // With one module the page reads that module's lede; with two, neither
  // describes the whole event, so the frame speaks for itself.
  it("falls back to the platform lede rather than one module's", () => {
    expect(html).toContain(
      "New to the competition? Here&#x27;s everything you need to get from a GitHub sign-in to your first points.",
    );
    expect(html).not.toContain("your first patched challenge");
    expect(html).not.toContain("your first scored answer");
  });

  it("renders one good-to-know list and one scoring card, carrying both modules' copy", () => {
    expect(html.match(/Good to know/g)).toHaveLength(1);
    expect(html.match(/How scoring works/g)).toHaveLength(1);
    expect(html).toContain("Every challenge is worth a fixed number of points");
    expect(html).toContain("Every question is worth a fixed number of points");
  });

  it("renders both module CTAs, in registry order, alongside the platform's", () => {
    expect(html.indexOf("Browse challenges")).toBeLessThan(html.indexOf("Take the quiz"));
    expect(html.indexOf("Take the quiz")).toBeLessThan(html.indexOf("Read the rules"));
  });

  it("joins both meta descriptions", () => {
    expect(metadata.description).toContain("patch a real vulnerability");
    expect(metadata.description).toContain("work through the questions");
  });

  // The generic walkthrough, not the Juice Shop one: this event's only target
  // is DVWA, so the worked example must not name an app that isn't in play.
  it("renders the generic worked example when juice-shop is not a target", () => {
    expect(html).toContain("Your first patch, end to end");
    expect(html).toContain("gh repo fork OWASP-CTF/&lt;target&gt; --clone");
    expect(html).not.toContain("Login Admin");
  });
});
