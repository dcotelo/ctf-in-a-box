// Runtime module enablement (issue #175), now on top of the default set
// derived from SCORE_IMAGE (issue #386). The property under test throughout:
// `ctf:admin:settings` is the live truth, and the default (secure-development
// iff a scorer image exists, else nothing) is only the SEED and the OUTAGE
// FALLBACK — see `@/lib/module-defaults`.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminSettings: vi.fn<() => Promise<{ enabledModuleIds: string[] | null }>>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/admin-store", () => ({ getAdminSettings: mocks.getAdminSettings }));

beforeEach(() => {
  mocks.getAdminSettings.mockReset();
  vi.resetModules();
});

async function load(env: Record<string, string | undefined>) {
  const prev = process.env.SCORE_IMAGE;
  if (env.SCORE_IMAGE === undefined) delete process.env.SCORE_IMAGE;
  else process.env.SCORE_IMAGE = env.SCORE_IMAGE;
  try {
    return await import("@/lib/enabled-modules");
  } finally {
    if (prev === undefined) delete process.env.SCORE_IMAGE;
    else process.env.SCORE_IMAGE = prev;
  }
}

describe("getEnabledModuleIds", () => {
  it("defaults to secure-development only when SCORE_IMAGE is set and nothing is stored", async () => {
    mocks.getAdminSettings.mockResolvedValue({ enabledModuleIds: null });
    const m = await load({ SCORE_IMAGE: "ghcr.io/x/score:latest" });
    expect([...(await m.getEnabledModuleIds())]).toEqual(["secure-development"]);
  });
  it("defaults to NOTHING when there is no scorer image and nothing is stored", async () => {
    mocks.getAdminSettings.mockResolvedValue({ enabledModuleIds: null });
    const m = await load({ SCORE_IMAGE: undefined });
    expect((await m.getEnabledModuleIds()).size).toBe(0);
  });
  it("uses the STORED set when there is one, whatever the default", async () => {
    mocks.getAdminSettings.mockResolvedValue({ enabledModuleIds: ["quiz", "classic"] });
    const m = await load({ SCORE_IMAGE: "ghcr.io/x/score:latest" });
    expect([...(await m.getEnabledModuleIds())].sort()).toEqual(["classic", "quiz"]);
  });
  it("honours an explicitly EMPTY stored set — an organizer switched everything off", async () => {
    mocks.getAdminSettings.mockResolvedValue({ enabledModuleIds: [] });
    const m = await load({ SCORE_IMAGE: "ghcr.io/x/score:latest" });
    expect((await m.getEnabledModuleIds()).size).toBe(0);
  });
  it("falls back to the DEFAULT set when the settings read fails (fail open)", async () => {
    mocks.getAdminSettings.mockRejectedValue(new Error("NOAUTH"));
    const m = await load({ SCORE_IMAGE: "ghcr.io/x/score:latest" });
    expect([...(await m.getEnabledModuleIds())]).toEqual(["secure-development"]);
  });
});

describe("isModuleLive", () => {
  it("answers off the stored set", async () => {
    mocks.getAdminSettings.mockResolvedValue({ enabledModuleIds: ["ai"] });
    const m = await load({ SCORE_IMAGE: undefined });
    expect(await m.isModuleLive("ai")).toBe(true);
    expect(await m.isModuleLive("quiz")).toBe(false);
  });
});
