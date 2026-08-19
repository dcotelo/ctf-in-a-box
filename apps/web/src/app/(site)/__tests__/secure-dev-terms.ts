// The secure-development vocabulary, enumerated once and asserted ABSENT by
// every "this event doesn't run that module" page suite.
//
// This list is the load-bearing part of those tests, and it has to be
// deliberately exhaustive rather than illustrative. The landing page's
// equivalent check originally covered "pull request", "fork" and
// "Browse targets" but NOT "patched" — and "patched" was the one string that
// had actually leaked (a progress card promising a "patched and non-patched
// count per app" on an event with nothing to patch). The hole sat exactly
// where the bug was. So: add to this list rather than trimming it, and when a
// term threatens a false positive, NARROW the match instead of dropping the
// term.
//
// Narrowing already done here, for terms that do have innocent substrings:
//   - "repo" matches "Report it to an organizer" — replaced by "gh repo",
//     "repository" and "repo's", which don't.
//   - "target" matches every `target="_blank"` attribute — dropped in favour
//     of "fork", "juice" and the scope wording, which cover the same copy.
//   - "flag" matches the quiz's own "There are no flags to submit" — only the
//     secure-development phrase "flag hunting" is listed.
//   - "PR" and "CI" match inside ordinary words, so they are word-boundary
//     REGEXES below rather than substrings.

/** Matched case-insensitively, as substrings, against the rendered HTML. */
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
  "repository",
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

/** Acronyms that need word boundaries: a bare "PR"/"CI" substring check
 *  fires on ordinary words and on markup. */
export const SECURE_DEV_PATTERNS = [/\bPRs?\b/, /\bCI\b/];

/** Every secure-development term the given markup leaks, as a list so a
 *  failure names all of them at once instead of one per run. */
export function findSecureDevLeaks(html: string): string[] {
  const lower = html.toLowerCase();
  return [
    ...SECURE_DEV_TERMS.filter((term) => lower.includes(term)),
    ...SECURE_DEV_PATTERNS.filter((pattern) => pattern.test(html)).map(String),
  ];
}
