// What the Freeze switch says, in one place.
//
// The switch exists twice — Overview calls it "Scoring" and shows it on, Event
// calls it "Freeze scoring" and shows it off — but it is one setting
// (`paused` in `ctf:admin:settings`) and must make one promise. Each screen
// used to carry its own copy of the help line and the confirm body, which is
// how both drifted into saying less than the state actually does.
//
// The copy answers what an organizer is about to be asked out loud by a room
// (audit F11): what happens to work already in flight? Three facts, each
// checked against the code and `docs/operations.md` rather than assumed:
//
//   1. Fork Actions keep running. A contestant's PR is still judged and still
//      gets its score comment — freezing stops INGESTION, not judging
//      (`docs/operations.md`, "Freeze"). Poll mode's cursor holds in place and
//      resumes; push mode's `POST /score` answers 503, which the fork's Action
//      retries. Nothing is lost, only deferred. This is the fact an organizer
//      most needs to relay and the fact the old copy never carried: the PR
//      score is real, the board is on hold.
//   2. Direct submissions are refused outright — quiz answers, classic flags,
//      AI solves.
//   3. A contestant who tries reads "Scoring is paused right now. Try again
//      later." (`quiz-board.tsx`, `challenge-detail.tsx`). Quoted here
//      verbatim so an organizer recognises the sentence being read back to
//      them over a help desk, and so a change to it fails this file's test.

/** The contestant-facing sentence, quoted so the two sides cannot drift
 *  silently: a test pins that this is what the boards actually render. */
export const PAUSED_CONTESTANT_MESSAGE = "Scoring is paused right now. Try again later.";

/** The line under the switch, on both screens. */
export const FREEZE_HELP =
  "Holds scoring for everyone. Quiz, classic and AI submissions are refused; fork Actions keep judging PRs and their score comments still appear, but those points reach the board only once you unfreeze.";

/** The confirmation for flipping `paused`. `next` is the value being written,
 *  so `true` is the freeze direction. */
export function freezeConfirm(next: boolean): { title: string; body: string; confirmLabel: string } {
  return next
    ? {
        title: "Freeze scoring?",
        body:
          `Contestants get "${PAUSED_CONTESTANT_MESSAGE}" on every quiz answer, flag and AI solve. ` +
          "Fork Actions keep judging pull requests, and each score comment still appears on its PR straight away — " +
          "what is held is the ingestion of those points onto the board, which happens when you unfreeze. " +
          "Nothing is dropped.",
        confirmLabel: "Freeze",
      }
    : {
        title: "Unfreeze scoring?",
        body: "Scoring resumes for everyone, and anything judged while frozen is picked up from where ingestion stopped.",
        confirmLabel: "Unfreeze",
      };
}
