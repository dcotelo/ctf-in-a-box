// resolveModules regression gate. The shared fixture in modules.test.ts (via
// event-config.generated.ts) enables only secure-development, so assertions
// on the quiz module need their own two-module fixture. `vi.mock` is hoisted
// per file, so this lives alongside modules.test.ts rather than inside it —
// see leaderboard-single-module.test.tsx for the same pattern.
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

import { enabledModules, resolveModules } from "@/lib/modules";

describe("resolveModules", () => {
  it("falls back to registry defaults when there are no overrides", () => {
    const resolved = resolveModules({});
    const quiz = resolved.find((m) => m.id === "quiz");
    expect(quiz?.title).toBe("Quiz");
    expect(quiz?.blurb).toBe("Answer security questions for points.");
  });

  it("applies a title override", () => {
    const resolved = resolveModules({ quiz: { title: "Round 1: Fundamentals" } });
    expect(resolved.find((m) => m.id === "quiz")?.title).toBe("Round 1: Fundamentals");
  });

  it("applies a blurb override independently of the title", () => {
    const resolved = resolveModules({ quiz: { blurb: "Ten questions, five minutes." } });
    const quiz = resolved.find((m) => m.id === "quiz");
    expect(quiz?.title).toBe("Quiz");
    expect(quiz?.blurb).toBe("Ten questions, five minutes.");
  });

  it("ignores an override for a module that is not enabled", () => {
    const resolved = resolveModules({ "not-a-module": { title: "Nope" } } as never);
    expect(resolved.some((m) => m.title === "Nope")).toBe(false);
  });

  it("treats an empty-string override as absent", () => {
    const resolved = resolveModules({ quiz: { title: "" } });
    expect(resolved.find((m) => m.id === "quiz")?.title).toBe("Quiz");
  });

  it("preserves registry order and the nav entry", () => {
    const resolved = resolveModules({ quiz: { title: "Trivia" } });
    expect(resolved.map((m) => m.id)).toEqual(enabledModules.map((m) => m.id));
    expect(resolved.find((m) => m.id === "quiz")?.nav?.href).toBe("/quiz");
  });
});
