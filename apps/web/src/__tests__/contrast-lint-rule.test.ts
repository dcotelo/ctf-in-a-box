// Fixtures for the contrast lint rule in eslint.config.mjs.
//
// The rule is the only thing standing between DESIGN_SYSTEM.md's ban on
// zinc-500 for text and the 14 occurrences that accumulated while the ban was
// documented and unenforced (issue #317). A guard nobody tests is a guard that
// silently stops matching, and the first draft of this one had three holes:
//
//   - `not-disabled:text-zinc-500` slipped through a `(?<!disabled:)`
//     lookbehind, because the string ends with `disabled:` — while the variant
//     itself applies to controls that are very much ACTIVE.
//   - `text-[#8f8f9b]/[60%]`, Tailwind v4's bracketed opacity spelling, was
//     missed by a pattern that only knew `/60`.
//   - Class names written in a template literal's static text were missed
//     entirely: the selector only inspected `Literal`, not `TemplateElement`.
//
// So each case is pinned here rather than trusted. The config is loaded as the
// app actually uses it, so a change that breaks a pattern fails this file.
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Lints one snippet through the app's real eslint config and returns the
 *  contrast-rule messages it produced. */
async function contrastErrors(code: string): Promise<string[]> {
  const eslint = new ESLint({
    cwd: appRoot,
    overrideConfigFile: join(appRoot, "eslint.config.mjs"),
  });
  const [result] = await eslint.lintText(code, { filePath: join(appRoot, "src", "fixture.tsx") });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === "no-restricted-syntax")
    .map((m) => m.message);
}

describe("the banned-contrast-token lint rule", () => {
  it("allows the exact disabled: variant — WCAG 1.4.3 exempts inactive controls", async () => {
    expect(await contrastErrors('export const x = "disabled:text-zinc-500";')).toEqual([]);
  });

  it("still rejects not-disabled:, which applies to ACTIVE controls", async () => {
    // The hole a `(?<!disabled:)` lookbehind leaves open.
    const errors = await contrastErrors('export const x = "not-disabled:text-zinc-500";');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("fails WCAG AA");
  });

  it("rejects the bare token", async () => {
    expect(await contrastErrors('export const x = "text-zinc-500";')).toHaveLength(1);
  });

  it("rejects it inside a template literal's static text", async () => {
    // A `Literal` selector alone never sees this.
    expect(await contrastErrors("export const x = `flex text-zinc-500 ${y}`;")).toHaveLength(1);
  });

  it("rejects both opacity spellings of the faded muted token", async () => {
    expect(await contrastErrors('export const x = "text-[#8f8f9b]/60";')).toHaveLength(1);
    expect(await contrastErrors('export const x = "text-[#8f8f9b]/[60%]";')).toHaveLength(1);
  });

  it("leaves the replacement tokens alone", async () => {
    expect(await contrastErrors('export const x = "text-muted text-zinc-400 text-[#8f8f9b]";')).toEqual([]);
  });
});
