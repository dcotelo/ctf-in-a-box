// Composition with more than one module enabled. Own file because `vi.mock`
// hoists per file and this fixture needs its own event config — see
// page-quiz-only.test.tsx and lib/__tests__/modules-resolve.test.ts.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    name: "Two-Track CTF",
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

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
// An organizer rename, so the per-module section headings are demonstrably the
// RESOLVED title and not the registry default.
vi.mock("@/lib/admin-store", () => ({
  getAdminSettings: async () => ({ moduleOverrides: { quiz: { title: "Round 1" } } }),
}));
vi.mock("@/lib/challenges", () => ({ getChallengeCatalog: async () => null }));
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

const html = await Home().then(renderToStaticMarkup);

describe("landing page with two modules enabled", () => {
  it("joins both taglines under the event name", () => {
    expect(html).toContain("Secure Development CTF · Quiz");
  });

  it("renders both modules' hero intros", () => {
    expect(html).toContain("Break real vulnerabilities in 1 OWASP training app");
    expect(html).toContain("Answer security questions drawn from the OWASP Top 10.");
  });

  it("renders both modules' CTAs, in registry order, alongside the platform's", () => {
    expect(html.indexOf("How to play")).toBeLessThan(html.indexOf("Browse targets"));
    expect(html.indexOf("Browse targets")).toBeLessThan(html.indexOf("Take the quiz"));
    expect(html.indexOf("Take the quiz")).toBeLessThan(html.indexOf("Live leaderboard"));
  });

  it("heads each what-to-expect section with that module's resolved title", () => {
    expect(html).toContain(">Secure Development<");
    expect(html).toContain(">Round 1<");
    expect(html).not.toContain("What to expect");
  });

  it("renders each module's own steps", () => {
    expect(html).toContain("Patch it and open a PR");
    expect(html).toContain("Get scored on submit");
  });

  it("keeps the bring-your-agent section attached to secure-development only", () => {
    expect(html).toContain("Please use AI");
    expect(html.indexOf("Please use AI")).toBeLessThan(html.indexOf("Round 1"));
  });

  it("still renders the secure-development targets grid", () => {
    expect(html).toContain("1 real target");
    expect(html).toContain("DVWA");
  });

  it("describes the event with both taglines", () => {
    expect(metadata.description).toBe("Two-Track CTF — Secure Development CTF · Quiz.");
  });
});
