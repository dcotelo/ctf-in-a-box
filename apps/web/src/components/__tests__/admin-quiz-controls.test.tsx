// @testing-library/react is not a dependency of this repo and must not be
// added just for this test. AdminQuizControls has one effect (the mount-time
// GET /api/admin/quiz fetch), which never runs under `renderToStaticMarkup` —
// same pattern as admin-controls.test.tsx and quiz-board.test.tsx. Content
// gated behind useState (the add/edit form, the delete ConfirmModal) never
// appears in this static render, so interactive behavior — including the
// destructive-delete confirmation gate itself — is proven instead through the
// exported pure helpers (`questionDeleteConfirm`, `describeQuizError`,
// `isDraftValid`, `draftFromQuestion`) that the component wires into its JSX.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QUIZ_ID_RE } from "@/lib/quiz-keys";
import type { AdminQuestion, Question } from "@/lib/quiz-store";
import AdminQuizControls, {
  changedOrderRows,
  confirmPhraseFromPrompt,
  describeQuizError,
  draftFromQuestion,
  editorFromQuestion,
  emptyDraft,
  isDraftValid,
  newQuestionEditor,
  payloadFromEditor,
  payloadFromRow,
  questionDeleteConfirm,
  reorderQuestions,
  type QuestionDraft,
} from "@/components/admin-quiz-controls";

const noop = () => {};

const question: Question = {
  id: "q1",
  prompt: "Which header mitigates clickjacking?",
  type: "single",
  choices: [
    { id: "a", label: "X-Frame-Options" },
    { id: "b", label: "Content-Length" },
  ],
  points: 10,
  order: 1,
};

// "a" (X-Frame-Options) is the correct choice. The admin GET route returns
// this alongside the question now — see the component header comment.
const CORRECT_CHOICE_ID = "a";
const row: AdminQuestion = { question, correct: [CORRECT_CHOICE_ID] };

function renderControls(initialQuestions: AdminQuestion[] = []) {
  return renderToStaticMarkup(
    <AdminQuizControls
      pending={false}
      quizMaxAttemptsInput="3"
      setQuizMaxAttemptsInput={noop}
      quizRetryAfterInput="5"
      setQuizRetryAfterInput={noop}
      commitNumber={noop}
      initialQuestions={initialQuestions}
    />,
  );
}

describe("AdminQuizControls", () => {
  it("renders the two retry-gate settings inputs with their current values", () => {
    const html = renderControls();
    expect(html).toContain("Max attempts");
    expect(html).toContain("Retry after (min)");
    expect(html).toMatch(/value="3"/);
    expect(html).toMatch(/value="5"/);
  });

  it("renders an Add question control and a placeholder when there are no questions", () => {
    const html = renderControls();
    expect(html).toContain("Add question");
    expect(html).toContain("No questions yet.");
  });

  it("renders each question with edit and delete controls, never the placeholder", () => {
    const html = renderControls([row]);
    expect(html).toContain(question.prompt);
    expect(html).toContain("Edit");
    expect(html).toContain("Delete");
    expect(html).not.toContain("No questions yet.");
  });

  // Dragging is a mouse gesture. The reorder controls must also exist as real
  // buttons, or an organizer who navigates by keyboard cannot order their own
  // question set at all. The drag handlers themselves are NOT covered by this
  // (no testing-library in this repo, so a drop cannot be simulated) — what is
  // covered is that the keyboard path renders, and that the logic both paths
  // call is `reorderQuestions`, tested directly below.
  it("renders a keyboard-operable move control on every question", () => {
    const second: AdminQuestion = { question: { ...question, id: "q2", prompt: "Second" }, correct: ["a"] };
    const html = renderControls([row, second]);
    expect(html).toContain(`Move &quot;${question.prompt}&quot; up`);
    expect(html).toContain('Move &quot;Second&quot; down');
    expect(html).toMatch(/Move up/);
    expect(html).toMatch(/Move down/);
  });

  // The component now HOLDS the answer key (that's the point — the edit form
  // prefills from it), but the collapsed list must not paint it: an organizer
  // browsing their questions may well be doing it on a projector. The key
  // surfaces only inside the edit form, which is behind a useState toggle and
  // so never appears in this static render.
  it("keeps the correct-answer ids out of the collapsed list markup", () => {
    const distinctive: AdminQuestion = {
      question: {
        ...question,
        choices: [
          { id: "correct-choice-zz9", label: "X-Frame-Options" },
          { id: "wrong-choice-zz9", label: "Content-Length" },
        ],
      },
      correct: ["correct-choice-zz9"],
    };
    const html = renderControls([distinctive]);
    // Proves the row actually rendered — otherwise the assertion below would
    // pass on an empty list and prove nothing.
    expect(html).toContain(distinctive.question.prompt);
    expect(html).not.toContain("correct-choice-zz9");
  });
});

