// The secure-development vocabulary, enumerated once and asserted ABSENT by
// every "this event doesn't run that module" page suite.
//
// This list is the load-bearing part of those tests, and it has to be
// deliberately exhaustive rather than illustrative. The landing page's
// equivalent check originally covered "pull request", "fork" and
// "Browse targets" but NOT "patched" — and "patched" was the one string that
// had actually leaked (a progress card promising a "patched and non-patched
// count per app" on an event with nothing to patch). The hole sat exactly
// where the bug was.
//
// The rule, learned the hard way three times on this work: when a term
// threatens a false positive, NARROW the match — never drop the term. A
// dropped term is a silent hole in the shape of the thing it named. "target"
// was dropped once here on the grounds that `target="_blank"` made it
// unusable, and a mutation putting *"Browse the targets, then point your AI
// agent at a target"* into the platform frame sailed through the whole
// suite. It is a bounded pattern now, not an omission.
//
// Narrowing in force:
//   - "repo" matches "Report it to an organizer" — replaced by "gh repo" and
//     "repo's", both of which name an actual repository.
//   - "target" matches every `target="_blank"` attribute — a word-boundary
//     pattern with a `(?!=)` lookahead keeps the prose and drops the
//     attribute.
//   - "flag" matches the quiz's own "There are no flags to submit" — only the
//     secure-development phrase "flag hunting" is listed.
//   - "PR" and "CI" match inside ordinary words, so they are word-boundary
//     regexes too.
//
// Every entry below is proven live by secure-dev-terms.test.ts, which renders
// the pages that ARE supposed to carry this vocabulary and asserts each term
// and pattern matches something. A term that rots into decoration — as
// "repository" and the unescaped "repo's" both silently had — fails there.

/** Rendered markup, entity-decoded and lowercased: what the substring terms
 *  below are matched against. Decoding matters — React escapes apostrophes,
 *  so "repo's" only ever appears in the HTML as `repo&#x27;s`, and a raw
 *  substring check for it can never fire. */
export function normalizeHtml(html: string): string {
  return html
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .toLowerCase();
}

/** Matched as substrings against `normalizeHtml(markup)`. */
export const SECURE_DEV_TERMS = [
  "pull request",
  "fork",
  "patch",
  "regression",
  "vulnerab",
  "secure development",
  "flag hunting",
  "sql injection",
  "juice",
  "gh repo",
  "repo's",
  "git commit",
  "git checkout",
  "branch",
  "github action",
  "scorer",
  "challenge",
  "hint",
  "top 10",
  "secure agent playbook",
  "please use ai",
  "owasp-ctf/",
  "/challenges",
];

/** Terms that need word boundaries: a bare substring check fires on ordinary
 *  words ("PR" inside a word, "repo" inside "Report") or on markup
 *  (`target="_blank"` on every external link). Matched against the RAW
 *  markup, case-insensitively. */
export const SECURE_DEV_PATTERNS = [
  /\bPRs?\b/,
  /\bCI\b/,
  // Prose about targets — "browse the targets", "point it at a target" —
  // without the `target="..."` attribute that made this term look unusable.
  /\btargets?\b(?!=)/i,
];

/** Every secure-development term the given markup leaks, as a list so a
 *  failure names all of them at once instead of one per run. */
export function findSecureDevLeaks(html: string): string[] {
  const normalized = normalizeHtml(html);
  return [
    ...SECURE_DEV_TERMS.filter((term) => normalized.includes(term)),
    ...SECURE_DEV_PATTERNS.filter((pattern) => pattern.test(html)).map(String),
  ];
}
