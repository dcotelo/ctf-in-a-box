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
// live pattern to match something in the combined markup. A term that stops
// matching fails here, loudly, instead of quietly weakening the quiz-only
// suites.
//
// The corpus is every page whose quiz-only counterpart asserts absence. It
// started as /how-to-play and /rules alone, which is how the app-name and
// repository vocabulary came to be missing from the list: the pages carrying
// it — the FAQ, the terms, the 404 — were outside both nets at once.
//
// The LATENT patterns are proven against `SECURE_DEV_SPECIMENS` instead; see
// the header note in secure-dev-terms.ts for why they are not required to
// match the shipped render.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  findSecureDevLeaks,
  normalizeHtml,
  SECURE_DEV_LATENT_PATTERNS,
  SECURE_DEV_LIVE_PATTERNS,
  SECURE_DEV_SPECIMENS,
  SECURE_DEV_TERMS,
} from "./secure-dev-terms";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/admin-store", () => ({
  getAdminSettings: async () => ({ moduleOverrides: {} }),
}));

import HowToPlay from "@/app/(site)/how-to-play/page";
import Rules from "@/app/(site)/rules/page";
import Faq from "@/app/(site)/faq/page";
import Terms from "@/app/(site)/terms/page";
import NotFound from "@/app/not-found";

// All of them together: the list is shared, and a term may legitimately live
// on only one page (hint costs are a rules bullet; the worked example's shell
// commands are the guide's; the target names are the 404's route card).
const markup = [
  await HowToPlay().then(renderToStaticMarkup),
  await Rules().then(renderToStaticMarkup),
  renderToStaticMarkup(await Faq()),
  renderToStaticMarkup(await Terms()),
  await NotFound().then(renderToStaticMarkup),
].join("\n");
const normalized = normalizeHtml(markup);

describe("the secure-development term list", () => {
  it.each(SECURE_DEV_TERMS)(
    "%j matches the secure-development render, so asserting its absence means something",
    (term) => {
      expect(normalized).toContain(term);
    },
  );

  it.each(SECURE_DEV_LIVE_PATTERNS)(
    "%s matches the secure-development render, so asserting its absence means something",
    (pattern) => {
      expect(markup).toMatch(pattern);
    },
  );

  it.each(SECURE_DEV_LATENT_PATTERNS)(
    "%s fires on copy it names, so asserting its absence means something",
    (pattern) => {
      expect(SECURE_DEV_SPECIMENS.some((s) => pattern.test(s))).toBe(true);
    },
  );

  // The mutation that motivated the latent half. Every one of its words is
  // secure-development vocabulary and none of them were in the list.
  it("catches the whole of a sentence written in the workflow's own words", () => {
    expect(findSecureDevLeaks(SECURE_DEV_SPECIMENS[0]).length).toBeGreaterThan(4);
    for (const specimen of SECURE_DEV_SPECIMENS) {
      expect(findSecureDevLeaks(specimen)).not.toEqual([]);
    }
  });

  // The `target` pattern is the one with a deliberate exclusion in it, and
  // the exclusion is what makes the term usable at all. Pin both halves:
  // prose about targets is caught, the `target="_blank"` on every external
  // link is not.
  it("catches prose about targets without firing on target= attributes", () => {
    const [targets] = SECURE_DEV_LIVE_PATTERNS.filter((p) => p.source.includes("target"));
    expect("Browse the targets, then point your AI agent at a target.").toMatch(targets);
    expect('<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>').not.toMatch(
      targets,
    );
  });

  // Same shape, for the two narrowings added with the app names: "repo" must
  // not fire on "Report", and "commit" must not fire on the platform's own
  // "what taking part commits you to".
  it("catches the bare nouns without firing on the words that contain them", () => {
    const [repo] = SECURE_DEV_LIVE_PATTERNS.filter((p) => p.source.startsWith("\\brepos"));
    expect("Fork the repo and open a PR.").toMatch(repo);
    expect("Report it to an organizer instead of exploiting it.").not.toMatch(repo);

    const [commit] = SECURE_DEV_LIVE_PATTERNS.filter((p) => p.source.startsWith("\\bcommits"));
    expect("Write the commit message like a real security fix.").toMatch(commit);
    expect("What taking part in this competition commits you to.").not.toMatch(commit);
  });
});
