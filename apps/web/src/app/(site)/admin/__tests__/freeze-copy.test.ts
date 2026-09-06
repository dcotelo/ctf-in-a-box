// The Freeze switch's copy (audit F11).
//
// Two screens flip one setting, so the copy lives in one module and both
// import it. What is worth pinning is not the wording but the claims an
// organizer will repeat to a room, and the one quotation that has a second
// source of truth elsewhere in the app.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FREEZE_HELP, PAUSED_CONTESTANT_MESSAGE, freezeConfirm } from "../freeze-copy";

describe("the sentence the panel quotes to the organizer", () => {
  // The panel tells an organizer what a contestant sees. If a board's message
  // is reworded and this is not, the panel starts quoting a sentence that
  // exists nowhere — worse than quoting none, because a help desk would be
  // hunting for it. Read from source rather than imported: both boards are
  // client components that pull in the whole store layer, and this assertion
  // needs the string, not the module.
  it.each(["src/components/quiz-board.tsx", "src/components/challenge-detail.tsx"])(
    "is the message %s actually renders",
    (path) => {
      expect(readFileSync(path, "utf8")).toContain(PAUSED_CONTESTANT_MESSAGE);
    },
  );
});

describe("FREEZE_HELP", () => {
  it("names the submissions that are refused", () => {
    expect(FREEZE_HELP).toMatch(/quiz/i);
    expect(FREEZE_HELP).toMatch(/classic/i);
    expect(FREEZE_HELP).toMatch(/ai/i);
  });

  it("says fork Actions keep going — the fact the old copy left out", () => {
    // `docs/operations.md`: freezing "freezes ingestion, not fork Actions".
    // An organizer who does not know this tells a contestant their PR was not
    // scored, when it was judged, commented, and merely waiting.
    expect(FREEZE_HELP).toMatch(/fork Actions keep judging/i);
    expect(FREEZE_HELP).toMatch(/unfreeze/i);
  });

  it("separates the comment (immediate) from the points (held)", () => {
    // The distinction an organizer relays at a help desk. Saying the Actions
    // keep posting and that "those" are held reads as though the comment
    // itself is withheld — so a contestant checking their PR and finding a
    // score comment would look like a contradiction.
    expect(FREEZE_HELP).toMatch(/score comments still appear/i);
    expect(FREEZE_HELP).toMatch(/points reach the board only once you unfreeze/i);
  });
});

describe("freezeConfirm", () => {
  it("quotes what the contestant will read, in the freeze direction", () => {
    const { title, body, confirmLabel } = freezeConfirm(true);
    expect(title).toBe("Freeze scoring?");
    expect(confirmLabel).toBe("Freeze");
    expect(body).toContain(PAUSED_CONTESTANT_MESSAGE);
    // Same distinction as the help line: the comment lands on the PR now, the
    // ingestion of its points is what waits.
    expect(body).toMatch(/score comment still appears on its PR straight away/i);
    expect(body).toMatch(/what is held is the ingestion/i);
    expect(body).toMatch(/Nothing is dropped/i);
  });

  it("promises the deferred scores land, in the unfreeze direction", () => {
    const { title, body, confirmLabel } = freezeConfirm(false);
    expect(title).toBe("Unfreeze scoring?");
    expect(confirmLabel).toBe("Unfreeze");
    expect(body).toMatch(/picked up from where ingestion stopped/i);
  });

  it("gives the two directions different copy — not one sentence with a word flipped", () => {
    expect(freezeConfirm(true).body).not.toBe(freezeConfirm(false).body);
  });
});
