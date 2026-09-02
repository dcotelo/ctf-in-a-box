// HintRevealButton (hint-reveal-button.tsx) is the single challenge page's paid-hint
// control, shared by classic (flags/[id]) and ai (ai/[id]) — generalized from
// the classic-only `ClassicHint` by replacing its hardcoded `app: "classic"`
// reveal-request field with the caller's `app` prop (Task 2, issue #211).
//
// SOURCE-level assertions, same reasoning as focus-management.test.ts: the
// component is a "use client" control whose click handler fires a `fetch` —
// this repo renders with `renderToStaticMarkup` and has no DOM/testing-library
// environment (team-card.test.tsx's standing decision), so there is no click
// to dispatch and nothing in the static markup that reveals the POST body.
// What IS checkable, and what actually regresses if this component reverts to
// a single hardcoded target, is the source of the request itself.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../hint-reveal-button.tsx", import.meta.url)), "utf8");

describe("HintRevealButton posts the target app in its reveal request", () => {
  it("builds the POST body from the app prop", () => {
    expect(src).toMatch(/body:\s*JSON\.stringify\(\{\s*app,\s*id\s*\}\)/);
  });

  it.each(["classic", "ai"] as const)('never hardcodes app: "%s"', (app) => {
    expect(src).not.toMatch(new RegExp(`app:\\s*"${app}"`));
  });
});
