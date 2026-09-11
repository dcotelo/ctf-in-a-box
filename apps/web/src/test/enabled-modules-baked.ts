/**
 * Test double for `@/lib/enabled-modules` — resolves every module question the
 * way a fixture's `@/lib/modules` mock (if any) already answers it, so a test
 * keeps one source of truth for "which modules does this event run".
 *
 * Why a double is needed at all: the real resolver calls `connection()` to keep
 * itself out of Next's build-time prerender, and `connection()` throws outside
 * a request scope. A unit test calling the leaderboard fold or a page function
 * directly has no request scope, so the real module cannot run there.
 *
 * Why it reads through `@/lib/modules` rather than taking a set directly: a
 * fixture that wants a NON-default module set stubs `isModuleEnabled` there —
 * `@/lib/modules` has no such export in production (`bakedModuleIds` and
 * `isModuleEnabled` both died with the event.yaml bake, issue #386), so this
 * only ever sees it on a file that mocked `@/lib/modules` itself, typically
 * via `importOriginal` so the rest of the real registry survives. A fixture
 * that mocks NOTHING here gets the SHIPPED single-module set — see
 * `bakedIds`'s final fallback below for why that, and not "every known
 * module", is the right default.
 *
 * A test that wants a RUNTIME set DIFFERENT from the baked one must not use
 * this — mock `@/lib/enabled-modules` inline with the set it wants, which is
 * what the runtime-enablement tests do. This double exists to preserve
 * pre-#175 behaviour in tests that predate runtime enablement, not to model it.
 */
import * as modules from "@/lib/modules";
import type { ModuleId } from "@/lib/modules";

// Restated rather than imported: a file that mocks `@/lib/modules` may not
// export ALL_MODULE_IDS either, and this list only has to be complete enough
// to filter through the fixture's own `isModuleEnabled`. `modules.test.ts`
// pins the real vocabulary.
const KNOWN: readonly ModuleId[] = ["secure-development", "quiz", "classic", "ai"];

// The double's own "nothing mocked" default — deliberately NOT the same
// thing as `enabled-modules.ts`'s real `defaultEnabledModules(process.env)`
// (secure-development with SCORE_IMAGE set, otherwise nothing). This double
// exists to stand in for the event.yaml bake this repo used to ship (issue
// #386's PR 3A deleted the bake itself, not the fixtures written against
// it): every event this kit had shipped enabled secure-development alone, so
// a fixture that names no set at all gets exactly that one module — never
// "every registered module", which no shipped event has ever run and which
// silently widens a test's live set the moment it stops stubbing
// `isModuleEnabled` (PR 3A review round 1, finding I1).
const SHIPPED_DEFAULT: readonly ModuleId[] = ["secure-development"];

/** Reads an export that the file's mock may not define at all.
 *
 *  Vitest's mock proxy THROWS on a property that the factory did not return —
 *  it does not yield undefined — so probing has to be wrapped rather than
 *  null-checked. Getting this wrong reads as "37 tests fail with a message
 *  about a missing export", which is exactly what it did. */
function tryRead<T>(source: object, name: string): T | undefined {
  try {
    return (source as unknown as Record<string, T>)[name];
  } catch {
    return undefined;
  }
}

function bakedIds(): ModuleId[] {
  // A fixture that stubs `isModuleEnabled` is stating the enablement it wants
  // tested, and that stub wins; a fixture that mocks nothing here gets the
  // SHIPPED single-module set (`SHIPPED_DEFAULT`, see its own comment) — NOT
  // `enabled-modules.ts`'s real "nothing disabled" default, which this double
  // does not model at all (that default is `defaultEnabledModules(process.env)`,
  // driven by `SCORE_IMAGE`, and every runtime-enablement test that cares
  // about it mocks `@/lib/enabled-modules` directly instead of using this
  // double — see the file header).
  const isEnabled = tryRead<(id: ModuleId) => boolean>(modules, "isModuleEnabled");
  if (typeof isEnabled === "function") return KNOWN.filter((id) => isEnabled(id));
  return [...SHIPPED_DEFAULT];
}

export const defaultModuleIds: readonly ModuleId[] = KNOWN;

export async function getEnabledModuleIds(): Promise<ReadonlySet<ModuleId>> {
  return new Set(bakedIds());
}

export async function isModuleLive(id: ModuleId): Promise<boolean> {
  return bakedIds().includes(id);
}

// `getResolvedModules` (in `@/lib/resolved-modules`) reads its settings
// snapshot through THIS function now, not `@/lib/admin-store` directly
// (CodeRabbit round 1 finding A) — so a fixture using this double for
// enablement still needs a working `getAdminSettingsSnapshot` for
// `moduleOverrides` (organizer renames). Delegating to the real
// `getAdminSettings` preserves exactly what `getResolvedModules` used to do
// itself: whatever a consuming test file already mocks (or does not mock,
// and lets fail open) on `@/lib/admin-store` keeps working unchanged.
//
// Imported LAZILY, inside the function body, rather than at the top of this
// file: `@/lib/admin-store` carries `import "server-only"`, which throws
// unconditionally outside Next's RSC bundling (the raw npm package has no
// other guard) unless a test mocks it away — most consumers of this double
// (gate/code-of-conduct/privacy's quiz-only fixtures among them) mock
// NEITHER `server-only` nor `@/lib/admin-store`, because they only ever call
// `isModuleLive`/`getEnabledModuleIds`, never anything that reaches this
// function. A static top-level import would load (and crash on) `server-only`
// for every one of those files whether or not they ever call this; the
// dynamic import here only runs — and only needs a mock — for a fixture that
// actually calls `getAdminSettingsSnapshot`, i.e. one that also exercises
// `@/lib/resolved-modules`.
//
// The `import()` call itself is memoized into `adminStoreImport` at module
// scope, rather than re-invoked inline on every call: two concurrent
// first-ever callers (e.g. a page awaiting `Promise.all([getEnabledApps(),
// getEnabledTotals()])`, both racing to resolve `@/lib/admin-store` for the
// first time) otherwise raced Vitest's module runner — one got the mocked
// module, the other resolved the real, unmocked one (which then throws on
// the missing Upstash env and falls into the `catch` below), so the two
// concurrent reads silently disagreed about the stored settings. Caching the
// promise itself (not just its resolved value) means every caller, racing or
// not, awaits the exact same in-flight import.
let adminStoreImport: Promise<typeof import("@/lib/admin-store")> | undefined;

export async function getAdminSettingsSnapshot() {
  try {
    adminStoreImport ??= import("@/lib/admin-store");
    const { getAdminSettings } = await adminStoreImport;
    return await getAdminSettings();
  } catch {
    return null;
  }
}
