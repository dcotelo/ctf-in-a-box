// The `/admin` route entry points must not import a "use client" module.
//
// This is a source-level test on purpose. `renderToStaticMarkup(await Page())`
// — how every other page test here runs — has no RSC boundary, so a Server
// Component calling a function exported from a "use client" module passes in
// vitest, passes `next build`, and then throws on the first real request:
//
//   Error: Attempted to call resolveAdminTab() from the server but
//   resolveAdminTab is on the client.
//
// That shipped: #297 moved `resolveAdminTab` into admin-controls.tsx (a
// Client Component) while both route files kept calling it, and every gate in
// CI stayed green while /admin, /admin/<tab> and /admin?tab= all 500'd in
// production.
//
// The rule asserted here is narrow and true of these two files: they compose
// the panel out of `admin-panel.tsx` and resolve the tab from `tab-url.ts`,
// both server modules. Neither has any reason to reach across the boundary —
// a Client Component belongs *inside* AdminPanel, rendered as JSX, not
// imported by the route.

import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `src/`, from this test's own location. */
const SRC = fileURLToPath(new URL("../../../../", import.meta.url));

/** The two route files that render the admin panel. */
const ROUTES = ["app/(site)/admin/page.tsx", "app/(site)/admin/[tab]/page.tsx"];

/** Every module specifier this file imports from, static imports only. */
function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
}

/** Read a path only if it is a regular file; `existsSync` alone also matches
 *  a directory, and reading one throws EISDIR. */
function readIfFile(path: string): string | null {
  try {
    return statSync(path).isFile() ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

/** Resolve a project-local specifier to a file on disk, or null for a package
 *  import (`react`, `next`) that cannot carry a "use client" of ours. */
function resolveLocal(specifier: string, importerAbs: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(importerAbs), specifier);
  else return null;

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (readIfFile(candidate) !== null) return candidate;
  }
  return null;
}

/** Does this module open with the "use client" directive? Only a leading
 *  directive counts — the string appears in prose comments all over this
 *  tree, and matching those would fail the test for the wrong reason. */
function isClientModule(source: string): boolean {
  const firstCode = source
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("//"));
  return firstCode === '"use client";' || firstCode === "'use client';";
}

describe("the /admin routes stay on the server side of the client boundary", () => {
  it.each(ROUTES)('%s imports no "use client" module', (route) => {
    const abs = join(SRC, route);
    const source = readFileSync(abs, "utf8");
    const offenders = importSpecifiers(source)
      .map((spec) => ({ spec, source: resolveLocal(spec, abs) }))
      .filter(({ source: file }) => file !== null && isClientModule(readFileSync(file, "utf8")))
      .map(({ spec }) => spec);

    expect(
      offenders,
      `${route} imports from a "use client" module. A Server Component may RENDER a Client ` +
        "Component, but calling a function it exports throws at request time while every " +
        "test and the production build stay green. Move the shared helper to a module " +
        "without the directive (see tab-url.ts).",
    ).toEqual([]);
  });

  it("tab-url.ts — which both routes call into — is not a client module", () => {
    const source = readFileSync(join(SRC, "app/(site)/admin/tab-url.ts"), "utf8");
    expect(isClientModule(source)).toBe(false);
  });

  it("resolves specifiers for real, so the assertion above cannot pass vacuously", () => {
    const abs = join(SRC, "app/(site)/admin/page.tsx");
    const specs = importSpecifiers(readFileSync(abs, "utf8"));
    // The route does import local modules, and they do resolve to files.
    const local = specs.map((s) => resolveLocal(s, abs)).filter((f): f is string => f !== null);
    expect(local.length).toBeGreaterThan(0);
    // And the resolver really can see a client module when one is there.
    const controls = resolveLocal("@/app/(site)/admin/admin-controls", abs);
    expect(controls).not.toBeNull();
    expect(isClientModule(readFileSync(controls as string, "utf8"))).toBe(true);
  });
});
