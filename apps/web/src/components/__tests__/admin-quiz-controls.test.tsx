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
import type { AdminQuestion, Question } from "@/lib/quiz-store";
import AdminQuizControls, {
  describeQuizError,
  draftFromQuestion,
  emptyDraft,
  isDraftValid,
  questionDeleteConfirm,
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
    expect(draft.id).toBe(question.id);
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
});

describe("isDraftValid", () => {
  const base: QuestionDraft = emptyDraft(1);

  it("rejects a single-choice question with zero correct answers", () => {
    expect(isDraftValid({ ...base, id: "q", prompt: "p", correct: [] })).toBe(false);
  });

  it("rejects a single-choice question with more than one correct answer", () => {
    expect(isDraftValid({ ...base, id: "q", prompt: "p", correct: ["a", "b"] })).toBe(false);
  });

  it("accepts a single-choice question with exactly one correct answer", () => {
    const draft: QuestionDraft = {
      ...base,
      id: "q",
      prompt: "p",
      choices: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      correct: ["a"],
    };
    expect(isDraftValid(draft)).toBe(true);
  });

  it("rejects a multi-choice question with zero correct answers", () => {
    const draft: QuestionDraft = { ...base, id: "q", prompt: "p", type: "multi", correct: [] };
    expect(isDraftValid(draft)).toBe(false);
  });

  it("accepts a multi-choice question with two correct answers", () => {
    const draft: QuestionDraft = {
      ...base,
      id: "q",
      prompt: "p",
      type: "multi",
      choices: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      correct: ["a", "b"],
    };
    expect(isDraftValid(draft)).toBe(true);
  });

  it("rejects a missing id or prompt", () => {
    expect(isDraftValid({ ...base, id: "", prompt: "p", correct: ["a"] })).toBe(false);
    expect(isDraftValid({ ...base, id: "q", prompt: "", correct: ["a"] })).toBe(false);
  });

  it("rejects fewer than two choices", () => {
    const draft: QuestionDraft = { ...base, id: "q", prompt: "p", choices: [{ id: "a", label: "A" }], correct: ["a"] };
    expect(isDraftValid(draft)).toBe(false);
  });

  it("rejects duplicate choice ids", () => {
    const draft: QuestionDraft = {
      ...base,
      id: "q",
      prompt: "p",
      choices: [
        { id: "a", label: "A" },
        { id: "a", label: "A2" },
      ],
      correct: ["a"],
    };
    expect(isDraftValid(draft)).toBe(false);
  });

  it("rejects a non-integer points or order value", () => {
    expect(isDraftValid({ ...base, id: "q", prompt: "p", correct: ["a"], points: "1.5" })).toBe(false);
    expect(isDraftValid({ ...base, id: "q", prompt: "p", correct: ["a"], order: "abc" })).toBe(false);
  });
});

describe("questionDeleteConfirm", () => {
  it("requires typing the question's own id to confirm — not a generic phrase", () => {
    const copy = questionDeleteConfirm(question);
    expect(copy.requireType).toBe(question.id);
    expect(copy.title).toContain(question.prompt);
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
