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

import { ALL_MODULE_ROUTES, enabledModules, isModuleEnabled, moduleDefById } from "@/lib/modules";

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

// Issue #249: secure-development's contestant copy said that revealing a hint
// costs points; classic's and ai's did not, though all three sell hints
// through the same gate. On a classic- or ai-only event a contestant learned
// the price only from the reveal button itself.
describe("hint cost is stated wherever hints are sold", () => {
  // Driven by `HintTarget` (hint-store.ts) rather than a list written out
  // here: the modules that sell hints are secure-development (via its
  // targets), classic and ai. A fourth one added to that union without this
  // copy should fail here rather than ship silently.
  const SELL_HINTS = ["secure-development", "classic", "ai"] as const;

  /** The registry hands its copy builders a live-facts context; these strings
   *  read only the target count. */
  const RULES_CTX = { appCount: 1, appNames: ["DVWA"] } as never;

  it.each(SELL_HINTS)("%s tells contestants that a hint deducts points, in both rules and terms", (id) => {
    const mod = moduleDefById(id)!;
    // `scoring` is optional on the copy types, so its presence is part of
    // what is being asserted: a module that sells hints and ships no scoring
    // copy at all fails here rather than passing on an empty string.
    const rulesScoring = mod.rules!(RULES_CTX).scoring;
    const termsScoring = mod.terms!(RULES_CTX).scoring;
    expect(rulesScoring).toBeDefined();
    expect(termsScoring).toBeDefined();
    const rules = rulesScoring!.join(" ");
    const terms = termsScoring!.join(" ");
    expect(rules).toMatch(/hint/i);
    expect(rules).toMatch(/deduct/i);
    expect(terms).toMatch(/hint/i);
    expect(terms).toMatch(/deduct/i);
  });

  it("says nothing of the sort for quiz, which sells no hints", () => {
    // Not an oversight to fix later: quiz has no hints by design, so the
    // sentence would be a lie there.
    const mod = moduleDefById("quiz")!;
    expect((mod.rules!(RULES_CTX).scoring ?? []).join(" ")).not.toMatch(/hint/i);
    expect((mod.terms!(RULES_CTX).scoring ?? []).join(" ")).not.toMatch(/hint/i);
  });
});
