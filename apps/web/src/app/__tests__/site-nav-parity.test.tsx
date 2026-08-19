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
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

// The render test above proves the `(site)` layout's footer agrees with the
// header. But <SiteFooter> is rendered from THREE places — the `(site)`
// layout, the landing page, and the 404 — and the other two are far more
// expensive to render here (the landing page alone needs the challenge
// catalogue, next/image and the countdown stubbed). Rendering only one of
// three would leave the drift gated on the site we already fixed and open on
// the two we might add to next.
//
// So this asserts the invariant at the source level instead: every footer
// render site resolves its links. That is exactly the mistake that shipped —
// a footer built from `site.ts`'s static list rather than the resolved one —
// and it catches a fourth call site the day someone adds it.
describe("every SiteFooter render site resolves its nav links", () => {
  const appDir = fileURLToPath(new URL("../", import.meta.url));

  const files = readdirSync(appDir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx") && !f.includes("__tests__"))
    .map((f) => [f, readFileSync(join(appDir, f), "utf8")] as const)
    .filter(([, src]) => src.includes("<SiteFooter"));

  it("finds every known render site", () => {
    // Guards the guard: if this drops to zero (a rename, a moved directory),
    // the assertions below would pass by iterating nothing.
    expect(files.map(([f]) => f).sort()).toEqual(
      ["(site)/layout.tsx", "not-found.tsx", "page.tsx"].sort(),
    );
  });

  // Deliberately two loose checks rather than one exact expression: call sites
  // legitimately differ (the landing page binds `const navLinks = await
  // getNavLinks()` once and reuses it; the others inline the await). Pinning
  // one spelling would fail on a harmless refactor while still missing a
  // footer fed from the static list, which is the failure that matters.
  it.each(files.map(([f]) => f))("%s passes resolved links", (file) => {
    const src = files.find(([f]) => f === file)![1];
    const rendered = src.match(/<SiteFooter/g)?.length ?? 0;
    const passed = src.match(/<SiteFooter\s+navLinks=/g)?.length ?? 0;
    expect(passed, `${file} renders ${rendered} footer(s), ${passed} given navLinks`).toBe(rendered);
    expect(src, `${file} must resolve its nav links`).toContain("getNavLinks");
    expect(src, `${file} must not read site.ts's unresolved navLinks`).not.toMatch(
      /import\s*\{[^}]*\bnavLinks\b[^}]*\}\s*from\s*["']@\/lib\/site["']/,
    );
  });
});
