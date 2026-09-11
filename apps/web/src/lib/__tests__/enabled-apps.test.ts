// The runtime filter over apps.ts's static catalogue (issue #386, PR 2).
// Mirrors enabled-modules.test.ts's shape: mock the ONE settings snapshot
// every export here builds on, and a synthetic `cache()` so memoization is
// actually exercised outside a real RSC render (see that file's comment).

import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminSettingsSnapshot: vi.fn<() => Promise<{ secureDevTargets: string[] | null } | null>>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/enabled-modules", () => ({ getAdminSettingsSnapshot: mocks.getAdminSettingsSnapshot }));
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

beforeEach(() => {
  mocks.getAdminSettingsSnapshot.mockReset();
  vi.resetModules();
});

const ALL_SIX = ["juice-shop", "dvwa", "webgoat", "securityshepherd", "vulnerableapp", "vampi"];

describe("getSecureDevTargets", () => {
  it("defaults to all six, in catalogue order, when nothing is stored", async () => {
    mocks.getAdminSettingsSnapshot.mockResolvedValue(null);
    const m = await import("@/lib/enabled-apps");
    expect(await m.getSecureDevTargets()).toEqual(ALL_SIX);
  });

  it("passes the stored set through as-is — admin-store's decodeSettings is what normalizes it to catalogue order", async () => {
    mocks.getAdminSettingsSnapshot.mockResolvedValue({ secureDevTargets: ["dvwa", "vampi"] });
    const m = await import("@/lib/enabled-apps");
    expect(await m.getSecureDevTargets()).toEqual(["dvwa", "vampi"]);
  });
});

describe("getEnabledApps", () => {
  it("returns all six catalogue entries when nothing is stored", async () => {
    mocks.getAdminSettingsSnapshot.mockResolvedValue(null);
    const m = await import("@/lib/enabled-apps");
    expect((await m.getEnabledApps()).map((a) => a.id)).toEqual(ALL_SIX);
  });

  it("returns only the stored targets' catalogue entries, in catalogue order", async () => {
    mocks.getAdminSettingsSnapshot.mockResolvedValue({ secureDevTargets: ["vampi", "dvwa"] });
    const m = await import("@/lib/enabled-apps");
    expect((await m.getEnabledApps()).map((a) => a.id)).toEqual(["dvwa", "vampi"]);
  });
});

describe("getEnabledAppsById", () => {
  it("keys only the enabled apps — a disabled target is absent, not undefined-valued", async () => {
    mocks.getAdminSettingsSnapshot.mockResolvedValue({ secureDevTargets: ["dvwa"] });
    const m = await import("@/lib/enabled-apps");
    const byId = await m.getEnabledAppsById();
    expect(Object.keys(byId)).toEqual(["dvwa"]);
    expect("vampi" in byId).toBe(false);
  });
});

describe("getEnabledTotals", () => {
  it("sums challengeCount and maxPoints across only the stored targets", async () => {
    mocks.getAdminSettingsSnapshot.mockResolvedValue({ secureDevTargets: ["dvwa", "vampi"] });
    const { apps } = await import("@/lib/apps");
    const dvwa = apps.find((a) => a.id === "dvwa")!;
    const vampi = apps.find((a) => a.id === "vampi")!;
    const m = await import("@/lib/enabled-apps");
    expect(await m.getEnabledTotals()).toEqual({
      challenges: dvwa.challengeCount + vampi.challengeCount,
      maxPoints: dvwa.maxPoints + vampi.maxPoints,
    });
  });

  it("costs ONE settings snapshot read across getEnabledApps and getEnabledTotals in the same request", async () => {
    mocks.getAdminSettingsSnapshot.mockResolvedValue({ secureDevTargets: ["dvwa"] });
    const m = await import("@/lib/enabled-apps");
    await m.getEnabledApps();
    await m.getEnabledTotals();
    expect(mocks.getAdminSettingsSnapshot).toHaveBeenCalledTimes(1);
  });
});
