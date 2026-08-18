import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
// getResolvedModules calls connection() before the settings read (see the
// prod code's comment) so the module boundary genuinely opts routes out of
// prerendering. Outside a real Next.js request/render context — which is
// all a unit test ever is — the real connection() throws
// (throwForMissingRequestStore), so it's stubbed here the same way
// `server-only` is: a no-op that lets the function under test run.
vi.mock("next/server", () => ({ connection: async () => {} }));
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
});
