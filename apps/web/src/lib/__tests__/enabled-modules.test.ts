// Runtime module enablement (issue #175) — the resolver half.
//
// The property under test throughout: `event.yaml` is the SEED and the
// OUTAGE FALLBACK, never the live truth. Every case below is some way of
// asking "what happens when the stored set and the baked set disagree", and
// the answer is always the stored set — except when there isn't one, or it
// cannot be read, where it is always the baked set and never "nothing".
//
// "Never nothing" is the whole safety story. An event resolving to zero
// enabled modules 404s every route a contestant has open, and the cause would
// be a Redis blip: the loudest possible failure from the quietest possible
// cause.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
// Same two stubs, and for the same reasons, as resolved-modules.test.ts:
// `connection()` throws outside a real request context, and React's `cache()`
// memoizes nothing outside a real RSC render. See that file's comments.
vi.mock("next/server", () => ({ connection: async () => {} }));
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

// A secure-development + quiz event. `classic` is deliberately NOT baked, so
// every "enabled at runtime but never built in" case has a module to use.
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

beforeEach(() => {
  vi.resetModules();
  getAdminSettings.mockReset();
});

/** Fresh import per test — `cache()` memoizes for the life of the module. */
async function enabledIds(): Promise<ReadonlySet<string>> {
  const { getEnabledModuleIds } = await import("@/lib/enabled-modules");
  return getEnabledModuleIds();
}

describe("getEnabledModuleIds", () => {
  it("uses the baked set when nothing is stored", async () => {
    getAdminSettings.mockResolvedValue({ enabledModuleIds: null });
    expect([...(await enabledIds())].sort()).toEqual(["quiz", "secure-development"]);
  });

  it("uses the STORED set when there is one, overriding what was baked", async () => {
    // classic was never in event.yaml. Enabling it is the whole point of the
    // feature: an organizer adds a module mid-event without a rebuild.
    getAdminSettings.mockResolvedValue({ enabledModuleIds: ["classic"] });
    const ids = await enabledIds();
    expect(ids.has("classic")).toBe(true);
    expect(ids.has("quiz")).toBe(false);
  });

  it("falls back to the BAKED set when the settings read fails, not to nothing", async () => {
    // The one that matters during an incident. Resolving an outage to an empty
    // set would 404 every live module at once.
    getAdminSettings.mockRejectedValue(new Error("upstash down"));
    expect([...(await enabledIds())].sort()).toEqual(["quiz", "secure-development"]);
  });

  it("reads only — resolving enablement never writes", async () => {
    // Disabling a module must not touch its data: a re-enable has to restore
    // the same board, or the toggle is a delete wearing a switch. Nothing here
    // can write, and this pins that the resolver stays a pure read.
    getAdminSettings.mockResolvedValue({ enabledModuleIds: ["quiz"] });
    await enabledIds();
    expect(getAdminSettings).toHaveBeenCalledTimes(1);
  });
});

describe("isModuleLive", () => {
  it("answers off the stored set", async () => {
    getAdminSettings.mockResolvedValue({ enabledModuleIds: ["classic"] });
    const { isModuleLive } = await import("@/lib/enabled-modules");
    expect(await isModuleLive("classic")).toBe(true);
    expect(await isModuleLive("quiz")).toBe(false);
  });
});
