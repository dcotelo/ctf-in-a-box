// A module with no landing-page copy is VALID, not an error: `home` is
// optional on ModuleDef, so a future module can ship a route before it ships
// hero copy. The platform frame must then render on its own — no empty tagline
// line, no headless "what to expect" section, no crash.
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

  it("renders no tagline line and no what-to-expect section", () => {
    expect(html).not.toContain("tracking-[0.25em]");
    expect(html).not.toContain("What to expect");
  });

  it("renders no module CTA", () => {
    expect(html).not.toContain("Take the quiz");
    expect(html).not.toContain("Browse targets");
  });
});
