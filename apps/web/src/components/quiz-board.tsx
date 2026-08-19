"use client";

// The quiz's interactive surface. Owns selection state and dispatches to
// /api/quiz/answer, which authenticates the session and is the sole
// authority on grading, the attempt cap, and the cooldown (see
// src/lib/quiz-store.ts). This component never sees — and cannot render —
// a correct answer: `QuizQuestionView` has no field that could carry one.
//
// State split, same shape as team-card.tsx: `questions` (the prop) is the
// server's source of truth for each question's status; `selections` /
// `pending` / `feedback` are UI-only, keyed by question id, and survive a
// `router.refresh()` (which re-renders the server parent with fresh props)
// since this component instance isn't remounted.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Choice, QuestionType } from "@/lib/quiz-store";
import { formatCompact, getRemaining, type Remaining } from "@/lib/countdown";

/** Per-question progress, mutually exclusive. Every branch carries only
 *  public-safe data — never the correct choice id(s). */
export type QuizStatus =
  | { status: "unanswered" }
  | { status: "answered"; earnedPoints: number }
  | { status: "cooldown"; retryAt: string }
  | { status: "exhausted" };

/** What the board needs to render one question — deliberately just the
 *  public `Question` fields plus this viewer's derived status. Built by
 *  the server page from `listQuestions()` + `getViewerQuiz()`, never from a
 *  spread of a raw store record (which is how an answer key would leak). */
export type QuizQuestionView = {
  id: string;
  prompt: string;
  type: QuestionType;
  choices: Choice[];
  points: number;
} & QuizStatus;

type AnswerResponse =
  | { correct: true; points: number; already?: boolean }
  | { correct: false }
  | { error: string; retryAt?: string };

type Feedback = { kind: "success" | "error" | "info"; text: string };

/** Feedback for an accepted (correct) submission. The `already` branch is
 *  NOT cosmetic: `/api/quiz/answer` reports an idempotent re-submission of a
 *  question this login had already banked as `correct: true, points: 0`
 *  (see quiz-store's AnswerResult), and rendering that through the normal
 *  template would announce "Correct — +0 points." — which reads as "this
 *  question is worth nothing", the opposite of the truth. Exported for
 *  direct testing. */
export function describeCorrect(points: number, already?: boolean): string {
  if (already) return "You already answered this one — those points are already yours.";
  return `Correct — +${points} point${points === 1 ? "" : "s"}.`;
}

function describeRefusal(reason: string): string {
  switch (reason) {
    case "paused":
      return "Scoring is paused right now. Try again later.";
    case "answered":
      return "You already answered this one.";
    case "exhausted":
      return "No attempts remaining for this question.";
    case "cooldown":
      // Deliberately no instant here. The question's own cooldown line runs a
      // live countdown; a second, frozen copy of the same deadline in the
      // feedback area would be stale the moment it rendered.
      return "On cooldown right now — the timer on the question shows when you can retry.";
    case "unavailable":
      return "Couldn't verify that right now. Try again in a moment.";
    default:
      return "That submission wasn't accepted.";
  }
}

/** Ticks a question's cooldown once a second.
 *
 *  `mounted` stays false for the server render AND the client's first paint,
 *  so both produce identical markup and hydration can't mismatch — the same
 *  shape `components/event-countdown.tsx` uses, and the reason neither reads
 *  a clock during render. Callers show a time-free placeholder until it
 *  flips. Returns `remaining: null` once the deadline passes.
 *
 *  Passing `undefined` (a question that isn't cooling down) parks the hook:
 *  no timer, no state churn. It still has to be CALLED unconditionally. */
