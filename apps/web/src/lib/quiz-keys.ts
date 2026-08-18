// Shared `ctf:quiz:*` Redis key names/builders and the answer-key
// canonicalization recipe. Deliberately its OWN dependency-free module (no
// imports, nothing that could import admin-store.ts or quiz-store.ts back):
// quiz-store.ts already imports admin-store.ts (for getAdminSettings/
// effectivePaused), so admin-store.ts importing quiz-store.ts's key
// constants would be a require cycle. Putting the keys here instead of
// duplicating them in both files makes the two ways of writing a quiz key
// structurally incapable of drifting apart — see AGENTS.md's "three readers
// must change in lockstep" rule, born from exactly this failure mode
// elsewhere in the kit.

export const QUIZ_QUESTIONS_KEY = "ctf:quiz:questions";
export const QUIZ_KEY_KEY = "ctf:quiz:key";
export const QUIZ_POINTS_KEY = "ctf:quiz:points";
export const QUIZ_ANSWERED_KEY = "ctf:quiz:answered";
export const QUIZ_ANSWERS_PREFIX = "ctf:quiz:answers:";
export const QUIZ_ATTEMPTS_PREFIX = "ctf:quiz:attempts:";

export const quizAnswersKey = (login: string) => `${QUIZ_ANSWERS_PREFIX}${login}`;
export const quizAttemptsKey = (login: string) => `${QUIZ_ATTEMPTS_PREFIX}${login}`;

/** Canonicalizes a set of choice ids into the sorted, deduped array
 *  quiz-store stores (JSON-stringified) as `ctf:quiz:key`'s correct-answer
 *  set, and that a submission must match byte-for-byte after the same
 *  treatment. The single source of truth for this recipe — used by
 *  quiz-store's `upsertQuestion` (authoring) and `answerQuestion`
 *  (grading), and by admin-store's demo seed, so all three can never
 *  silently disagree about what "the stored key format" means. */
export function canonicalizeChoices(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}
