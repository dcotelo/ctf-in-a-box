// Header/footer nav parity, asserted through the REAL layouts.
//
// The header is rendered by the root layout and the footer by the `(site)`
// layout — two files, two call sites, and (since the header groups 2+ module
// links into a "Challenges" dropdown while the footer stays flat) two
// deliberately different SHAPES built from one shared resolved-modules read.
// They drifted once already, before the grouping existed: the header resolved
// its links from the module registry with the organizer's renames applied
// while the footer imported `site.ts`'s static `navLinks`, so a renamed
// module showed one label up top and a different one at the bottom of the
// very same page. Fixing the footer once doesn't stop that recurring;
// asserting both derive from the same resolved modules does.
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
import { getNavGroups, getNavLinks, getResolvedModules } from "@/lib/resolved-modules";
import { buildNavGroups, buildNavLinks, isNavGroup } from "@/lib/site";

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

const headerHtml = renderToStaticMarkup(await RootLayout({ children: null }));
const footerHtml = renderToStaticMarkup(await SiteLayout({ children: null }));
const headerLinks = linkLabels(headerHtml);
const footerLinks = linkLabels(footerHtml);

// This mock config enables two modules with nav entries (secure-development,
// unrenamed; quiz, renamed to "Round 1"), so the header now collapses them
// into one "Challenges" dropdown (see buildNavGroups) instead of rendering
// two top-level links. That dropdown's items sit behind a `useState` toggle
// that starts closed, so — per this repo's testing rule that anything behind
// a client-side toggle never appears in `renderToStaticMarkup` — the header's
// initial render exposes neither module href as a plain `<a>`; only the
// footer (which stays flat, per design) does.
//
// The header/footer split this file used to pin was "the same static list,
// rendered two different ways." That drift is now impossible by construction
// for a different reason: `getNavLinks` and `getNavGroups` both run their own
// pure builder over the exact same `getResolvedModules()` result (memoized
// per request), so there is only ever one resolved-modules read for an
// organizer's rename to fail to reach. This file pins THAT property instead:
// both accessors are provably pure functions of one shared resolved-modules
// call, and the footer (the one surface whose links are actually visible in
// a static render) shows an un-renamed module's `nav.label` and a renamed
// one's override, exactly as before.
describe("header groups module nav links; footer stays flat", () => {
  const navGroups = getNavGroups();
  const navFlat = getNavLinks();

  it("collapses 2+ module links into one dropdown labelled the literal \"Challenges\", using each module's title", async () => {
    const group = (await navGroups).find(isNavGroup);
    if (!group) throw new Error("expected getNavGroups() to contain a NavGroup");
    expect(group.label).toBe("Challenges");
    // secure-development has no override, so its child reads its registry
    // `displayName` ("Secure Development") — NOT its nav.label ("Challenges")
    // — while quiz's admin override ("Round 1") flows straight through.
    expect(group.items).toEqual([
      { href: "/challenges", label: "Secure Development" },
      { href: "/quiz", label: "Round 1" },
    ]);
  });

  it("keeps the footer flat: an un-renamed module's nav.label survives, an override still wins", async () => {
    expect(footerLinks.get("/challenges")).toEqual(new Set(["Challenges"]));
    expect(footerLinks.get("/quiz")).toEqual(new Set(["Round 1"]));
  });

  it("renders the header trigger closed by default, with the required ARIA wiring, and no module hrefs exposed until it opens", () => {
    expect(headerHtml).toMatch(/aria-haspopup="menu"/);
    expect(headerHtml).toMatch(/aria-expanded="false"/);
    expect(headerHtml).not.toContain('role="menu"');
    expect(headerLinks.has("/challenges"), "the collapsed dropdown must not leak its item hrefs into a closed render").toBe(false);
    expect(headerLinks.has("/quiz"), "the collapsed dropdown must not leak its item hrefs into a closed render").toBe(false);
  });

  it("getNavLinks and getNavGroups are both pure functions of the SAME resolved modules", async () => {
    const resolved = await getResolvedModules();
    expect(await navFlat).toEqual(buildNavLinks(resolved));
    expect(await navGroups).toEqual(buildNavGroups(resolved));
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