describe("draftFromQuestion", () => {
  // The bug this fixes: an edit draft that started with nothing marked
  // correct forced the organizer to re-pick the answer from memory on every
  // save, so fixing a typo in a prompt could silently redefine what counts as
  // correct for every contestant.
  it("prefills the choices currently marked correct when editing an existing question", () => {
    const draft = draftFromQuestion(row);
    expect(draft.correct).toEqual([CORRECT_CHOICE_ID]);
    expect(draft.prompt).toBe(question.prompt);
    expect(draft.choices).toEqual(question.choices);
  });

  it("prefills every correct choice of a multi-choice question, not just the first", () => {
    const multi: AdminQuestion = {
      question: {
        ...question,
        type: "multi",
        choices: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
        ],
      },
      correct: ["a", "c"],
    };
    expect(draftFromQuestion(multi).correct).toEqual(["a", "c"]);
  });

  it("is immediately valid for re-submission — a typo fix needs no re-picking of the answer", () => {
    // The real regression guard: with `correct: []` this returned a draft
    // `isDraftValid` rejected, which is what forced the re-pick in the first
    // place.
    expect(isDraftValid(draftFromQuestion(row))).toBe(true);
  });

  it("copies the correct set instead of aliasing the list row, so a cancelled edit changes nothing", () => {
    const source: AdminQuestion = { question, correct: [CORRECT_CHOICE_ID] };
    const draft = draftFromQuestion(source);
    draft.correct.push("b");
    expect(source.correct).toEqual([CORRECT_CHOICE_ID]);
  });

  // The draft is what the form edits. It must not carry the id at all — that
  // is what makes an id change unexpressible rather than merely disabled.
  it("carries no id or order field for the form to change", () => {
    expect(Object.keys(draftFromQuestion(row))).not.toContain("id");
    expect(Object.keys(draftFromQuestion(row))).not.toContain("order");
    expect(Object.keys(emptyDraft())).not.toContain("id");
    expect(Object.keys(emptyDraft())).not.toContain("order");
  });
});

