"use client";

// The Quiz module's admin section: the two retry-gate settings (max attempts,
// retry cooldown) plus full question authoring (add/edit/delete), rendered in
// place of admin-controls.tsx's old "No settings for this module yet."
// placeholder for the quiz module.
//
// Settings: the numeric inputs reuse `commitNumber` from admin-controls.tsx
// (passed down as a prop, already bound to that component's `settings`/`apply`
// state) — same pattern as the Secure Development hint knobs, not a second
// copy of the same plumbing.
//
// Questions: this component owns its own fetch of GET /api/admin/quiz and its
// own add/edit/delete state, independent of the settings machinery above.
// `initialQuestions` seeds the list synchronously (used by tests, which render
// with `renderToStaticMarkup` and so never run the mount-time fetch below);
// in the browser it's just the pre-hydration paint, immediately replaced by
// a fresh fetch.
//
// Secrecy: `GET /api/admin/quiz` returns `listQuestions()`'s output, which
// NEVER carries the correct-answer set (see quiz-store.ts) — even here, on
// the admin-gated surface. That means editing an existing question always
// starts with no choice marked correct; the organizer must (re)select the
// correct answer(s) on every save, the same as when authoring a new question.
// This component only ever POSTs a correct set the organizer just chose in
// this form — it never reads one back, so there is nothing for a shared
// component or contestant-facing view model to ever leak.
//
// Deletion changes live event data mid-flight — the question disappears
// from every contestant's board and can no longer be answered — so it is
// gated behind the same `ConfirmModal` + `requireType` pattern the master
// reset uses: Confirm stays disabled until the organizer types the
// question's own id.
//
// What deletion does NOT do: it does not clear contestant history. Points
// already banked for the question stay on the leaderboard, because
// `deleteQuestion` removes only the question and its answer key (see its
// doc comment in quiz-store.ts — that contract is deliberate). Clearing
// banked points is the master reset's job. The confirm copy below says so
// in as many words; keep the two in step.

import { useEffect, useState } from "react";
import type { Choice, Question, QuestionType } from "@/lib/quiz-store";
import ConfirmModal from "@/components/confirm-modal";

type NumericSettingKey = "quizMaxAttempts" | "quizRetryAfterMin";

export type AdminQuizControlsProps = {
  /** Parent-wide "a settings POST is in flight" flag — shared with every
   *  other section's inputs, same as the hint knobs. */
  pending: boolean;
  quizMaxAttemptsInput: string;
  setQuizMaxAttemptsInput: (v: string) => void;
  quizRetryAfterInput: string;
  setQuizRetryAfterInput: (v: string) => void;
  commitNumber: (key: NumericSettingKey, raw: string, reset: (v: string) => void) => void;
  /** Test/first-paint seed only — see header comment. */
  initialQuestions?: Question[];
};

/** Maps a `/api/admin/quiz` response to a message that tells a validation
 *  failure (the organizer's payload was bad — 400) apart from an
 *  infrastructure failure (the store itself is unavailable — 503), so an
 *  organizer is never told "bad request" for a problem that was never
 *  theirs to fix. Exported for direct testing. */
export function describeQuizError(status: number, message?: string): string {
  if (status === 503) {
    return message ? `Store unavailable — ${message}` : "Store unavailable — try again shortly.";
  }
  return message ?? "That didn't work — check the question and try again.";
}

/** The exact copy + gating for the delete confirmation. Typing the
 *  question's own id (not a generic word) forces the organizer to read which
 *  question they're about to remove.
 *
 *  `body` states the real contract, which is narrower than it looks: the
 *  question goes away, banked points do not. Saying otherwise (an earlier
 *  draft claimed it "permanently destroys every contestant's answer and
 *  attempt history") would send an organizer trying to un-award points down
 *  a path that doesn't do that — the master reset is what does. Exported for
 *  direct testing. */
export function questionDeleteConfirm(question: Question): {
  title: string;
  body: string;
  requireType: string;
  confirmLabel: string;
} {
  return {
    title: `Delete "${question.prompt}"?`,
    body:
      "This removes the question from the quiz and hides it from contestants. " +
      "Points already banked for it stay on the leaderboard — to clear those, use the master reset.",
    requireType: question.id,
    confirmLabel: "Delete question",
  };
}