function useCooldown(retryAt: string | undefined): { mounted: boolean; remaining: Remaining | null } {
  const [state, setState] = useState<{ mounted: boolean; remaining: Remaining | null }>({
    mounted: false,
    remaining: null,
  });

  useEffect(() => {
    // Parked: no timer, and deliberately no state reset either. Resetting here
    // would be a synchronous setState in an effect body, and it would be
    // unobservable anyway — every reader guards on `status === "cooldown"`,
    // which is the only case that supplies a `retryAt` at all.
    if (!retryAt) return;
    const targetMs = new Date(retryAt).getTime();
    const tick = () => setState({ mounted: true, remaining: getRemaining(targetMs) });
    // Deferred rather than called in the effect body, matching event-countdown:
    // it reads as subscribing to the clock instead of computing during render,
    // and satisfies react-hooks/set-state-in-effect.
    const timeout = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [retryAt]);

  return state;
}

export default function QuizBoard({
  questions,
  authenticated,
}: {
  questions: QuizQuestionView[];
  /** False for a signed-out visitor: questions stay visible, but submitting
   *  requires a GitHub session (`/api/quiz/answer` 401s otherwise), so an
   *  unanswered question renders a sign-in prompt instead of a submit
   *  control. */
  authenticated: boolean;
}) {
  const router = useRouter();
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<Record<string, Feedback | undefined>>({});

  function toggle(question: QuizQuestionView, choiceId: string) {
    setSelections((prev) => {
      const current = prev[question.id] ?? [];
      if (question.type === "single") {
        return { ...prev, [question.id]: [choiceId] };
      }
      const next = current.includes(choiceId) ? current.filter((id) => id !== choiceId) : [...current, choiceId];
      return { ...prev, [question.id]: next };
    });
  }

  async function submit(question: QuizQuestionView) {
    const choices = selections[question.id] ?? [];
    if (choices.length === 0 || pending[question.id]) return;

    setPending((prev) => ({ ...prev, [question.id]: true }));
    setFeedback((prev) => ({ ...prev, [question.id]: undefined }));
    try {
      const res = await fetch("/api/quiz/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, choices }),
      });
      const data = (await res.json().catch(() => ({}))) as AnswerResponse;
      if (res.ok && "correct" in data) {
        setFeedback((prev) => ({
          ...prev,
          [question.id]: data.correct
            ? { kind: "success", text: describeCorrect(data.points, data.already) }
            : { kind: "error", text: "Not quite. Try again." },
        }));
      } else if ("error" in data && typeof data.error === "string") {
        setFeedback((prev) => ({
          ...prev,
          [question.id]: { kind: "info", text: describeRefusal(data.error) },
        }));
      } else {
        setFeedback((prev) => ({ ...prev, [question.id]: { kind: "error", text: "Something went wrong. Try again." } }));
      }
    } catch {
      setFeedback((prev) => ({ ...prev, [question.id]: { kind: "error", text: "Something went wrong. Try again." } }));
    } finally {
      setPending((prev) => ({ ...prev, [question.id]: false }));
      // Resyncs status (answered/cooldown/exhausted) from the server's own
      // derivation — this component never decides that for itself.
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {questions.map((q) => (
        <QuestionCard
          key={q.id}
          question={q}
          authenticated={authenticated}
          selected={selections[q.id] ?? []}
          pending={pending[q.id] ?? false}
          feedback={feedback[q.id]}
          onToggle={(choiceId) => toggle(q, choiceId)}
          onSubmit={() => submit(q)}
        />
      ))}
    </div>
  );
}

function QuestionCard({
  question,
  authenticated,
  selected,
  pending,
  feedback,
  onToggle,
  onSubmit,
}: {
  question: QuizQuestionView;
  authenticated: boolean;
  selected: string[];
  pending: boolean;
  feedback?: Feedback;
  onToggle: (choiceId: string) => void;
  onSubmit: () => void;
}) {
  const inputType = question.type === "multi" ? "checkbox" : "radio";
  const inputName = `quiz-${question.id}`;
  const cooldown = useCooldown(question.status === "cooldown" ? question.retryAt : undefined);
  // Once the countdown reaches zero the form re-opens without a refresh. Safe
  // to do optimistically: the grading script re-checks the cooldown inside the
  // same atomic EVAL that records the attempt, so an early click is refused
  // server-side rather than granted.
  const cooledDown = cooldown.mounted && cooldown.remaining === null;
  // Choices stay visible in every state (including cooldown) so a contestant
  // can review the question; they're just non-interactive once the state
  // isn't "unanswered".
  const showChoices = question.status === "unanswered" || question.status === "cooldown";
  const choicesDisabled = question.status === "cooldown" && !cooledDown;

  return (
    <div className="ds-card rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-white">{question.prompt}</p>
        <span className="flex-none rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
          {question.points} pts
        </span>
      </div>

      {question.status === "answered" && (
        <p className="mt-3 text-sm text-[#22c55e]">
          Answered — earned {question.earnedPoints} point{question.earnedPoints === 1 ? "" : "s"}.
        </p>
      )}

      {question.status === "exhausted" && (
        <p className="mt-3 text-sm text-zinc-400">No attempts remaining for this question.</p>
      )}

      {question.status === "cooldown" && (
        <p className={`mt-3 text-sm ${cooledDown ? "text-[#22c55e]" : "text-[#d4a017]"}`}>
          {!cooldown.mounted
            ? // Server render and the client's first paint. No clock is read
              // here: a live Date.now() during render disagrees with the
              // server's and trips a hydration mismatch.
              "On cooldown — you can try again shortly."
            : cooldown.remaining
              ? `On cooldown — you can try again in ${formatCompact(cooldown.remaining)}.`
              : "Cooldown's over — you can try again now."}
        </p>
      )}

      {showChoices && (
        <fieldset disabled={choicesDisabled} className="mt-3 flex flex-col gap-2">
          <legend className="sr-only">{question.prompt}</legend>
          {question.choices.map((choice) => (
            <label key={choice.id} className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type={inputType}
                name={inputName}
                value={choice.id}
                checked={selected.includes(choice.id)}
                disabled={choicesDisabled}
                onChange={() => onToggle(choice.id)}
                className="h-4 w-4 flex-none accent-[#2563eb]"
              />
              {choice.label}
            </label>
          ))}
        </fieldset>
      )}

      {question.status === "unanswered" &&
        (authenticated ? (
          <button
            type="button"
            onClick={onSubmit}
            disabled={pending || selected.length === 0}
            className="mt-3 rounded-md bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1d4ed8] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
          >
            {pending ? "Submitting…" : "Submit answer"}
          </button>
        ) : (
          <p className="mt-3 text-xs text-muted">Sign in with GitHub to answer.</p>
        ))}

      {question.status === "cooldown" && (
        <button
          type="button"
          disabled
          className="mt-3 rounded-md bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white opacity-50"
        >
          Submit answer
        </button>
      )}

      {feedback && (
        <p
          role="status"
          className={`mt-2 text-sm ${
            feedback.kind === "success" ? "text-[#22c55e]" : feedback.kind === "error" ? "text-[#e53e3e]" : "text-zinc-400"
          }`}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
