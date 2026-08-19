// Header/footer nav parity, asserted through the REAL layouts.
//
// The header is rendered by the root layout and the footer by the `(site)`
// layout — two files, two call sites, one link list. They drifted once
// already: the header resolved its links from the module registry with the
// organizer's renames applied while the footer imported `site.ts`'s static
// `navLinks`, so a renamed module showed one label up top and a different one
// at the bottom of the very same page. Fixing the footer once doesn't stop
// that recurring; asserting the two agree does.
//
// So this deliberately renders the actual layout components rather than
// feeding both a hand-built list (which would pass no matter what the layouts
// do). Everything stubbed below is orthogonal to nav links: fonts, the
// session-reading client controls, and the server-only settings read.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Two modules with nav entries, so there is something to disagree about.
vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    name: "Test CTF",
    theme: "",
    dates: "",
    location: "",
    ctfStartsAt: "",
    url: "",
    discordUrl: "",
    contactEmail: "",
    admins: [],
    targets: ["dvwa"],
    modules: [
      { id: "secure-development", targets: ["dvwa"], scoreIngest: "poll" },
      { id: "quiz" },
    ],
  },
}));

// One module renamed, one left at its registry default: the pair proves both
// halves of the contract at once — an override must reach BOTH surfaces, and
// a module with no override must read identically in both.
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/admin-store", () => ({
  getAdminSettings: async () => ({ moduleOverrides: { quiz: { title: "Round 1" } } }),
}));

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "" });
  return { Poppins: font, Barlow: font, Geist_Mono: font };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/components/auth-nav", () => ({ default: () => null }));
vi.mock("@/components/visit-beacon", () => ({ default: () => null }));

import RootLayout from "@/app/layout";
import SiteLayout from "@/app/(site)/layout";

/** Every `href` → the link texts rendered for it. A Map of sets because the
 *  header renders its nav twice (desktop + mobile menu). */
function linkLabels(html: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const [, href, label] of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)) {
    const labels = found.get(href) ?? new Set<string>();
    labels.add(label.trim());
    found.set(href, labels);
  }
  return found;
}

const headerLinks = linkLabels(renderToStaticMarkup(await RootLayout({ children: null })));
const footerLinks = linkLabels(renderToStaticMarkup(await SiteLayout({ children: null })));

describe("header and footer nav", () => {
  it("renders a link for each module in both", () => {
    for (const href of ["/challenges", "/quiz"]) {
      expect(headerLinks.has(href), `header is missing ${href}`).toBe(true);
      expect(footerLinks.has(href), `footer is missing ${href}`).toBe(true);
    }
  });

  it("labels every shared link identically in both", () => {
    for (const [href, labels] of headerLinks) {
      const footer = footerLinks.get(href);
      if (!footer) continue;
      expect([...footer].sort(), `label drift on ${href}`).toEqual([...labels].sort());
    }
  });

  it("shows the organizer's rename in both", () => {
    expect(headerLinks.get("/quiz")).toEqual(new Set(["Round 1"]));
    expect(footerLinks.get("/quiz")).toEqual(new Set(["Round 1"]));
  });

  it("leaves an un-renamed module's registry nav label alone in both", () => {
    expect(headerLinks.get("/challenges")).toEqual(new Set(["Challenges"]));
    expect(footerLinks.get("/challenges")).toEqual(new Set(["Challenges"]));
  });
});
