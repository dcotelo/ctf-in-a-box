// resolveModules regression gate, on a two-module fixture.
//
// The registry is derived from the BAKED event config, and the shipped
// event-config.generated.ts enables only secure-development — so anything
// asserting on a second module has to mock `@/lib/event-config`. It mocks
// event-config rather than `@/lib/modules` because resolveModules lives in
// `@/lib/modules`: stubbing that module would replace the function under test.
// `vi.mock` is hoisted per file, so the fixture lives in its own file — see
// leaderboard-single-module.test.tsx for the same split.
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

import { enabledModules, resolveModules, type ResolvedModule } from "@/lib/modules";

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

  it("treats a whitespace-only override as absent", () => {
    const resolved = resolveModules({ quiz: { title: "   ", blurb: "\t" } });
    const quiz = resolved.find((m) => m.id === "quiz");
    expect(quiz?.title).toBe("Quiz");
    expect(quiz?.blurb).toBe("Answer security questions for points.");
  });

  // The registry defaults must not survive onto a resolved module: consumers
  // render `title`, and leaving `displayName` reachable made "read the wrong
  // property and silently ignore the organizer's override" a mistake no type
  // check could catch.
  it("drops the registry default fields from the resolved object", () => {
    const resolved = resolveModules({ quiz: { title: "Trivia" } });
    for (const m of resolved) {
      expect(m).not.toHaveProperty("displayName");
      expect(m).not.toHaveProperty("description");
    }
  });

  // A resolved module is handed from Server Components straight to
  // "use client" components (the admin panel's tabs, the leaderboard). React's
  // flight serializer throws "Functions cannot be passed directly to Client
  // Components" on ANY function-valued prop, which would 500 /admin and
  // /leaderboard at runtime — and no component test would catch it, because
  // those suites render client components directly, with no RSC boundary in
  // play. `ModuleHome.intro`/`.steps` are functions, so `home` is stripped
  // from the resolved object (not merely Omitted from the type — a type-only
  // Omit leaves the functions on the value, which is what actually throws).
  //
  // Two guards, because either alone has a hole. The runtime scan below is
  // vacuous while no module defines a `home` yet, but bites the moment one
  // does (Task 7) if the strip is ever removed; the compile-time check bites
  // today, the moment `home` reappears in ResolvedModule's shape.
  it("carries no function-valued property, so it is safe to pass to a Client Component", () => {
    for (const m of resolveModules({ quiz: { title: "Trivia" } })) {
      expect(m).not.toHaveProperty("home");
      for (const [key, value] of Object.entries(m)) {
        expect(typeof value, `resolved module ${m.id} exposes a function at .${key}`).not.toBe("function");
      }
    }
  });

  it("keeps `home` off ResolvedModule's type as well as its value", () => {
    // Fails to COMPILE (not just to run) if `home` — or any other key whose
    // value type includes a function — is ever added back to ResolvedModule.
    type FunctionValuedKeys = {
      [K in keyof ResolvedModule]-?: NonNullable<ResolvedModule[K]> extends (...args: never[]) => unknown
        ? K
        : never;
    }[keyof ResolvedModule];
    const noFunctionValuedKeys: FunctionValuedKeys extends never ? true : false = true;
    const homeIsOmitted: "home" extends keyof ResolvedModule ? false : true = true;
    expect([noFunctionValuedKeys, homeIsOmitted]).toEqual([true, true]);
  });
});
