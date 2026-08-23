import { describe, expect, it, vi, beforeEach } from "vitest";

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
// Both modules enabled, same fixture as modules.test.ts / site-nav.test.ts,
// so `quiz` has a registry default title to fall back to.
vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    targets: ["dvwa"],
    modules: [
      { id: "secure-development", targets: ["dvwa"], scoreIngest: "poll" },
      { id: "quiz" },
    ],
  },
}));

const getAdminSettings = vi.fn();
vi.mock("@/lib/admin-store", () => ({ getAdminSettings }));

beforeEach(() => vi.resetModules());

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
