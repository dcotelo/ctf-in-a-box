// The generated-question-id contract. Organizers no longer type an id, so
// this generator is what stands between a prompt and a Redis field name — and
// `upsertQuestion` rejects anything `QUIZ_ID_RE` refuses, so an id it cannot
// emit is a question that cannot be saved.
//
// Imported from quiz-keys.ts (not quiz-store.ts) deliberately: quiz-keys is
// dependency-free and client-safe, which is what lets the admin panel's Client
// Component generate ids against the very same regex the server validates
// with, rather than a second copy that could drift.
import { describe, expect, it } from "vitest";
import { generateQuestionId, QUIZ_ID_RE, randomIdSuffix, slugifyPrompt } from "@/lib/quiz-keys";

// Deliberately nasty: punctuation-only, non-Latin script, emoji, an id-like
// prompt, leading/trailing junk, and something far longer than the 64-character
// cap. Every one of them is a prompt an organizer could plausibly type.
const PROMPTS = [
  "Which header mitigates clickjacking?",
  "What is SQL injection?",
  "  leading and trailing whitespace  ",
  "!!!???...",
  "",
  "   ",
  "-----",
  "___",
  "¿Qué cabecera mitiga el clickjacking?",
  "如何防止跨站脚本攻击？",
  "🔐🔥 pick the safe one 🔥🔐",
  "A/B testing: 100% coverage (really?) — yes, really!",
  "already-looks-like-an-id",
  "x".repeat(500),
  "word ".repeat(200),
  "Tabs\tand\nnewlines\r\nmixed in",
  "CAPS LOCK PROMPT",
];

describe("generateQuestionId", () => {
  it("always emits an id the store would accept", () => {
    for (const prompt of PROMPTS) {
      for (let i = 0; i < 25; i += 1) {
        const id = generateQuestionId(prompt);
        // Non-vacuity: an empty string trivially fails the regex anyway, but
        // asserting length separately means a generator that started
        // returning "" could never look like a pass.
        expect(id.length).toBeGreaterThan(0);
        expect(id).toMatch(QUIZ_ID_RE);
        expect(id.length).toBeLessThanOrEqual(64);
      }
    }
  });

  it("gives two identical prompts different ids", () => {
    const prompt = "Which header mitigates clickjacking?";
    expect(generateQuestionId(prompt)).not.toBe(generateQuestionId(prompt));

    // And not merely "usually different": 500 draws of the same prompt must
    // stay distinct, which a suffix of the wrong width (or a missing one)
    // could not manage.
    const ids = new Set(Array.from({ length: 500 }, () => generateQuestionId(prompt)));
    expect(ids.size).toBe(500);
  });

  it("keeps the prompt readable in the id", () => {
    expect(generateQuestionId("Which header mitigates clickjacking?", "abc123")).toBe(
      "which-header-mitigates-clickjack-abc123",
    );
  });

  it("falls back to an opaque but valid id when the prompt has nothing sluggable", () => {
    expect(generateQuestionId("!!!???", "abc123")).toBe("q-abc123");
    expect(generateQuestionId("如何防止跨站脚本攻击？", "abc123")).toBe("q-abc123");
  });

  // The suffix is a parameter, so this is reachable — and it is the guard that
  // makes "cannot emit an id the store would reject" a property rather than a
  // hope about the slug rules.
  it("refuses to return a candidate the store's own pattern rejects", () => {
    const bad = generateQuestionId("Fine prompt", "not a valid suffix!");
    expect(bad).not.toContain(" ");
    expect(bad).not.toContain("!");
    expect(bad).toMatch(QUIZ_ID_RE);

    const tooLong = generateQuestionId("Fine prompt", "z".repeat(200));
    expect(tooLong.length).toBeLessThanOrEqual(64);
    expect(tooLong).toMatch(QUIZ_ID_RE);
  });
});

describe("slugifyPrompt", () => {
  it("lowercases, collapses non-alphanumeric runs, and trims the dashes", () => {
    expect(slugifyPrompt("  Which HEADER -- mitigates clickjacking?  ")).toBe("which-header-mitigates-clickjack");
  });

  it("returns an empty slug when there is nothing to slug", () => {
    expect(slugifyPrompt("!!!")).toBe("");
    expect(slugifyPrompt("")).toBe("");
  });

  it("never ends in a dash, however the clip lands", () => {
    // 32 characters of slug would fall exactly on the separator here.
    const clipped = slugifyPrompt("abcdefghijklmnopqrstuvwxyzabcde fghij");
    expect(clipped.endsWith("-")).toBe(false);
    expect(clipped).toBe("abcdefghijklmnopqrstuvwxyzabcde");
  });
});

describe("randomIdSuffix", () => {
  it("draws only characters the id pattern accepts", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(randomIdSuffix()).toMatch(/^[a-z0-9]{6}$/);
    }
  });

  it("is injectable, so a caller can pin it", () => {
    expect(randomIdSuffix(() => 0)).toBe("aaaaaa");
    // 0.999… lands on the last character of the alphabet.
    expect(randomIdSuffix(() => 0.9999)).toBe("999999");
  });
});
