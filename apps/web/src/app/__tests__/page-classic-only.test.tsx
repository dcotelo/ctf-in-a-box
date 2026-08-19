// The landing page on a classic-only event — same regression class as
// page-quiz-only.test.tsx, for the module that shipped after it. A
// classic-only event must not advertise secure-development's fork/patch/PR
// workflow, and classic's own copy must actually render instead.
//
// Own file because `vi.mock` hoists per file and this fixture needs its own
// event config (the shipped one enables secure-development only) — same
// split as lib/__tests__/modules-resolve.test.ts.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { findSecureDevLeaks, normalizeHtml, SECURE_DEV_PATTERNS, SECURE_DEV_TERMS } from "../(site)/__tests__/secure-dev-terms";

vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    name: "Flag Night",
    theme: "",
    dates: "",
    location: "",
    ctfStartsAt: null,
    url: "http://localhost:3000",
    contactEmail: "",
    githubOrg: "OWASP-CTF",
    discordUrl: "",
    modules: [{ id: "classic" }],
    targets: [],
    admins: [],
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/admin-store", () => ({
  getAdminSettings: async () => ({ moduleOverrides: {} }),
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

describe("landing page in a classic-only event", () => {
  it("still renders the platform frame", () => {
    expect(html).toContain("Flag Night");
    expect(html).toContain("How to play");
    expect(html).toContain("Track your progress live");
  });

  it("renders no patch/PR/fork copy", () => {
    expect(html).not.toContain("pull request");
    expect(html).not.toContain("fork");
    expect(html).not.toContain("Secure Development CTF");
    expect(html).not.toContain("Browse targets");
    expect(html).not.toContain("patched");
  });

  it("does not invite contestants to bring an AI agent", () => {
    expect(html).not.toContain("Please use AI");
    expect(html).not.toContain("Bring your agent");
    expect(html).not.toContain("Secure Agent Playbook");
  });

  it("renders no targets grid", () => {
    expect(html).not.toContain("Each app is a well-known");
    expect(html).not.toContain("Juice Shop");
  });

  it("renders no secure-development copy", () => {
    expect(findSecureDevLeaks(html)).toEqual([]);
  });

  it.each(SECURE_DEV_TERMS)("does not leak %j", (term) => {
    expect(normalizeHtml(html)).not.toContain(term);
  });

  it.each(SECURE_DEV_PATTERNS)("does not leak %s", (pattern) => {
    expect(html).not.toMatch(pattern);
  });

  it("renders the classic module's own copy instead", () => {
    expect(html).toContain("Find each flag and submit it for points.");
    expect(html).toContain("Find it, submit it, get scored on the spot");
    expect(html).toContain("Browse the flags");
    expect(html).toContain('href="/flags"');
  });

  it("renders classic's three steps", () => {
    for (const title of ["Sign in with GitHub", "Pick a flag and go find it", "Submit it and get scored"]) {
      expect(html).toContain(title);
    }
  });

  it("states the case- and whitespace-insensitivity of grading, and never claims an attempt cap", () => {
    expect(html).toContain("case-insensitive");
    expect(html).not.toMatch(/\battempts? (remaining|left)\b/i);
  });

  it("describes the event with the classic tagline, not secure-development's", () => {
    expect(metadata.description).toBe("Flag Night — Classic CTF.");
  });
});