export type ChoiceDraft = Choice;

export type QuestionDraft = {
  id: string;
  prompt: string;
  type: QuestionType;
  points: string;
  order: string;
  choices: ChoiceDraft[];
  correct: string[];
};

export function emptyDraft(nextOrder: number): QuestionDraft {
  return {
    id: "",
    prompt: "",
    type: "single",
    points: "10",
    order: String(nextOrder),
    choices: [
      { id: "a", label: "" },
      { id: "b", label: "" },
    ],
    correct: [],
  };
}

/** Correct answers are never round-tripped from the store (see header
 *  comment) — an edit draft always starts with none marked correct, so the
 *  organizer explicitly re-confirms them on every save. */
export function draftFromQuestion(q: Question): QuestionDraft {
  return {
    id: q.id,
    prompt: q.prompt,
    type: q.type,
    points: String(q.points),
    order: String(q.order),
    choices: q.choices.map((c) => ({ ...c })),
    correct: [],
  };
}

/** Whether `draft` could be submitted as-is. Mirrors the store's own rules
 *  (a `"single"` question needs exactly one correct choice) PLUS basic form
 *  hygiene (non-empty fields, at least two choices, unique choice ids) so an
 *  organizer can't build something the store would reject and only find out
 *  on submit (Requirement 4). Exported for direct testing. */
export function isDraftValid(d: QuestionDraft): boolean {
  if (d.id.trim().length === 0) return false;
  if (d.prompt.trim().length === 0) return false;

  const points = Number(d.points);
  if (d.points.trim() === "" || !Number.isInteger(points) || points < 0) return false;

  const order = Number(d.order);
  if (d.order.trim() === "" || !Number.isInteger(order)) return false;

  if (d.choices.length < 2) return false;
  const ids = new Set<string>();
  for (const c of d.choices) {
    const id = c.id.trim();
    const label = c.label.trim();
    if (id.length === 0 || label.length === 0) return false;
    if (ids.has(id)) return false;
    ids.add(id);
  }

  const correct = d.correct.filter((id) => ids.has(id));
  if (d.type === "single" && correct.length !== 1) return false;
  if (d.type === "multi" && correct.length < 1) return false;

  return true;
}

