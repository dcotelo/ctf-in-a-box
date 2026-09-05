// The phrase a delete confirmation makes an organizer retype, shared by the
// quiz (prompt), classic (title) and ai (title) admin panels. Pins the
// algorithm the three module wrappers used to carry separately, including
// the classic/ai fallback for a blank title — `ConfirmModal` treats an empty
// `requireType` as "no confirmation required", so the fallback is the guard.
import { describe, expect, it } from "vitest";
import { DELETE_CONFIRM_PHRASE_MAX, confirmPhrase } from "@/components/admin/confirm-phrase";

describe("confirmPhrase", () => {
  it("uses a short text verbatim", () => {
    expect(confirmPhrase("SQL Injection 101")).toBe("SQL Injection 101");
  });

  it("collapses whitespace so what is shown is typeable as one line", () => {
    expect(confirmPhrase("  Which   header\n mitigates  clickjacking? ")).toBe("Which header mitigates clickjacking?");
  });

  it("truncates a long text at a word boundary inside the cap", () => {
    const long = "Which of the following HTTP response headers, when present, most directly mitigates clickjacking attacks?";
    const phrase = confirmPhrase(long);
    expect(phrase.length).toBeLessThanOrEqual(DELETE_CONFIRM_PHRASE_MAX);
    expect(long.startsWith(phrase)).toBe(true);
    expect(long.charAt(phrase.length)).toBe(" ");
    expect(phrase.endsWith(" ")).toBe(false);
  });

  it("cuts mid-word only when the first word alone exceeds the cap", () => {
    const oneWord = "a".repeat(DELETE_CONFIRM_PHRASE_MAX + 10);
    expect(confirmPhrase(oneWord)).toBe("a".repeat(DELETE_CONFIRM_PHRASE_MAX));
  });

  it("falls back to the given id for a blank or whitespace-only text", () => {
    expect(confirmPhrase("   ", "xss-basics-zz9kq2")).toBe("xss-basics-zz9kq2");
  });

  it("returns an empty string for a blank text when no fallback is given — the quiz's prompt is never blank", () => {
    expect(confirmPhrase("   ")).toBe("");
  });

  it("caps at 48 characters", () => {
    expect(DELETE_CONFIRM_PHRASE_MAX).toBe(48);
  });
});
