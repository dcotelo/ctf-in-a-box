// A module with no landing-page copy is VALID, not an error: `home` is
// optional on ModuleDef, so a future module can ship a route before it ships
// hero copy.
//
// Such a module still gets a landing section, led by its organizer-editable
// `blurb` — the one sentence every module has. It used to be dropped from the
// page entirely, which meant a module could be enabled, named and described in
// /admin and still be invisible to a contestant reading the landing page.
// Everything with no fallback (the uppercase tagline, the hero paragraph, the
// numbered steps, the CTA) stays absent rather than being invented.
//
// The fixture inverts the usual mock direction: the event config enables the
// quiz, but `getModuleHome` is stubbed to return nothing, so this exercises
// "enabled module, no home block" rather than "no modules at all". Own file
// because `vi.mock` hoists per file.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    name: "Bare CTF",
    theme: "",
    dates: "",
    location: "",
    ctfStartsAt: null,
    url: "http://localhost:3000",
    contactEmail: "",
    githubOrg: "OWASP-CTF",
    discordUrl: "",
    modules: [{ id: "quiz" }],
    targets: [],
    admins: [],
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/admin-store", () => ({
  getAdminSettings: async () => ({ moduleOverrides: {} }),
}));
// Real getResolvedModules (the module is genuinely enabled and resolvable);
// only the home lookup is emptied.
vi.mock("@/lib/resolved-modules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/resolved-modules")>()),
  getModuleHome: () => undefined,
}));
vi.mock("@/lib/challenges", () => ({ getChallengeCatalog: async () => null }));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

import Home from "@/app/page";

const html = await Home().then(renderToStaticMarkup);

describe("landing page with no module home blocks", () => {
  it("renders the platform frame", () => {
    expect(html).toContain("Bare CTF");
    expect(html).toContain("How to play");
    expect(html).toContain("Live leaderboard");
    expect(html).toContain("Track your progress live");
  });

  // Asserted on CONTENT, not on a Tailwind class: a restyle must not be able
  // to silently satisfy this. The tagline <p> is the only thing that can sit
  // between the headline and the close of its wrapper, so its absence is
  // structural rather than cosmetic.
  it("renders no tagline line and no hero paragraph", () => {
    expect(html).toMatch(/<\/h1><\/div>/);
    // The hero intro belongs to `home.intro()`, which does not exist here.
    expect(html).not.toContain("Answer security questions for points. Every question carries");
  });

  // The registry's `description` is the blurb's default, so with no organizer
  // override this is the quiz module's own one-liner reaching the page.
  it("leads the module's section with its blurb", () => {
    expect(html).toContain("Answer security questions for points.");
    // A lone module keeps the generic kicker; the heading is the module's
    // resolved title.
    expect(html).toContain("What to expect");
    expect(html).toContain("<h2");
    // …and NOT the authored copy, which this module deliberately has none of.
    expect(html).not.toContain("Straight questions, scored on submit");
  });

  it("renders no numbered steps for a section with no authored ones", () => {
    expect(html).not.toContain("<ol");
  });

  it("renders no module CTA", () => {
    expect(html).not.toContain("Take the quiz");
    expect(html).not.toContain("Browse targets");
  });
});
