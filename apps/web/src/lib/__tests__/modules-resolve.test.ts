// resolveModules regression gate, on a two-module fixture.
import { describe, expect, it } from "vitest";

import { resolveModules, type ModuleId, type ResolvedModule } from "@/lib/modules";

// `resolveModules`'s live set is a required, no-fallback argument (issue
// #386) — this is the fixture's two enabled modules.
const ENABLED = new Set<ModuleId>(["secure-development", "quiz"]);

describe("resolveModules", () => {
  it("falls back to registry defaults when there are no overrides", () => {
    const resolved = resolveModules({}, ENABLED);
    const quiz = resolved.find((m) => m.id === "quiz");
    expect(quiz?.title).toBe("Quiz");
    expect(quiz?.blurb).toBe("Answer security questions for points.");
  });

  it("applies a title override", () => {
    const resolved = resolveModules({ quiz: { title: "Round 1: Fundamentals" } }, ENABLED);
    expect(resolved.find((m) => m.id === "quiz")?.title).toBe("Round 1: Fundamentals");
  });

  it("applies a blurb override independently of the title", () => {
    const resolved = resolveModules({ quiz: { blurb: "Ten questions, five minutes." } }, ENABLED);
    const quiz = resolved.find((m) => m.id === "quiz");
    expect(quiz?.title).toBe("Quiz");
    expect(quiz?.blurb).toBe("Ten questions, five minutes.");
  });

  it("ignores an override for a module that is not enabled", () => {
    const resolved = resolveModules({ "not-a-module": { title: "Nope" } } as never, ENABLED);
    expect(resolved.some((m) => m.title === "Nope")).toBe(false);
  });

  it("treats an empty-string override as absent", () => {
    const resolved = resolveModules({ quiz: { title: "" } }, ENABLED);
    expect(resolved.find((m) => m.id === "quiz")?.title).toBe("Quiz");
  });

  // `title` can't answer "did the organizer rename this?" — it always has a
  // value. Surfaces whose own default is deliberately NOT the module's name
  // (the nav label, /challenges' page title) key off `titleOverride`, so
  // "unset" has to be distinguishable from "set to the registry default".
  it("reports no titleOverride when the organizer has set none", () => {
    const resolved = resolveModules({ quiz: { blurb: "Ten questions." } }, ENABLED);
    const quiz = resolved.find((m) => m.id === "quiz");
    expect(quiz?.titleOverride).toBeUndefined();
    expect(quiz?.title).toBe("Quiz");
  });

  it("reports the trimmed override as titleOverride when one is set", () => {
    const resolved = resolveModules({ quiz: { title: "  Round 1  " } }, ENABLED);
    const quiz = resolved.find((m) => m.id === "quiz");
    expect(quiz?.titleOverride).toBe("Round 1");
    expect(quiz?.title).toBe("Round 1");
  });

  it("reports no titleOverride for a whitespace-only override", () => {
    expect(resolveModules({ quiz: { title: "   " } }, ENABLED).find((m) => m.id === "quiz")?.titleOverride)
      .toBeUndefined();
  });

  it("preserves registry order and the nav entry", () => {
    const resolved = resolveModules({ quiz: { title: "Trivia" } }, ENABLED);
    expect(resolved.map((m) => m.id)).toEqual(["secure-development", "quiz"]);
    expect(resolved.find((m) => m.id === "quiz")?.nav?.href).toBe("/quiz");
  });

  it("treats a whitespace-only override as absent", () => {
    const resolved = resolveModules({ quiz: { title: "   ", blurb: "\t" } }, ENABLED);
    const quiz = resolved.find((m) => m.id === "quiz");
    expect(quiz?.title).toBe("Quiz");
    expect(quiz?.blurb).toBe("Answer security questions for points.");
  });

  // The registry defaults must not survive onto a resolved module: consumers
  // render `title`, and leaving `displayName` reachable made "read the wrong
  // property and silently ignore the organizer's override" a mistake no type
  // check could catch.
  it("drops the registry default fields from the resolved object", () => {
    const resolved = resolveModules({ quiz: { title: "Trivia" } }, ENABLED);
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
  // DEEP — a function nested inside an object property (`home.intro`,
  // `guide.steps`) breaks the boundary exactly as a top-level one does, and
  // every copy block this registry has is shaped that way — and it bites the
  // moment a module defines one if the strip is ever removed; the
  // compile-time check bites today, the moment such a field reappears in
  // ResolvedModule's shape.
  it("carries no function-valued property, so it is safe to pass to a Client Component", () => {
    const findFunctions = (value: unknown, path: string): string[] => {
      if (typeof value === "function") return [path];
      if (Array.isArray(value)) return value.flatMap((v, i) => findFunctions(v, `${path}[${i}]`));
      if (value && typeof value === "object") {
        return Object.entries(value).flatMap(([k, v]) => findFunctions(v, `${path}.${k}`));
      }
      return [];
    };
    for (const m of resolveModules({ quiz: { title: "Trivia" } }, ENABLED)) {
      for (const stripped of ["home", "guide", "rules", "faq", "terms", "routeCard", "setup"]) {
        expect(m).not.toHaveProperty(stripped);
      }
      expect(findFunctions(m, `resolved module ${m.id}`)).toEqual([]);
    }
  });

  it("keeps the copy blocks off ResolvedModule's type as well as its value", () => {
    // Fails to COMPILE (not just to run) if `home`/`guide`/`rules` — or any
    // other key whose value type includes a function — is ever added back to
    // ResolvedModule.
    type FunctionValuedKeys = {
      [K in keyof ResolvedModule]-?: NonNullable<ResolvedModule[K]> extends (...args: never[]) => unknown
        ? K
        : never;
    }[keyof ResolvedModule];
    const noFunctionValuedKeys: FunctionValuedKeys extends never ? true : false = true;
    const homeIsOmitted: "home" extends keyof ResolvedModule ? false : true = true;
    const guideIsOmitted: "guide" extends keyof ResolvedModule ? false : true = true;
    const rulesIsOmitted: "rules" extends keyof ResolvedModule ? false : true = true;
    const faqIsOmitted: "faq" extends keyof ResolvedModule ? false : true = true;
    const termsIsOmitted: "terms" extends keyof ResolvedModule ? false : true = true;
    const routeCardIsOmitted: "routeCard" extends keyof ResolvedModule ? false : true = true;
    const setupIsOmitted: "setup" extends keyof ResolvedModule ? false : true = true;
    expect([
      noFunctionValuedKeys,
      homeIsOmitted,
      guideIsOmitted,
      rulesIsOmitted,
      faqIsOmitted,
      termsIsOmitted,
      routeCardIsOmitted,
      setupIsOmitted,
    ]).toEqual([true, true, true, true, true, true, true, true]);
  });
});

// Runtime enablement (issue #175); `enabled` is now a required, no-fallback
// argument (issue #386 — there is no more baked set to omit it in favour of).
describe("resolveModules with a live module set", () => {
  it("filters to the live set", () => {
    expect(resolveModules({}, new Set(["quiz"])).map((m) => m.id)).toEqual(["quiz"]);
  });

  it("resolves a module the baked config never mentioned", () => {
    // classic is not in this fixture's event.yaml, so there is no config entry
    // to build a def from — the registry has to supply one. Without this a
    // runtime-enabled module resolves to nothing and renders blank.
    const resolved = resolveModules({}, new Set(["classic"]));
    expect(resolved.map((m) => m.id)).toEqual(["classic"]);
    expect(resolved[0].title).toBeTruthy();
  });

  it("orders the result by the registry, regardless of the set's own order", () => {
    // There is no more baked-first-then-appended ordering (issue #386):
    // `moduleDefsFor` filters `ALL_MODULE_IDS` in registry order, so the
    // result's order never depends on the Set's iteration order or on
    // event.yaml.
    const ids = resolveModules({}, new Set(["classic", "quiz", "secure-development"])).map((m) => m.id);
    expect(ids).toEqual(["secure-development", "quiz", "classic"]);
  });

  it("applies title overrides to a runtime-enabled module too", () => {
    const resolved = resolveModules({ classic: { title: "Flag Hunt" } }, new Set(["classic"]));
    expect(resolved[0].title).toBe("Flag Hunt");
  });

  it("resolves an empty live set to no modules", () => {
    // The resolver itself does NOT second-guess an empty set — refusing to
    // disable the last module is the admin route's job, where it can report a
    // reason. Everything upstream of here has already fallen back to the
    // default rather than handing this an empty set by accident.
    expect(resolveModules({}, new Set())).toEqual([]);
  });
});
