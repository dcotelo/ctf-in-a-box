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
    // `disabled:text-zinc-500` is allowed through: WCAG 1.4.3 exempts
    // inactive controls, and dimming a disabled control is how it reads as
    // disabled. Fading the muted token instead (`text-[#8f8f9b]/60`) is
    // banned too — that composited to 2.86:1, worse than the token this rule
    // exists to keep out (issue #316).
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/(?<!disabled:)\\btext-zinc-500\\b/]",
          message:
            "text-zinc-500 is 3.5-3.8:1 and fails WCAG AA for text (DESIGN_SYSTEM.md). Use text-muted. Only `disabled:text-zinc-500` is allowed.",
        },
        {
          selector: "Literal[value=/text-\\[#8f8f9b\\]\\/[0-9]/]",
          message:
            "Fading --text-muted lands under 4.5:1 (issue #316). Use a token from the ladder instead: text-zinc-400 or text-muted.",
        },
      ],
    },
  },
]);

export default eslintConfig;