function sortQuestions(list: Question[]): Question[] {
  return [...list].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function upsertInList(list: Question[], q: Question): Question[] {
  return sortQuestions([...list.filter((x) => x.id !== q.id), q]);
}

async function parseJson<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

export default function AdminQuizControls({
  pending,
  quizMaxAttemptsInput,
  setQuizMaxAttemptsInput,
  quizRetryAfterInput,
  setQuizRetryAfterInput,
  commitNumber,
  initialQuestions = [],
}: AdminQuizControlsProps) {
  const [questions, setQuestions] = useState<Question[]>(() => sortQuestions(initialQuestions));
  const [listError, setListError] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ draft: QuestionDraft; isNew: boolean } | null>(null);
  const [formPending, setFormPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Question | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // First-paint data comes from `initialQuestions` (or, in production, is
  // simply empty); this replaces it with the live list once mounted in the
  // browser. Never runs under `renderToStaticMarkup`.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/quiz");
        const data = await parseJson<{ error?: string; questions?: Question[] }>(res);
        if (cancelled) return;
        if (!res.ok) {
          setListError(describeQuizError(res.status, data.error));
          return;
        }
        setQuestions(sortQuestions(Array.isArray(data.questions) ? data.questions : []));
        setListError(null);
      } catch {
        if (!cancelled) setListError("Couldn't load questions — check your connection and try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const nextOrder = questions.reduce((max, q) => Math.max(max, q.order), 0) + 1;

  async function submitDraft(draft: QuestionDraft) {
    setFormPending(true);
    setFormError(null);
    const payload = {
      id: draft.id.trim(),
      prompt: draft.prompt.trim(),
      type: draft.type,
      choices: draft.choices.map((c) => ({ id: c.id.trim(), label: c.label.trim() })),
      points: Number(draft.points),
      order: Number(draft.order),
      correct: draft.correct,
    };
    try {
      const res = await fetch("/api/admin/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parseJson<{ error?: string; question?: Question }>(res);
      const savedQuestion = data.question;
      if (!res.ok || !savedQuestion) {
        setFormError(describeQuizError(res.status, data.error));
        return;
      }
      setQuestions((prev) => upsertInList(prev, savedQuestion));
      setEditing(null);
    } catch {
      setFormError("Couldn't reach the server — try again.");
    } finally {
      setFormPending(false);
    }
  }

  async function doDelete(id: string) {
    setDeletePending(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/admin/quiz", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await parseJson<{ error?: string }>(res);
      if (!res.ok) {
        setDeleteError(describeQuizError(res.status, data.error));
        return;
      }
      setQuestions((prev) => prev.filter((q) => q.id !== id));
      setDeleteTarget(null);
    } catch {
      setDeleteError("Couldn't reach the server — try again.");
    } finally {
      setDeletePending(false);
    }
  }

  const confirmCopy = deleteTarget ? questionDeleteConfirm(deleteTarget) : null;

  return (
    <>
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="text-white">Max attempts</span>
          <span className="block text-xs text-muted">
            Attempts a contestant gets on a question before the retry gate refuses further submissions. 0 =
            unlimited.
          </span>
        </span>
        <input
          type="number"
          min={0}
          value={quizMaxAttemptsInput}
          disabled={pending}
          onChange={(e) => setQuizMaxAttemptsInput(e.target.value)}
          onBlur={() => commitNumber("quizMaxAttempts", quizMaxAttemptsInput, setQuizMaxAttemptsInput)}
          className="w-28 flex-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-right text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="text-white">Retry after (min)</span>
          <span className="block text-xs text-muted">
            Minutes a contestant must wait after their last attempt before retrying the same question. 0 = no
            cooldown.
          </span>
        </span>
        <input
          type="number"
          min={0}
          value={quizRetryAfterInput}
          disabled={pending}
          onChange={(e) => setQuizRetryAfterInput(e.target.value)}
          onBlur={() => commitNumber("quizRetryAfterMin", quizRetryAfterInput, setQuizRetryAfterInput)}
          className="w-28 flex-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-right text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
        />
      </label>

      <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-white">Questions</span>
          <button
            type="button"
            disabled={formPending}
            onClick={() => setEditing({ draft: emptyDraft(nextOrder), isNew: true })}
            className="rounded-md border border-[#2563eb]/50 px-3 py-1.5 text-sm font-medium text-[#7aa2ff] hover:bg-[#2563eb]/10 disabled:opacity-50"
          >
            Add question
          </button>
        </div>

        {listError && <p className="text-xs text-[#e53e3e]">{listError}</p>}

        {questions.length === 0 ? (
          <p className="text-xs text-muted">No questions yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {questions.map((q) => (
              <li
                key={q.id}
                className="flex items-center justify-between gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{q.prompt}</p>
                  <p className="text-xs text-muted">
                    #{q.order} · {q.type} · {q.points} pt{q.points === 1 ? "" : "s"} · {q.choices.length} choices
                  </p>
                </div>
                <div className="flex flex-none gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing({ draft: draftFromQuestion(q), isNew: false })}
                    className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.04]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteTarget(q);
                    }}
                    className="rounded-md border border-[#e53e3e]/40 px-2 py-1 text-xs text-[#e53e3e] hover:bg-[#e53e3e]/10"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <QuestionForm
          draft={editing.draft}
          isNew={editing.isNew}
          pending={formPending}
          error={formError}
          onChange={(draft) => setEditing({ draft, isNew: editing.isNew })}
          onCancel={() => {
            if (formPending) return;
            setEditing(null);
            setFormError(null);
          }}
          onSubmit={() => void submitDraft(editing.draft)}
        />
      )}

      {deleteTarget && confirmCopy && (
        <ConfirmModal
          title={confirmCopy.title}
          body={
            <>
              {confirmCopy.body}
              {deleteError && <span className="mt-2 block text-[#e53e3e]">{deleteError}</span>}
            </>
          }
          confirmLabel={confirmCopy.confirmLabel}
          requireType={confirmCopy.requireType}
          danger
          pending={deletePending}
          onConfirm={() => void doDelete(deleteTarget.id)}
          onCancel={() => {
            if (deletePending) return;
            setDeleteTarget(null);
            setDeleteError(null);
          }}
        />
      )}
    </>
  );
}

function QuestionForm({
  draft,
  isNew,
  pending,
  error,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: QuestionDraft;
  isNew: boolean;
  pending: boolean;
  error: string | null;
  onChange: (draft: QuestionDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const valid = isDraftValid(draft);
  const singleNeedsExactlyOne = draft.type === "single" && draft.correct.length !== 1;
  const multiNeedsAtLeastOne = draft.type === "multi" && draft.correct.length < 1;

  function setChoice(index: number, patch: Partial<ChoiceDraft>) {
    const choices = draft.choices.map((c, i) => (i === index ? { ...c, ...patch } : c));
    onChange({ ...draft, choices });
  }

  function addChoice() {
    onChange({ ...draft, choices: [...draft.choices, { id: "", label: "" }] });
  }

  function removeChoice(index: number) {
    const removedId = draft.choices[index]?.id;
    const choices = draft.choices.filter((_, i) => i !== index);
    const correct = draft.correct.filter((id) => id !== removedId);
    onChange({ ...draft, choices, correct });
  }

  function toggleCorrect(choiceId: string) {
    if (draft.type === "single") {
      onChange({ ...draft, correct: [choiceId] });
      return;
    }
    const correct = draft.correct.includes(choiceId)
      ? draft.correct.filter((id) => id !== choiceId)
      : [...draft.correct, choiceId];
    onChange({ ...draft, correct });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-[#2563eb]/30 bg-[#2563eb]/[0.04] p-4">
      <h4 className="text-sm font-semibold text-white">{isNew ? "Add question" : `Edit "${draft.id}"`}</h4>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Question id</span>
        <input
          value={draft.id}
          disabled={!isNew || pending}
          onChange={(e) => onChange({ ...draft, id: e.target.value })}
          className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none disabled:opacity-50"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Prompt</span>
        <textarea
          value={draft.prompt}
          disabled={pending}
          onChange={(e) => onChange({ ...draft, prompt: e.target.value })}
          rows={2}
          className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
        />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Type</span>
          <select
            value={draft.type}
            disabled={pending}
            onChange={(e) => onChange({ ...draft, type: e.target.value as QuestionType, correct: [] })}
            className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
          >
            <option value="single">Single choice</option>
            <option value="multi">Multiple choice</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Points</span>
          <input
            type="number"
            min={0}
            value={draft.points}
            disabled={pending}
            onChange={(e) => onChange({ ...draft, points: e.target.value })}
            className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Order</span>
          <input
            type="number"
            value={draft.order}
            disabled={pending}
            onChange={(e) => onChange({ ...draft, order: e.target.value })}
            className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted">
          Choices — select the correct {draft.type === "single" ? "answer" : "answer(s)"}
        </span>
        {draft.choices.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type={draft.type === "single" ? "radio" : "checkbox"}
              name="quiz-draft-correct"
              checked={draft.correct.includes(c.id)}
              disabled={pending || c.id.trim().length === 0}
              onChange={() => toggleCorrect(c.id)}
              className="h-4 w-4 flex-none accent-[#2563eb]"
            />
            <input
              value={c.id}
              placeholder="choice id"
              disabled={pending}
              onChange={(e) => setChoice(i, { id: e.target.value })}
              className="w-24 flex-none rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
            />
            <input
              value={c.label}
              placeholder="label"
              disabled={pending}
              onChange={(e) => setChoice(i, { label: e.target.value })}
              className="flex-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
            />
            <button
              type="button"
              disabled={pending || draft.choices.length <= 2}
              onClick={() => removeChoice(i)}
              className="flex-none rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-400 hover:bg-white/[0.04] disabled:opacity-40"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={pending}
          onClick={addChoice}
          className="self-start rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.04]"
        >
          Add choice
        </button>
        {(singleNeedsExactlyOne || multiNeedsAtLeastOne) && (
          <p className="text-xs text-[#d4a017]">
            {draft.type === "single"
              ? "A single-choice question needs exactly one correct answer selected."
              : "Select at least one correct answer."}
          </p>
        )}
      </div>

      {error && <p className="text-xs text-[#e53e3e]">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/[0.04] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending || !valid}
          className="rounded-md bg-[#2563eb] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Saving…" : isNew ? "Add question" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