// A question's id is the field name in `ctf:quiz:questions` and `ctf:quiz:key`
// AND the reference every contestant's `ctf:quiz:answers:<login>` row is
// recorded against. Change it on an existing question and every banked answer
// is orphaned: the points stay on the leaderboard with no question behind
// them, and the "answered" count no longer lines up with anything.
describe("payloadFromEditor — an edit can never change a question's id", () => {
  it("submits the stored id even when every other field has been rewritten", () => {
    const editor = editorFromQuestion(row);
    // Everything the form CAN change, changed — including the prompt, which
    // is what a new question's id would be derived from.
    const draft: QuestionDraft = {
      prompt: "A completely different question about CSRF tokens",
      type: "multi",
      points: "99",
      choices: [
        { id: "x", label: "X" },
        { id: "y", label: "Y" },
      ],
      correct: ["x", "y"],
    };

    const payload = payloadFromEditor({ ...editor, draft }, () => "generated-from-the-new-prompt");
    expect(payload.id).toBe(question.id);
    // Non-vacuity: the rewrite really did land, so `id` staying put is the
    // property under test rather than a payload that never changed at all.
    expect(payload.prompt).toBe("A completely different question about CSRF tokens");
    expect(payload.points).toBe(99);
  });

  it("keeps the id across a prompt that would generate a different one", () => {
    const editor = editorFromQuestion({ question: { ...question, id: "legacy-hand-typed-id" }, correct: ["a"] });
    const payload = payloadFromEditor({ ...editor, draft: { ...editor.draft, prompt: "New wording entirely" } });
    expect(payload.id).toBe("legacy-hand-typed-id");
  });

  it("keeps the question's existing position rather than re-deriving one", () => {
    const editor = editorFromQuestion({ question: { ...question, order: 7 }, correct: ["a"] });
    expect(payloadFromEditor(editor).order).toBe(7);
  });

  it("generates an id from the prompt for a NEW question", () => {
    const editor = newQuestionEditor(4);
    const draft: QuestionDraft = {
      ...editor.draft,
      prompt: "Which header mitigates clickjacking?",
      choices: [
        { id: "a", label: "X-Frame-Options" },
        { id: "b", label: "Content-Length" },
      ],
      correct: ["a"],
    };

    const payload = payloadFromEditor({ ...editor, draft });
    expect(payload.id).toMatch(QUIZ_ID_RE);
    expect(payload.id).toContain("which-header-mitigates");
    expect(payload.order).toBe(4);
  });

  it("mints a DIFFERENT id for each new question with the same prompt", () => {
    const editor = newQuestionEditor(1);
    const draft: QuestionDraft = { ...editor.draft, prompt: "Same wording twice" };
    const first = payloadFromEditor({ ...editor, draft }).id;
    const second = payloadFromEditor({ ...editor, draft }).id;
    expect(first).not.toBe(second);
  });
});

describe("payloadFromRow", () => {
  it("round-trips a stored row unchanged, so a reorder re-saves only the order", () => {
    const payload = payloadFromRow({ question: { ...question, order: 3 }, correct: [CORRECT_CHOICE_ID] });
    expect(payload).toEqual({
      id: question.id,
      prompt: question.prompt,
      type: question.type,
      choices: question.choices,
      points: question.points,
      order: 3,
      correct: [CORRECT_CHOICE_ID],
    });
  });
});

