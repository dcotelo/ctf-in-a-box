import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
// getResolvedModules calls connection() before the settings read (see the
// prod code's comment) so the module boundary genuinely opts routes out of
// prerendering. Outside a real Next.js request/render context — which is
// all a unit test ever is — the real connection() throws
// (throwForMissingRequestStore), so it's stubbed here the same way
// `server-only` is: a no-op that lets the function under test run.
vi.mock("next/server", () => ({ connection: async () => {} }));
// React's real `cache()` only memoizes inside an active per-request Server
// Components render: it looks up a live dispatcher that Next's renderer
// installs, which plain Vitest (no real RSC render, and no `react-server`
// export condition wired into this project's Vite resolution) never
// provides — confirmed empirically: importing the real `cache` here calls
// the wrapped function on every invocation, memoizing nothing. This stub
// reproduces the one contract resolved-modules.ts actually depends on —
// call the wrapped (zero-arg) function once, return that same result to
// every later caller — a WeakMap keyed by function identity, so it neither
// bleeds across `vi.resetModules()` (which gives `getResolvedModules` a
// fresh function identity) nor across test files.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const memos = new WeakMap<(...args: never[]) => unknown, unknown>();
  return {
    ...actual,
    cache:
      <Fn extends (...args: never[]) => unknown>(fn: Fn): Fn =>
        ((...args: never[]) => {
          if (!memos.has(fn)) memos.set(fn, fn(...args));
          return memos.get(fn);
        }) as Fn,
  };
});
const getAdminSettings = vi.fn();
vi.mock("@/lib/admin-store", () => ({ getAdminSettings }));

type MockedSettings = { moduleOverrides?: unknown; enabledModuleIds?: string[] } | null;

// getResolvedModules now sources its settings snapshot AND its live set from
// `@/lib/enabled-modules` (CodeRabbit round 1 finding A) instead of reading
// `getAdminSettings()` a second time and skipping the secure-development
// narrowing. Reimplemented here against the SAME mocked `getAdminSettings`
// above, rather than mocked away as a black box, so this file's
// `getAdminSettings.mockResolvedValue(...)` calls keep driving both the
// nav-rename tests AND the live-set tests exactly as before.
//
// `defaultModuleIds` stays a fixed two-module fixture independent of
// `process.env.SCORE_IMAGE` — matching the rest of this file's fixture — but
// the secure-development NARROWING is the real, unmocked
// `secureDevAvailable` from the pure `@/lib/module-defaults`, so a test can
// still exercise it by toggling `process.env.SCORE_IMAGE`.
//
// Registered with `vi.doMock` INSIDE `beforeEach`, not the usual hoisted
// `vi.mock` at module scope: a hoisted factory runs exactly ONCE for the
// whole file (confirmed empirically — the `settingsPromise` memo below leaked
// its first resolved/rejected value into every later test when this was a
// plain `vi.mock`, the same way the `react` cache mock's WeakMap persists
// across `vi.resetModules()` on purpose). `doMock` + a fresh call per test
// gives `getResolvedModules`'s ONE-settings-read-per-request property an
// actually fresh "request" (a fresh `settingsPromise` closure) every test,
// which is what `vi.resetModules()` gives the REAL, unmocked
// `enabled-modules.ts`/`resolved-modules.ts` for free (a fresh `cache()`-
// wrapped function each import) — this hand-written mock has to do it by
// hand instead of getting it from a real `cache()` call.
async function mockEnabledModules() {
  const { secureDevAvailable } = await vi.importActual<typeof import("@/lib/module-defaults")>("@/lib/module-defaults");
  // Both modules enabled, same fixture as modules.test.ts / site-nav.test.ts,
  // so `quiz` has a registry default title to fall back to.
  const defaultModuleIds = ["secure-development", "quiz"];
  let settingsPromise: Promise<MockedSettings> | null = null;
  const getAdminSettingsSnapshot = (): Promise<MockedSettings> =>
    settingsPromise ?? (settingsPromise = getAdminSettings().catch(() => null));
  vi.doMock("@/lib/enabled-modules", () => ({
    defaultModuleIds,
    getAdminSettingsSnapshot,
    getEnabledModuleIds: async () => {
      const settings = await getAdminSettingsSnapshot();
      const resolved = new Set(settings?.enabledModuleIds ?? defaultModuleIds);
      if (!secureDevAvailable(process.env)) resolved.delete("secure-development");
      return resolved;
    },
  }));
}

