import { describe, expect, it } from "vitest";
import { CLASSIC_ID_RE, generateChallengeId, normalizeFlag } from "@/lib/classic-keys";

describe("normalizeFlag", () => {
  it("trims and lowercases", () => {
    expect(normalizeFlag("  CTF{Hello_World}  ")).toBe("ctf{hello_world}");
  });

  it("is idempotent", () => {
    const once = normalizeFlag(" CTF{X} ");
    expect(normalizeFlag(once)).toBe(once);
  });

  // The reason normalization is forbidden in Lua: string.lower is ASCII-only,
  // so a Lua-side normalization of this flag would not equal the JS-side one
  // and the challenge would be permanently unsolvable.
  it("handles non-ASCII without corrupting it", () => {
    expect(normalizeFlag("CTF{ÜBER}")).toBe("ctf{über}");
  });

  it("unifies Unicode composition so visually identical flags match", () => {
    const composed = "CTF{é}";     // e-acute as ONE code point
    const decomposed = "CTF{é}";   // e + combining acute
    // Guard against vacuity: if these ever become the same literal, the
    // assertion below passes trivially and proves nothing.
    expect(composed).not.toBe(decomposed);
    expect(normalizeFlag(composed)).toBe(normalizeFlag(decomposed));
  });
});

describe("generateChallengeId", () => {
  it("builds a slug plus suffix that satisfies the store's own pattern", () => {
    expect(generateChallengeId("SQL Injection 101", "abc123")).toBe("sql-injection-101-abc123");
    expect(CLASSIC_ID_RE.test(generateChallengeId("SQL Injection 101", "abc123"))).toBe(true);
  });

  it("never emits an id the store would reject, even from a hostile suffix", () => {
    expect(CLASSIC_ID_RE.test(generateChallengeId("x", "../../etc/passwd"))).toBe(true);
  });

  it("falls back to a valid id for an untransliterable title", () => {
    expect(CLASSIC_ID_RE.test(generateChallengeId("日本語", "abc123"))).toBe(true);
  });

  it("gives two identically-titled challenges different ids", () => {
    expect(generateChallengeId("Same", "aaaaaa")).not.toBe(generateChallengeId("Same", "bbbbbb"));
  });
});
