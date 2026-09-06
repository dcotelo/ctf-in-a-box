// The module switch's rules, shared by Event's Modules section and each
// module panel's header switch. Pure, so provable by direct call — the two
// callers can only differ in where they render, never in what they decide.
import { describe, expect, it } from "vitest";
import { moduleToggleConfirm, moduleToggleState } from "@/app/(site)/admin/module-toggle";

const quiz = { id: "quiz", label: "Quiz", toggleable: true };
const classic = { id: "classic", label: "Classic CTF", toggleable: true };
const secdev = { id: "secure-development", label: "Secure Development", toggleable: false, reason: "Configured at setup." };

describe("moduleToggleState", () => {
  it("reads on/off from the live set", () => {
    expect(moduleToggleState(quiz, new Set(["quiz", "classic"]), 2)).toEqual({ on: true, disabled: false, help: undefined });
    expect(moduleToggleState(classic, new Set(["quiz"]), 1)).toMatchObject({ on: false, disabled: false });
  });

  it("locks a non-toggleable module and says why", () => {
    expect(moduleToggleState(secdev, new Set(["secure-development", "quiz"]), 2)).toEqual({
      on: true,
      disabled: true,
      help: "Configured at setup.",
    });
  });

  it("locks the last LIVE module, counting the non-toggleable ones as live", () => {
    // quiz alone: locked, with the sentence.
    expect(moduleToggleState(quiz, new Set(["quiz"]), 1)).toEqual({
      on: true,
      disabled: true,
      help: "The only module left — an event has to serve something.",
    });
    // quiz + secure-development: quiz is NOT the last one — secure-development
    // is serving too, so the set stays legal without quiz.
    expect(moduleToggleState(quiz, new Set(["quiz", "secure-development"]), 2)).toMatchObject({ disabled: false, help: undefined });
  });

  it("never locks an OFF module for being 'the last one'", () => {
    expect(moduleToggleState(classic, new Set(["quiz"]), 1)).toMatchObject({ on: false, disabled: false });
  });
});

describe("moduleToggleConfirm", () => {
  it("adds the module to the set on enable, with the enable copy", () => {
    const c = moduleToggleConfirm(classic, true, new Set(["quiz"]));
    expect(c.ids).toEqual(["quiz", "classic"]);
    expect(c.title).toBe("Enable Classic CTF?");
    expect(c.confirmLabel).toBe("Enable");
    expect(c.body).toMatch(/appears in the nav/);
  });

  it("removes it on disable and says nothing is deleted", () => {
    const c = moduleToggleConfirm(quiz, false, new Set(["quiz", "classic"]));
    expect(c.ids).toEqual(["classic"]);
    expect(c.title).toBe("Disable Quiz?");
    expect(c.confirmLabel).toBe("Disable");
    expect(c.body).toMatch(/Nothing is deleted/);
  });
});
