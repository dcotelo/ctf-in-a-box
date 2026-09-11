// The ai module's registration. Registration is code + config: an entry in the
// registry AND a key under `modules:` in event.yaml. This pins the code half.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/event-config", () => ({
  eventConfig: {
    targets: [],
    modules: [{ id: "ai" }],
  },
}));

import { moduleDefById, resolveModules } from "@/lib/modules";

describe("ai module registration", () => {
  it("resolves onto the live set and carries its display metadata", () => {
    const [mod] = resolveModules({}, new Set(["ai"]));
    expect(mod.id).toBe("ai");
    const def = moduleDefById("ai")!;
    expect(def.displayName).toBe("AI Challenges");
    expect(def.description).toBeTruthy();
  });

  it("gives ai its own nav entry now that /ai exists", () => {
    expect(moduleDefById("ai")!.nav).toEqual({ href: "/ai", label: "AI Challenges" });
  });
});
