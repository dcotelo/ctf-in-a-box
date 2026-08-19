// The 404 on a classic-only event — same regression class as
// not-found-quiz-only.test.tsx: the route directory must offer /flags, not a
// card to a route this event doesn't have.
//
// Own file for the usual `vi.mock` hoisting reason.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  findSecureDevLeaks,
  normalizeHtml,
  SECURE_DEV_PATTERNS,
  SECURE_DEV_TERMS,
} from "../(site)/__tests__/secure-dev-terms";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/admin-store", () => ({
  getAdminSettings: async () => ({ moduleOverrides: {} }),
}));

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

import NotFound from "@/app/not-found";

const html = await NotFound().then(renderToStaticMarkup);

describe("the 404 in a classic-only event", () => {
  it("offers the module's own route", () => {
    expect(html).toContain('href="/flags"');
    expect(html).toContain("Every flag the organizers have published.");
  });

  it("offers no card to a route this event does not have", () => {
    expect(html).not.toContain('href="/challenges"');
    expect(html).not.toContain('href="/quiz"');
    expect(html).not.toContain("0 targets");
  });

  it("keeps the platform routes", () => {
    for (const href of ["/how-to-play", "/leaderboard", "/faq"]) {
      expect(html).toContain(`href="${href}"`);
    }
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
});
