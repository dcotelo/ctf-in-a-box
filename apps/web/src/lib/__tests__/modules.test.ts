import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    targets: ["dvwa"],
    modules: [
      { id: "secure-development", targets: ["dvwa"], scoreIngest: "poll" },
      { id: "quiz" },
    ],
  },
}));

import { ALL_MODULE_ROUTES, enabledModules, isModuleEnabled } from "@/lib/modules";

describe("module registry", () => {
  it("derives the enabled modules from config, in registry order", () => {
    expect(enabledModules.map((m) => m.id)).toEqual(["secure-development", "quiz"]);
    expect(isModuleEnabled("quiz")).toBe(true);
  });

  it("gives secure-development its display metadata and nav entry", () => {
    const mod = enabledModules.find((m) => m.id === "secure-development")!;
    expect(mod.displayName).toBe("Secure Development");
    expect(mod.nav).toEqual({ href: "/challenges", label: "Challenges" });
  });

  it("gives quiz its own nav entry now that /quiz exists", () => {
    expect(enabledModules.find((m) => m.id === "quiz")!.nav).toEqual({ href: "/quiz", label: "Quiz" });
  });

  it("registers classic with its own route, distinct from secure-development's", () => {
    expect(ALL_MODULE_ROUTES).toContain("/flags");
    expect(ALL_MODULE_ROUTES).toContain("/challenges");
  });
});

describe("module registry — negative enablement", () => {
  it("omits a module from enabledModules and isModuleEnabled when it is absent from config", async () => {
    vi.resetModules();
    vi.doMock("@/lib/event-config", () => ({
      eventConfig: {
        targets: ["dvwa"],
        // secure-development is deliberately omitted here.
        modules: [{ id: "quiz" }],
      },
    }));

    const { enabledModules: enabled, isModuleEnabled: isEnabled } = await import("@/lib/modules");

    expect(enabled.map((m) => m.id)).toEqual(["quiz"]);
    expect(enabled.some((m) => m.id === "secure-development")).toBe(false);
    expect(isEnabled("secure-development")).toBe(false);

    vi.doUnmock("@/lib/event-config");
    vi.resetModules();
  });
});
