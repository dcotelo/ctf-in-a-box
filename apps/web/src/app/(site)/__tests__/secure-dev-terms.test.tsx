// The term list checks itself here.
//
// `secure-dev-terms.ts` is only worth anything if every entry in it actually
// names copy that exists. A term that matches nothing is not a safety net,
// it is decoration — and it fails silently, since the suites that use the
// list only ever assert ABSENCE, which a dead term satisfies trivially. Two
// had already rotted this way: `repository` names nothing on either page, and
// `repo's` could never fire because React escapes the apostrophe to
// `&#x27;`. An aggregate "more than half of them match" check did not notice
// either.
//
// So: render the pages that ARE supposed to carry the secure-development
// vocabulary, on the shipped event config, and require EVERY term and EVERY
// pattern to match something in the combined markup. A term that stops
// matching fails here, loudly, instead of quietly weakening the quiz-only
// suites.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  normalizeHtml,
  SECURE_DEV_PATTERNS,
  SECURE_DEV_TERMS,
} from "./secure-dev-terms";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/admin-store", () => ({
  getAdminSettings: async () => ({ moduleOverrides: {} }),
}));

import HowToPlay from "@/app/(site)/how-to-play/page";
import Rules from "@/app/(site)/rules/page";

// Both pages together: the list is shared between them, and a term may
// legitimately live on only one (hint costs are a rules bullet; the worked
// example's shell commands are the guide's).
const markup = [
  await HowToPlay().then(renderToStaticMarkup),
  await Rules().then(renderToStaticMarkup),
].join("\n");
const normalized = normalizeHtml(markup);

describe("the secure-development term list", () => {
  it.each(SECURE_DEV_TERMS)(
    "%j matches the secure-development render, so asserting its absence means something",
    (term) => {
      expect(normalized).toContain(term);
    },
  );

  it.each(SECURE_DEV_PATTERNS)(
    "%s matches the secure-development render, so asserting its absence means something",
    (pattern) => {
      expect(markup).toMatch(pattern);
    },
  );

  // The `target` pattern is the one with a deliberate exclusion in it, and
  // the exclusion is what makes the term usable at all. Pin both halves:
  // prose about targets is caught, the `target="_blank"` on every external
  // link is not.
  it("catches prose about targets without firing on target= attributes", () => {
    const [targets] = SECURE_DEV_PATTERNS.filter((p) => p.source.includes("target"));
    expect("Browse the targets, then point your AI agent at a target.").toMatch(targets);
    expect('<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>').not.toMatch(
      targets,
    );
  });
});
