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
import type { Question } from "@/lib/quiz-store";
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

function renderControls(initialQuestions: Question[] = []) {
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
    const html = renderControls([question]);
    expect(html).toContain(question.prompt);
    expect(html).toContain("Edit");
    expect(html).toContain("Delete");
    expect(html).not.toContain("No questions yet.");
  });

  it("never renders correct-answer data — Question carries none to begin with", () => {
    const html = renderControls([question]);
    // The public Question type has no field that could carry a correct
    // choice id, and the admin GET route's `listQuestions()` never reads
    // `ctf:quiz:key` either — so there is nothing here for a shared
    // component or contestant page to ever pick up.
    expect(html).not.toContain("correct");
  });
});

describe("draftFromQuestion", () => {
  it("never pre-fills a correct answer, even when editing an existing question", () => {
    const draft = draftFromQuestion(question);
    expect(draft.correct).toEqual([]);
    expect(draft.id).toBe(question.id);
    expect(draft.choices).toEqual(question.choices);
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
