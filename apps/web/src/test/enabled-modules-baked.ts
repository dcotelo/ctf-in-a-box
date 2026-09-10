/**
 * Test double for `@/lib/enabled-modules` — resolves every module question the
 * way the file's OWN fixture already answers it, so a test keeps one source of
 * truth for "which modules does this event run".
 *
 * Why a double is needed at all: the real resolver calls `connection()` to keep
 * itself out of Next's build-time prerender, and `connection()` throws outside
 * a request scope. A unit test calling the leaderboard fold or a page function
 * directly has no request scope, so the real module cannot run there.
 *
 * Why it reads through `@/lib/modules` or `@/lib/event-config` rather than
 * taking a set: the fixtures express enablement two different ways — most
 * mock `@/lib/event-config` and declare `modules: [...]` directly, while a few
 * mock `@/lib/modules` itself and stub `isModuleEnabled`. Delegating to
 * whichever is present means neither has to be rewritten, and neither can
 * drift from the enablement the rest of the file assumes. `bakedModuleIds` no
 * longer exists on `@/lib/modules` (issue #386 removed the baked set), so this
 * now reads the fixture's `@/lib/event-config` module list directly instead of
 * a derived registry export.
 *
 * A test that wants a RUNTIME set DIFFERENT from the baked one must not use
 * this — mock `@/lib/enabled-modules` inline with the set it wants, which is
 * what the runtime-enablement tests do. This double exists to preserve
 * pre-#175 behaviour in tests that predate runtime enablement, not to model it.
 */
import * as modules from "@/lib/modules";
import * as eventConfigModule from "@/lib/event-config";
import type { ModuleId } from "@/lib/modules";

// Restated rather than imported: a file that mocks `@/lib/modules` may not
// export ALL_MODULE_IDS either, and this list only has to be complete enough
// to filter through the fixture's own `isModuleEnabled`. `modules.test.ts`
// pins the real vocabulary.
const KNOWN: readonly ModuleId[] = ["secure-development", "quiz", "classic", "ai"];

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
  // `isModuleEnabled` FIRST, and the order is load-bearing. A fixture that
  // stubs it is stating the enablement it wants tested, and that stub has to
  // win; a fixture that only mocks `@/lib/event-config` gets no `isModuleEnabled`
  // stub at all, so this branch is right in both cases. Reading the
  // event-config module list first would get the second case right and
  // silently ignore the first, which reads as a page not 404ing when the
  // test just said its module was disabled.
  const isEnabled = tryRead<(id: ModuleId) => boolean>(modules, "isModuleEnabled");
  if (typeof isEnabled === "function") return KNOWN.filter((id) => isEnabled(id));
  const declaredConfig = tryRead<{ modules?: readonly { id: ModuleId }[] }>(eventConfigModule, "eventConfig");
  const declared = declaredConfig?.modules;
  if (Array.isArray(declared)) return declared.map((m) => m.id);
  return [...KNOWN];
}

export const defaultModuleIds: readonly ModuleId[] = KNOWN;

export async function getEnabledModuleIds(): Promise<ReadonlySet<ModuleId>> {
  return new Set(bakedIds());
}

export async function isModuleLive(id: ModuleId): Promise<boolean> {
  return bakedIds().includes(id);
}
