// The route-state contract: every content route acknowledges a click, every
// page can be reached without tabbing the header, and a failure lands on our
// error page rather than Next's.
//
// These are deliberately STRUCTURAL (filesystem + rendered markup) rather than
// per-page unit tests, for the reason `site-nav-parity.test.tsx` gives about
// nav links: the failure mode isn't "this one page regressed", it's "a route
// added later quietly opted out". A test that names today's routes passes
// forever while the next one ships without a loading state.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = fileURLToPath(new URL("..", import.meta.url));

/** Every .tsx under src/app, recursively, skipping test folders. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "__tests__" || name === "node_modules") return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith(".tsx") ? [full] : [];
  });
}

const files = walk(appDir);
const rel = (f: string) => f.slice(appDir.length);

describe("skip link", () => {
  it("is offered by the root layout", () => {
    // WCAG 2.4.1. The header carries the wordmark, the module links, the
    // dropdown and the auth control — that was the tab cost of reaching the
    // content of EVERY page.
    const layout = readFileSync(join(appDir, "layout.tsx"), "utf8");
    expect(layout).toMatch(/href="#main-content"/);
    expect(layout).toMatch(/Skip to content/);
  });

  it("has a target in every <main> the app renders", () => {
    // The bypass is only real if it lands somewhere. A <main> without the id
    // is a route where the skip link scrolls nowhere — silently, since the
    // link itself still renders and still looks fine.
    const withMain = files.filter((f) => readFileSync(f, "utf8").includes("<main"));
    expect(withMain.length).toBeGreaterThan(0);
    const missing = withMain.filter(
      (f) => !readFileSync(f, "utf8").includes('<main id="main-content"'),
    );
    expect(missing.map(rel)).toEqual([]);
  });
});

describe("loading states", () => {
  const loadingFiles = files.filter((f) => f.endsWith("loading.tsx"));

  it("covers the content routes", () => {
    // The `(site)` group's own loading.tsx is the floor — it catches any route
    // that never got a tailored one, so this asserts the floor exists rather
    // than enumerating the routes above it.
    expect(loadingFiles.map(rel)).toContain("(site)/loading.tsx");
  });

  it("announces itself on every route that has one", async () => {
    // A client-side route change moves no focus and prints nothing, so a
    // skeleton with no live region is a silent wait for a screen-reader user:
    // exactly the dead air the skeleton exists to remove for everyone else.
    expect(loadingFiles.length).toBeGreaterThan(1);
    for (const file of loadingFiles) {
      const mod = (await import(file)) as { default: () => React.ReactElement };
      const html = renderToStaticMarkup(mod.default());
      expect(html, rel(file)).toMatch(/role="status"/);
      expect(html, rel(file)).toMatch(/Loading /);
      // The shimmer atom, not a bespoke grey box per route.
      expect(html, rel(file)).toMatch(/ds-skeleton/);
    }
  });
});

describe("error boundaries", () => {
  it("exist at both levels", () => {
    // `error.tsx` cannot catch a failure in the root layout it renders
    // inside — that is what `global-error.tsx` is for, and the root layout
    // does a runtime settings read that a Redis outage takes down.
    expect(files.map(rel)).toContain("error.tsx");
    expect(files.map(rel)).toContain("global-error.tsx");
  });

  it("takes the retry prop this Next version actually passes", () => {
    // Next 16.3 renamed the recovery prop: `retry()` re-fetches the segment's
    // data, while the `reset()` older App Router code uses only re-renders the
    // same failed children — which for a failed data read fails again. A
    // boundary written from memory gets `reset`, renders fine, and hands the
    // contestant a Try again button that cannot work.
    for (const name of ["error.tsx", "global-error.tsx"]) {
      const src = readFileSync(join(appDir, name), "utf8");
      expect(src, name).toMatch(/retry:\s*\(\)\s*=>\s*void/);
      expect(src, name).toMatch(/onClick=\{\(\) => retry\(\)\}/);
    }
  });

  it("paints its own colours in global-error, which gets no stylesheet", () => {
    // global-error REPLACES the root layout, and globals.css is imported by
    // that layout — so a global-error styled with Tailwind classes renders as
    // unstyled black-on-white at the exact moment the site is already broken.
    const src = readFileSync(join(appDir, "global-error.tsx"), "utf8");
    expect(src).toMatch(/<html/);
    expect(src).toMatch(/<body/);
    expect(src).toMatch(/#1a1a2e/); // the app's ground, restated inline
  });
});