beforeEach(async () => {
  vi.resetModules();
  await mockEnabledModules();
  // Most of this file's tests assume secure-development survives the
  // narrowing above; the one test that cares about SCORE_IMAGE being unset
  // sets/restores it itself.
  process.env.SCORE_IMAGE = "ghcr.io/x/score:latest";
});

afterEach(() => {
  delete process.env.SCORE_IMAGE;
});

describe("getResolvedModules", () => {
  it("applies stored overrides", async () => {
    getAdminSettings.mockResolvedValue({ moduleOverrides: { quiz: { title: "Round 1" } } });
    const { getResolvedModules } = await import("@/lib/resolved-modules");
    expect((await getResolvedModules()).find((m) => m.id === "quiz")?.title).toBe("Round 1");
  });

  // The failure path is the one worth a test: it only ever runs during an outage.
  it("falls back to registry defaults when the settings read fails", async () => {
    getAdminSettings.mockRejectedValue(new Error("redis down"));
    const { getResolvedModules } = await import("@/lib/resolved-modules");
    const mods = await getResolvedModules();
    expect(mods.find((m) => m.id === "quiz")?.title).toBe("Quiz");
    expect(mods.length).toBeGreaterThan(0);
  });

  // The whole point of wrapping this in React's cache(): a page's
  // generateMetadata and its page body (or the root layout's nav and a
  // page's body) both call getResolvedModules(), and that must cost ONE
  // getAdminSettings() read, not one per call — see the module comment.
  it("dedupes the settings read across multiple calls within the same request", async () => {
    getAdminSettings.mockResolvedValue({ moduleOverrides: {} });
    // getAdminSettings.mock.calls accumulates across every `it` in this file
    // (it's one shared vi.fn(); only vi.resetModules() runs in beforeEach) —
    // clear it so this assertion counts only THIS test's calls.
    getAdminSettings.mockClear();
    const { getResolvedModules } = await import("@/lib/resolved-modules");

    const first = await getResolvedModules();
    const second = await getResolvedModules();

    expect(getAdminSettings).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  // CodeRabbit round 1, finding A: before this fix, getResolvedModules built
  // its live set from the RAW `enabledModuleIds` on the settings object,
  // skipping the secure-development narrowing `getEnabledModuleIds` applies
  // — so the landing page could show the Secure Development card on a
  // deployment with no scorer image, in the same request `isModuleLive`
  // answers false for it. Sourcing the live set from `getEnabledModuleIds()`
  // closes that: the narrowing applies here too, by construction.
  it("does not resolve secure-development when SCORE_IMAGE is unset even if stored", async () => {
    delete process.env.SCORE_IMAGE;
    getAdminSettings.mockResolvedValue({ moduleOverrides: {}, enabledModuleIds: ["secure-development", "quiz"] });
    const { getResolvedModules } = await import("@/lib/resolved-modules");
    const ids = (await getResolvedModules()).map((m) => m.id);
    expect(ids).not.toContain("secure-development");
    expect(ids).toContain("quiz");
  });
});

// Runtime enablement reaches the NAV (issue #175). The header and the footer
// both build off `getResolvedModules`, so a module switched off has to lose its
// link in both — leaving a nav entry pointing at a route that now 404s is the
// most visible way this feature could go wrong.
describe("the nav follows the live module set", () => {
  it("drops a disabled module's link", async () => {
    getAdminSettings.mockResolvedValue({ moduleOverrides: {}, enabledModuleIds: ["secure-development"] });
    const { getNavLinks } = await import("@/lib/resolved-modules");
    const hrefs = (await getNavLinks()).map((l) => l.href);
    expect(hrefs).toContain("/challenges");
    expect(hrefs).not.toContain("/quiz");
  });

  it("keeps it when the module is live", async () => {
    getAdminSettings.mockResolvedValue({ moduleOverrides: {}, enabledModuleIds: ["secure-development", "quiz"] });
    const { getNavLinks } = await import("@/lib/resolved-modules");
    expect((await getNavLinks()).map((l) => l.href)).toContain("/quiz");
  });

  it("carries the organizer's rename onto a live module's link", async () => {
    getAdminSettings.mockResolvedValue({
      moduleOverrides: { quiz: { title: "Round 1" } },
      enabledModuleIds: ["secure-development", "quiz"],
    });
    const { getNavLinks } = await import("@/lib/resolved-modules");
    expect((await getNavLinks()).find((l) => l.href === "/quiz")?.label).toBe("Round 1");
  });
});
