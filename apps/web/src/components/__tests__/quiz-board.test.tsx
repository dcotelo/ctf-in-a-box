// @testing-library/react is not a dependency of this repo and must not be
// added just for this test. QuizBoard has no effects that run during a
// plain render, so renderToStaticMarkup is enough to check markup — same
// pattern as team-card.test.tsx. useRouter is mocked since next/navigation's
// real hook needs a router context. Anything gated behind a useState toggle
// (submit feedback, pending text) never appears in this static render — these
// tests only assert on the initial server-derived view.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import QuizBoard, { type QuizQuestionView } from "@/components/quiz-board";

const singleChoiceQuestion: QuizQuestionView = {
  id: "q1",
  prompt: "Which HTTP header mitigates clickjacking?",
  type: "single",
  choices: [
    { id: "opt-a", label: "X-Frame-Options" },
    { id: "opt-b", label: "Content-Length" },
  ],
  points: 10,
  status: "unanswered",
};

const multiChoiceQuestion: QuizQuestionView = {
  id: "q2",
  prompt: "Which of these are injection risks? (select all that apply)",
  type: "multi",
  choices: [
    { id: "opt-c", label: "String-concatenated SQL" },
    { id: "opt-d", label: "Parameterized queries" },
    { id: "opt-e", label: "eval() on user input" },
  ],
  points: 15,
  status: "unanswered",
};

describe("QuizBoard", () => {
  it("renders each question's prompt, points, and choices", () => {
    const html = renderToStaticMarkup(<QuizBoard questions={[singleChoiceQuestion]} authenticated />);
    expect(html).toMatch(/Which HTTP header mitigates clickjacking\?/);
    expect(html).toMatch(/10 pts/);
    expect(html).toContain("X-Frame-Options");
    expect(html).toContain("Content-Length");
  });

  it("uses radio inputs for a single-choice question", () => {
    const html = renderToStaticMarkup(<QuizBoard questions={[singleChoiceQuestion]} authenticated />);
    expect(html).toContain('type="radio"');
    expect(html).not.toContain('type="checkbox"');
  });

  it("uses checkbox inputs for a multi-choice question", () => {
    const html = renderToStaticMarkup(<QuizBoard questions={[multiChoiceQuestion]} authenticated />);
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('type="radio"');
  });

  it("shows an unanswered question with a submit control and selectable, non-disabled choices", () => {
    const html = renderToStaticMarkup(<QuizBoard questions={[singleChoiceQuestion]} authenticated />);
    expect(html).toMatch(/submit answer/i);
    // The submit button itself starts disabled (nothing selected yet), but
    // the choice inputs must not be — that's what distinguishes this from
    // the cooldown state below.
    expect(html).not.toMatch(/type="radio"[^>]*disabled/);
  });

  it("shows an answered question as answered and offers no inputs", () => {
    const answered: QuizQuestionView = { ...singleChoiceQuestion, status: "answered", earnedPoints: 10 };
    const html = renderToStaticMarkup(<QuizBoard questions={[answered]} authenticated />);
    expect(html).toMatch(/answered/i);
    expect(html).toMatch(/10 point/i);
    expect(html).not.toContain("<input");
    expect(html).not.toMatch(/submit answer/i);
  });

  it("shows a cooldown question with its retry time and disables submission", () => {
    const retryAt = "2026-08-18T12:34:56.000Z";
    const cooling: QuizQuestionView = { ...singleChoiceQuestion, status: "cooldown", retryAt };
    const html = renderToStaticMarkup(<QuizBoard questions={[cooling]} authenticated />);
    expect(html).toContain(retryAt);
    // Choices are still visible for review, but every input and the submit
    // control are disabled.
    expect(html).toContain("<input");
    expect(html).toMatch(/submit answer/i);
    expect(html).toContain('disabled=""');
  });

  it("shows an exhausted question with no submit control", () => {
    const exhausted: QuizQuestionView = { ...singleChoiceQuestion, status: "exhausted" };
    const html = renderToStaticMarkup(<QuizBoard questions={[exhausted]} authenticated />);
    expect(html).toMatch(/no attempts remaining/i);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<button");
  });

  it("prompts a signed-out visitor to sign in instead of offering a submit control", () => {
    const html = renderToStaticMarkup(<QuizBoard questions={[singleChoiceQuestion]} authenticated={false} />);
    expect(html).toMatch(/sign in with github/i);
    expect(html).not.toContain("<button");
  });

  it("never lets a correct-answer id reach the markup, even if props carried extra leaked fields", () => {
    // Simulates an accidental leak — e.g. someone spreading a raw store
    // record (which DOES carry a correct-answer shape) into props instead of
    // building the public view model field by field. QuizBoard must never
    // echo such a field into markup even if it somehow arrived here.
    const leakedCorrectId = "leaked-correct-choice-zz9";
    const leaked = {
      ...singleChoiceQuestion,
      correct: [leakedCorrectId],
      correctChoiceIds: [leakedCorrectId],
      answerKey: leakedCorrectId,
    } as unknown as QuizQuestionView;

    const html = renderToStaticMarkup(<QuizBoard questions={[leaked]} authenticated />);
    expect(html).not.toContain(leakedCorrectId);
  });
});