describe("reorderQuestions", () => {
  const rows = (...ids: string[]): AdminQuestion[] =>
    ids.map((id, i) => ({ question: { ...question, id, prompt: `Prompt ${id}`, order: i + 1 }, correct: ["a"] }));

  const shape = (list: AdminQuestion[]) => list.map((r) => [r.question.id, r.question.order] as const);

  it("moves a row down and renumbers every position from 1", () => {
    expect(shape(reorderQuestions(rows("a", "b", "c", "d"), 0, 2))).toEqual([
      ["b", 1],
      ["c", 2],
      ["a", 3],
      ["d", 4],
    ]);
  });

  it("moves a row up and renumbers every position from 1", () => {
    expect(shape(reorderQuestions(rows("a", "b", "c", "d"), 3, 0))).toEqual([
      ["d", 1],
      ["a", 2],
      ["b", 3],
      ["c", 4],
    ]);
  });

  it("renumbers a list whose stored orders were sparse or zero-based", () => {
    const sparse: AdminQuestion[] = [
      { question: { ...question, id: "a", order: 0 }, correct: ["a"] },
      { question: { ...question, id: "b", order: 40 }, correct: ["a"] },
      { question: { ...question, id: "c", order: 900 }, correct: ["a"] },
    ];
    expect(shape(reorderQuestions(sparse, 2, 0))).toEqual([
      ["c", 1],
      ["a", 2],
      ["b", 3],
    ]);
  });

  it("never mutates the list it was given", () => {
    const before = rows("a", "b", "c");
    reorderQuestions(before, 0, 2);
    expect(shape(before)).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("treats an out-of-range index as a no-op rather than a silent renumbering", () => {
    const sparse: AdminQuestion[] = [
      { question: { ...question, id: "a", order: 0 }, correct: ["a"] },
      { question: { ...question, id: "b", order: 40 }, correct: ["a"] },
    ];
    expect(shape(reorderQuestions(sparse, 0, 5))).toEqual([
      ["a", 0],
      ["b", 40],
    ]);
    expect(shape(reorderQuestions(sparse, -1, 0))).toEqual([
      ["a", 0],
      ["b", 40],
    ]);
  });
});

describe("changedOrderRows", () => {
  const rows = (...ids: string[]): AdminQuestion[] =>
    ids.map((id, i) => ({ question: { ...question, id, order: i + 1 }, correct: ["a"] }));

  it("names exactly the questions a move has to write back", () => {
    const before = rows("a", "b", "c", "d");
    const after = reorderQuestions(before, 0, 1);
    // Only the swapped pair moved; "c" and "d" kept positions 3 and 4.
    expect(changedOrderRows(before, after).map((r) => r.question.id).sort()).toEqual(["a", "b"]);
  });

  it("is empty when nothing moved, so a no-op drag writes nothing", () => {
    const before = rows("a", "b", "c");
    expect(changedOrderRows(before, reorderQuestions(before, 1, 1))).toEqual([]);
  });
});

describe("isDraftValid", () => {
  // Labelled choices, since an empty label is itself a rejection reason and
  // would make every "accepts" case below pass or fail for the wrong reason.
  const base: QuestionDraft = {
    ...emptyDraft(),
    choices: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
  };

  it("rejects a single-choice question with zero correct answers", () => {
    expect(isDraftValid({ ...base, prompt: "p", correct: [] })).toBe(false);
  });

  it("rejects a single-choice question with more than one correct answer", () => {
    expect(isDraftValid({ ...base, prompt: "p", correct: ["a", "b"] })).toBe(false);
  });

  it("accepts a single-choice question with exactly one correct answer", () => {
    expect(isDraftValid({ ...base, prompt: "p", correct: ["a"] })).toBe(true);
  });

  it("rejects a multi-choice question with zero correct answers", () => {
    expect(isDraftValid({ ...base, prompt: "p", type: "multi", correct: [] })).toBe(false);
  });

  it("accepts a multi-choice question with two correct answers", () => {
    expect(isDraftValid({ ...base, prompt: "p", type: "multi", correct: ["a", "b"] })).toBe(true);
  });

  // The prompt now carries the whole burden the id used to share: it is the
  // only thing a new question's id can be derived from, so an empty one has
  // to stay a rejection.
  it("rejects a missing prompt", () => {
    expect(isDraftValid({ ...base, prompt: "", correct: ["a"] })).toBe(false);
    expect(isDraftValid({ ...base, prompt: "   ", correct: ["a"] })).toBe(false);
  });

  it("rejects fewer than two choices", () => {
    const draft: QuestionDraft = { ...base, prompt: "p", choices: [{ id: "a", label: "A" }], correct: ["a"] };
    expect(isDraftValid(draft)).toBe(false);
  });

  it("rejects duplicate choice ids", () => {
    const draft: QuestionDraft = {
      ...base,
      prompt: "p",
      choices: [
        { id: "a", label: "A" },
        { id: "a", label: "A2" },
      ],
      correct: ["a"],
    };
    expect(isDraftValid(draft)).toBe(false);
  });

  it("rejects a non-integer points value", () => {
    expect(isDraftValid({ ...base, prompt: "p", correct: ["a"], points: "1.5" })).toBe(false);
    expect(isDraftValid({ ...base, prompt: "p", correct: ["a"], points: "" })).toBe(false);
  });
});

describe("confirmPhraseFromPrompt", () => {
  it("uses a short prompt verbatim", () => {
    expect(confirmPhraseFromPrompt("Which header mitigates clickjacking?")).toBe(
      "Which header mitigates clickjacking?",
    );
  });

  it("collapses whitespace so what is shown is typeable as one line", () => {
    expect(confirmPhraseFromPrompt("  Which   header\nmitigates it? ")).toBe("Which header mitigates it?");
  });

  it("truncates a long prompt at a word boundary rather than mid-word", () => {
    const long =
      "Which of the following HTTP response headers is the one that instructs a browser to refuse framing?";
    const phrase = confirmPhraseFromPrompt(long);
    expect(phrase.length).toBeLessThanOrEqual(48);
    expect(long.startsWith(phrase)).toBe(true);
    expect(phrase.endsWith(" ")).toBe(false);
    // A word boundary, not a hard 48-character chop.
    expect(long[phrase.length]).toBe(" ");
  });
});

describe("questionDeleteConfirm", () => {
  // Was the question's ID. Ids are generated now, so typing one back proves
  // only that the organizer can copy a string — it doesn't make them read
  // WHICH question is about to disappear, which is this gate's whole job.
  it("requires typing the question's own prompt to confirm — not a generic phrase, and not its id", () => {
    const copy = questionDeleteConfirm(question);
    expect(copy.requireType).toBe(question.prompt);
    expect(copy.requireType).not.toBe(question.id);
    expect(copy.title).toContain(question.prompt);
  });

  it("asks for exactly the phrase it displays, even for a long prompt", () => {
    const long: Question = {
      ...question,
      prompt: "Which of the following HTTP response headers is the one that instructs a browser to refuse framing?",
    };
    const copy = questionDeleteConfirm(long);
    expect(copy.requireType.length).toBeLessThanOrEqual(48);
    // The title is where the organizer READS the phrase; if the two ever
    // diverge the gate becomes an unwinnable guessing game.
    expect(copy.title).toContain(copy.requireType);
    expect(long.prompt.startsWith(copy.requireType)).toBe(true);
  });

  // Two prompts can share a first 48 characters; the id on screen is what
  // tells the organizer which of them they have selected.
  it("still shows the id, so a shared prompt prefix is never ambiguous", () => {
    expect(questionDeleteConfirm(question).body).toContain(question.id);
  });

  // The copy must match what `deleteQuestion` actually does: it drops the
  // question and its answer key and NOTHING else. An earlier draft promised
  // it wiped contestant history, which would send an organizer trying to
  // un-award points down a path that doesn't do that.
  it("promises only what deletion actually does — the question goes, banked points stay", () => {
    const { body } = questionDeleteConfirm(question);
    expect(body).toMatch(/removes the question/i);
    expect(body).toMatch(/points already banked.*(stay|remain)/i);
    expect(body).toMatch(/master reset/i);
  });

  it("never claims deletion destroys answer or attempt history", () => {
    const { body } = questionDeleteConfirm(question);
    expect(body).not.toMatch(/destroy|wipe/i);
    expect(body).not.toMatch(/attempt history/i);
  });
});

describe("describeQuizError", () => {
  it("surfaces a 400 validation error as the store's own message", () => {
    expect(describeQuizError(400, "Invalid choice id: !!")).toBe("Invalid choice id: !!");
  });

  it("surfaces a 503 infrastructure failure distinctly from a validation error", () => {
    const msg = describeQuizError(503, "quiz store write failed");
    expect(msg).not.toBe("quiz store write failed");
    expect(msg).toMatch(/unavailable/i);
  });

  it("never claims the payload was bad when the store itself failed", () => {
    const msg = describeQuizError(503, "quiz store write failed");
    expect(msg.toLowerCase()).not.toContain("invalid");
  });
});
