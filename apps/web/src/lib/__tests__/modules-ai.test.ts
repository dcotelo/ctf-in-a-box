// The ai module's registration. Registration is code + config: an entry in the
// registry AND a key under `modules:` in event.yaml. This pins the code half.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    targets: [],
    modules: [{ id: "ai" }],
  },
}));

import { enabledModules, isModuleEnabled } from "@/lib/modules";

describe("ai module registration", () => {
  it("is enabled from config and carries its display metadata", () => {
    expect(isModuleEnabled("ai")).toBe(true);
    const mod = enabledModules.find((m) => m.id === "ai")!;
    expect(mod.displayName).toBe("AI Challenges");
    expect(mod.description).toBeTruthy();
  });

  it("has NO nav entry yet — /ai does not exist until the pages PR", () => {
    expect(enabledModules.find((m) => m.id === "ai")!.nav).toBeUndefined();
  });

  it("owns no targets — it is a pure app module with no compose service", () => {
    expect(enabledModules.find((m) => m.id === "ai")!.targets).toEqual([]);
  });
});
