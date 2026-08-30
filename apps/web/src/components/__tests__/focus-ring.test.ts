// One focus colour, everywhere — DESIGN.md's "Enhancements over stock-original".
//
// Every text input in the app used to opt out of it: `focus-visible:outline-none`
// with a 1px amber border tint standing in for the ring. That is a far weaker
// indicator than the 2px offset ring every button shows, it made the documented
// rule untrue in the 34 places it mattered most (every form field an organizer
// or contestant types into), and it spread by copy-paste — each new field was
// pasted from the last one.
//
// So this asserts the absence rather than the presence: a presence test passes
// as soon as ONE field has a ring, which is exactly the state the app was
// already in. The copy-paste is the failure mode, so the test has to cover
// every file at once.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("../..", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "__tests__" || name === "node_modules") return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith(".tsx") || name.endsWith(".ts") ? [full] : [];
  });
}

describe("focus rings", () => {
  it("are never suppressed on a Tab-reachable control", () => {
    // `focus-visible:` is by definition the keyboard-reachable case, so any
    // `focus-visible:outline-none` is a control a keyboard user can land on
    // with no ring. The confirm dialog's panel suppresses `focus:outline-none`
    // instead — a different selector, deliberately: that element is a
    // `tabIndex={-1}` programmatic focus target Tab never reaches, and it is
    // commented as such at the call site.
    const offenders = walk(srcDir)
      .filter((f) => readFileSync(f, "utf8").includes("focus-visible:outline-none"))
      .map((f) => f.slice(srcDir.length));
    expect(offenders).toEqual([]);
  });

  it("use the one amber colour rather than a per-component choice", () => {
    // Amber is reserved for pending/attention/focus (DESIGN.md). A ring in the
    // brand blue would read as decoration, and a ring in green or red would
    // collide with the scored/failed meanings the check atom depends on.
    const rings = walk(srcDir).flatMap((f) => [
      ...readFileSync(f, "utf8").matchAll(/focus-visible:outline-\[(#[0-9a-fA-F]{6})\]/g),
    ]);
    expect(rings.length).toBeGreaterThan(0);
    expect([...new Set(rings.map((m) => m[1].toLowerCase()))]).toEqual(["#d4a017"]);
  });
});
