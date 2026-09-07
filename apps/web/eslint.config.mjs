import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // DESIGN_SYSTEM.md bans zinc-500 for text: it is 3.5-3.8:1 on this app's
    // grounds, under the WCAG AA 4.5:1 floor for body-size text. The ban was
    // documented and nothing enforced it, so 14 of them accumulated across
    // contestant and admin surfaces (issue #317). `--text-muted` is the
    // replacement step, 5.3-5.8:1 on the same grounds.
    //
    // Matched as whole CLASS TOKENS, and in template quasis as well as plain
    // string literals — a class name is as likely to be written inside a
    // `${...}` template as in a quoted string in this codebase.
    //
    // The exemption is the EXACT `disabled:` variant and nothing else: WCAG
    // 1.4.3 exempts inactive controls, and dimming a disabled control is how it
    // reads as disabled. A naive `(?<!disabled:)` lookbehind would also exempt
    // Tailwind v4's `not-disabled:`, which applies to controls that are very
    // much active — so the variant chain is matched from its start instead.
    //
    // Fading the muted token is banned too, in both opacity spellings
    // (`/60` and `/[60%]`): `text-[#8f8f9b]/60` composited to 2.86:1, worse
    // than the token this rule exists to keep out (issue #316).
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...[
          {
            // (?<![\w:-])  token start, and NOT immediately after a variant
            //              colon, so the exempt class can't be re-matched at
            //              its own `text-` segment
            // (?!disabled:text-zinc-500…) the ONE exempt class, in full. Not
            //              `(?!disabled:)`, which would also exempt
            //              `not-disabled:` (an ACTIVE control) and
            //              `disabled:hover:` (a chain this contract does not
            //              cover) — both flagged now
            // (?:[\w-]+:)* any other variant chain
            pattern: "(?<![\\w:-])(?!disabled:text-zinc-500(?![\\w-]))(?:[\\w-]+:)*text-zinc-500(?![\\w-])",
            message:
              "text-zinc-500 is 3.5-3.8:1 and fails WCAG AA for text (DESIGN_SYSTEM.md). Use text-muted. Only the exact `disabled:text-zinc-500` is allowed.",
          },
          {
            pattern: "(?<![\\w:-])(?:[\\w-]+:)*text-\\[#8f8f9b\\]\\/(?:\\[[^\\]]*\\]|[\\d.]+)",
            message:
              "Fading --text-muted lands under 4.5:1 (issue #316). Use a token from the ladder instead: text-zinc-400 or text-muted.",
          },
        ].flatMap(({ pattern, message }) => [
          { selector: `Literal[value=/${pattern}/]`, message },
          { selector: `TemplateElement[value.raw=/${pattern}/]`, message },
        ]),
      ],
    },
  },
  {
    // The rule's own fixtures quote the banned tokens as DATA — that is the
    // point of them. Linting them would make a working rule report itself.
    files: ["src/__tests__/contrast-lint-rule.test.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
]);

export default eslintConfig;
