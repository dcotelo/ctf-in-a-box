"use client";

// The Quiz module's admin section: the two retry-gate settings (max attempts,
// retry cooldown) plus full question authoring (add/edit/reorder/delete),
// rendered in place of admin-controls.tsx's old "No settings for this module
// yet." placeholder for the quiz module.
//
// Settings: the numeric inputs reuse `commitNumber` from admin-controls.tsx
// (passed down as a prop, already bound to that component's `settings`/`apply`
// state) — same pattern as the Secure Development hint knobs, not a second
// copy of the same plumbing.
//
// Questions: this component owns its own fetch of GET /api/admin/quiz and its
// own add/edit/reorder/delete state, independent of the settings machinery
// above. `initialQuestions` seeds the list synchronously (used by tests, which
// render with `renderToStaticMarkup` and so never run the mount-time fetch
// below); in the browser it's just the pre-hydration paint, immediately
// replaced by a fresh fetch.
//
// Two authoring fields an organizer used to have to type are now derived, and
// both for the same reason: they were storage plumbing wearing a text input.
//
//   - The question ID is generated from the prompt (`generateQuestionId`, in
//     quiz-keys.ts) when a NEW question is saved. It is the field name in
//     `ctf:quiz:questions` and `ctf:quiz:key` AND the reference every
//     contestant's `ctf:quiz:answers:<login>` row is recorded against, so on an
//     EXISTING question it is immutable: changing it would orphan every answer
//     already banked against the old one, leaving the points on the
//     leaderboard with no question to explain them. That immutability is
//     structural here, not a disabled input: `QuestionDraft` — the thing the
//     form edits — has NO id field at all. The id lives on `QuestionEditor`,
//     which the form never writes to, so `onChange({ ...draft, id })` is not
//     something a future edit to `QuestionForm` can even type.
//   - The ORDER is written from list position. Organizers drag rows (or use
//     the per-row Move up/Move down buttons, which is the keyboard-operable
//     path — drag alone is not operable for everyone, and this is an
//     organizer's control surface). `reorderQuestions` recomputes `order` from
//     the resulting positions and the changed rows are POSTed back. Storage is
//     unchanged: `listQuestions` still sorts by `order`.
//
// Secrecy: this component DOES hold the answer key, and that is deliberate.
// `GET /api/admin/quiz` is behind `requireAdmin` and returns
// `listQuestionsForAdmin()`'s output — one `AdminQuestion` (`{ question,
// correct }`) per question — so opening an existing question for editing
// prefills the choices currently marked correct. The alternative, which this
// component used to implement, was worse than the leak it avoided: an
// organizer fixing a typo in a prompt had to re-pick the answer from memory,
// and getting it wrong silently redefined what counts as correct for every
// contestant, with no diff and no warning. Anyone through the admin gate can
// already delete the question or rewrite its answer outright, so withholding
// the key here bought nothing.
//
// What has NOT changed: the contestant path is keyless, absolutely. `/quiz`
// calls `listQuestions()`, which never reads `ctf:quiz:key`, and builds its
// view model field by field from the public `Question` shape. `AdminQuestion`
// is deliberately NOT assignable to `Question` (see quiz-store.ts), so a
// record from this component cannot be handed to a contestant-facing
// component by mistake — it's a compile error, not a code-review catch.
//
// Deletion changes live event data mid-flight — the question disappears
// from every contestant's board and can no longer be answered — so it is
// gated behind the same `ConfirmModal` + `requireType` pattern the master
// reset uses: Confirm stays disabled until the organizer types the
// question's own PROMPT (see `questionDeleteConfirm`).
//
// What deletion does NOT do: it does not clear contestant history. Points
// already banked for the question stay on the leaderboard, because
// `deleteQuestion` removes only the question and its answer key (see its
// doc comment in quiz-store.ts — that contract is deliberate). Clearing
// banked points is the master reset's job. The confirm copy below says so
// in as many words; keep the two in step.

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { QUIZ_MAX_ATTEMPTS, QUIZ_RETRY_AFTER_MIN } from "@/lib/quiz-defaults";
import type { AdminQuestion, Choice, Question, QuestionType, QuizImportSummary } from "@/lib/quiz-store";
import { generateQuestionId } from "@/lib/quiz-keys";
import { QUIZ_BUNDLE_VERSION, parseBundle, serializeBundle, type ImportError, type QuizBundle } from "@/lib/quiz-io";
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
  initialQuestions?: AdminQuestion[];
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

/** Longest phrase the delete confirmation asks an organizer to retype. A
 *  prompt can run to a paragraph; making someone transcribe one verbatim
 *  turns a safety gate into a copy-paste ritual, which is the opposite of
 *  making them read it. */
export const DELETE_CONFIRM_PHRASE_MAX = 48;

/** The exact string the delete confirmation makes the organizer type:
 *  the question's prompt, whitespace-collapsed and — if long — cut at the
 *  last word boundary inside `DELETE_CONFIRM_PHRASE_MAX`.
 *
 *  The truncation is applied ONCE and the result is used for BOTH the modal's
 *  title and its `requireType`, so what the organizer reads is exactly what
 *  they must type. Deriving the two separately (full prompt to type, short
 *  prompt on screen) would be the ambiguous version. Exported for direct
 *  testing. */
export function confirmPhraseFromPrompt(prompt: string): string {
  const clean = prompt.trim().replace(/\s+/g, " ");
  if (clean.length <= DELETE_CONFIRM_PHRASE_MAX) return clean;
  const cut = clean.slice(0, DELETE_CONFIRM_PHRASE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/** The exact copy + gating for the delete confirmation.
 *
 *  The phrase is the question's PROMPT, not its id. The id used to be typed
 *  here, back when an organizer chose it; now it is generated
 *  (`generateQuestionId`), and asking someone to transcribe
 *  "which-header-mitigates-cl-k3f9qa" proves only that they can copy a string
 *  — it doesn't make them read WHICH question they are about to remove, which
 *  is the entire job of this gate. The prompt does.
 *
 *  The id still appears in `body`, as a fact rather than a task: two questions
 *  whose prompts share a first 48 characters would ask for the same phrase, and
 *  the id is what tells them apart on screen. (Which one actually goes is never
 *  in doubt — the delete is dispatched against the selected row's id, not
 *  against anything typed.)
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
  const phrase = confirmPhraseFromPrompt(question.prompt);
  return {
    title: `Delete "${phrase}"?`,
    body:
      `This removes the question (id ${question.id}) from the quiz and hides it from contestants. ` +
      "Points already banked for it stay on the leaderboard — to clear those, use the master reset.",
    requireType: phrase,
    confirmLabel: "Delete question",
  };
}

export type ChoiceDraft = Choice;

/** Everything about a question that the FORM may change.
 *
 *  Deliberately missing: `id` and `order`. Both are storage plumbing derived
 *  elsewhere (`QuestionEditor` below holds them), and their absence here is
 *  what makes "an edit cannot change a question's id" a property of the types
 *  rather than of a `disabled` attribute somebody could remove. */
export type QuestionDraft = {
  prompt: string;
  type: QuestionType;
  points: string;
  choices: ChoiceDraft[];
  correct: string[];
};

/** The form's whole state: the editable draft plus the identity/position the
 *  form does not own.
 *
 *  A discriminated union rather than `{ id?: string }`, so the id is reachable
 *  only after establishing which case you are in — a NEW question genuinely
 *  has no id yet (it is minted from the prompt at save time), and an EXISTING
 *  one's is fixed. */
export type QuestionEditor =
  | { mode: "new"; order: number; draft: QuestionDraft }
  | { mode: "edit"; id: string; order: number; draft: QuestionDraft };

/** The POST body `/api/admin/quiz` parses. Mirrors that route's
 *  `QuestionPayload` — the route re-validates every field, this type just
 *  keeps the client from assembling something obviously wrong. */
export type QuestionPayload = {
  id: string;
  prompt: string;
  type: QuestionType;
  choices: Choice[];
  points: number;
  order: number;
  correct: string[];
};

export function emptyDraft(): QuestionDraft {
  return {
    prompt: "",
    type: "single",
    points: "10",
    choices: [
      { id: "a", label: "" },
      { id: "b", label: "" },
    ],
    correct: [],
  };
}

/** A brand-new question, positioned at the end of the list. No id: one is
 *  generated from the finished prompt when the draft is submitted, so the
 *  slug reflects what the organizer actually typed rather than whatever the
 *  prompt field held at the moment they clicked "Add question". */
export function newQuestionEditor(nextOrder: number): QuestionEditor {
  return { mode: "new", order: nextOrder, draft: emptyDraft() };
}

/** Seeds an edit draft from an existing question — INCLUDING the choices
 *  currently marked correct, which is the whole point of taking an
 *  `AdminQuestion` here rather than a bare `Question`. Starting a typo fix
 *  with nothing selected made re-picking the answer from memory a required
 *  step of every save, and a wrong guess there silently changed what counts
 *  as correct for every contestant.
 *
 *  `correct` is copied, never aliased: the draft is edited in place as the
 *  organizer toggles choices, and mutating the list row behind it would make
 *  a cancelled edit look saved. */
export function draftFromQuestion({ question: q, correct }: AdminQuestion): QuestionDraft {
  return {
    prompt: q.prompt,
    type: q.type,
    points: String(q.points),
    choices: q.choices.map((c) => ({ ...c })),
    correct: [...correct],
  };
}

/** Opens an existing question for editing: its draft, plus the id and order
 *  the form cannot touch. */
export function editorFromQuestion(row: AdminQuestion): QuestionEditor {
  return { mode: "edit", id: row.question.id, order: row.question.order, draft: draftFromQuestion(row) };
}

/** Whether `draft` could be submitted as-is. Mirrors the store's own rules
 *  (a `"single"` question needs exactly one correct choice) PLUS basic form
 *  hygiene (non-empty fields, at least two choices, unique choice ids) so an
 *  organizer can't build something the store would reject and only find out
 *  on submit (Requirement 4).
 *
 *  No id check any more, and that is not an oversight: a new question's id is
 *  derived from the prompt (which IS checked non-empty) and an existing one's
 *  is fixed, so there is no id for a draft to get wrong. Same for order, which
 *  now comes from list position. Exported for direct testing. */
export function isDraftValid(d: QuestionDraft): boolean {
  if (d.prompt.trim().length === 0) return false;

  const points = Number(d.points);
  if (d.points.trim() === "" || !Number.isInteger(points) || points < 0) return false;

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

/** The POST body for an editor's current state.
 *
 *  The id rule is the whole reason this is a function and not an inline object
 *  literal at the call site: on `mode: "edit"` it is `editor.id`, full stop —
 *  no derivation from the (possibly just-rewritten) prompt, because changing
 *  an id would orphan every answer already recorded against the old one. On
 *  `mode: "new"` it is minted from the prompt.
 *
 *  `newId` is injectable so a test can pin the generated value; production
 *  always uses `generateQuestionId`, whose output is checked against the
 *  store's own `QUIZ_ID_RE` before it is returned. Exported for direct
 *  testing. */
export function payloadFromEditor(
  editor: QuestionEditor,
  newId: (prompt: string) => string = generateQuestionId,
): QuestionPayload {
  const d = editor.draft;
  const prompt = d.prompt.trim();
  return {
    id: editor.mode === "edit" ? editor.id : newId(prompt),
    prompt,
    type: d.type,
    choices: d.choices.map((c) => ({ id: c.id.trim(), label: c.label.trim() })),
    points: Number(d.points),
    order: editor.order,
    correct: d.correct,
  };
}

/** The POST body that re-saves an existing row unchanged apart from whatever
 *  the caller already rewrote on it — used by the reorder path, which changes
 *  `order` and nothing else. Goes through the same endpoint (and therefore
 *  the same validation and audit line) as an edit. */
export function payloadFromRow({ question: q, correct }: AdminQuestion): QuestionPayload {
  return {
    id: q.id,
    prompt: q.prompt,
    type: q.type,
    choices: q.choices.map((c) => ({ ...c })),
    points: q.points,
    order: q.order,
    correct: [...correct],
  };
}

/** Moves the row at `from` to index `to` and rewrites EVERY row's `order`
 *  from its new position (1-based, so the list reads `#1, #2, …`).
 *
 *  Pure, and exported, because it is the whole of the reordering logic: the
 *  drag handlers and the Move up/down buttons only work out a pair of indices
 *  and hand them here. That split is deliberate — this repo has no
 *  testing-library and deliberately does not want one, so drag events cannot
 *  be simulated in a unit test; keeping every decision about what the new
 *  order values ARE inside a plain function means the untestable part is
 *  reduced to "which two numbers get passed in".
 *
 *  Rows whose order is already correct for their new position are returned by
 *  REFERENCE, unchanged. That is what lets the caller persist only the rows
 *  that actually moved (see `changedOrderRows`) instead of re-POSTing the
 *  whole list on every nudge.
 *
 *  An out-of-range index is a no-op: a copy of the list, not a renumbering.
 *  A drag that lands nowhere must not quietly rewrite every row's order. */
export function reorderQuestions(list: readonly AdminQuestion[], from: number, to: number): AdminQuestion[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;

  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);

  return next.map((row, i) =>
    row.question.order === i + 1 ? row : { ...row, question: { ...row.question, order: i + 1 } },
  );
}

/** The rows whose `order` differs between two versions of the list — i.e.
 *  exactly the questions a reorder has to write back. Matched by question id,
 *  never by position (position is the thing that changed). */
export function changedOrderRows(before: readonly AdminQuestion[], after: readonly AdminQuestion[]): AdminQuestion[] {
  const orderById = new Map(before.map((row) => [row.question.id, row.question.order]));
  return after.filter((row) => orderById.get(row.question.id) !== row.question.order);
}

function sortQuestions(list: AdminQuestion[]): AdminQuestion[] {
  return [...list].sort((a, b) => a.question.order - b.question.order || a.question.id.localeCompare(b.question.id));
}

function upsertInList(list: AdminQuestion[], row: AdminQuestion): AdminQuestion[] {
  return sortQuestions([...list.filter((x) => x.question.id !== row.question.id), row]);
}

async function parseJson<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

/** Builds a bundle from the question bank this component already holds, so
 *  the export button's handler is a thin binding around a pure function —
 *  the same shape `payloadFromEditor`/`reorderQuestions` are pure for the
 *  same reason: `renderToStaticMarkup` cannot exercise a click handler, so
 *  the logic worth testing has to live outside one. Mirrors `exportBundle`
 *  in quiz-store.ts field for field (that one reads the store server-side;
 *  this one reads client state), so an export built here round-trips through
 *  `parseBundle` exactly like a server-side export would. Exported for
 *  direct testing. */
export function exportBundleFrom(rows: readonly AdminQuestion[]): QuizBundle {
  return {
    version: QUIZ_BUNDLE_VERSION,
    questions: rows.map(({ question: q, correct }) => ({
      id: q.id,
      prompt: q.prompt,
      type: q.type,
      choices: q.choices.map((c) => ({ id: c.id, label: c.label })),
      points: q.points,
      order: q.order,
      correct,
    })),
  };
}

/** Formats a `QuizImportSummary` into the panel's after-import message. Pure
 *  for the same reason `exportBundleFrom` just above is: `importResult` is
 *  `useState`, which `renderToStaticMarkup` can never reach, so the
 *  pluralization branch has to live outside a render tree to be exercised by
 *  a test at all. Exported for direct testing. */
export function formatImportSummary({ created, updated }: QuizImportSummary): string {
  const total = created + updated;
  const questionWord = total === 1 ? "question" : "questions";
  return `Imported ${total} ${questionWord}: ${created} created, ${updated} updated.`;
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
  const [questions, setQuestions] = useState<AdminQuestion[]>(() => sortQuestions(initialQuestions));
  const [listError, setListError] = useState<string | null>(null);

  const [editing, setEditing] = useState<QuestionEditor | null>(null);
  const [formPending, setFormPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [reorderPending, setReorderPending] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Question | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [importText, setImportText] = useState("");
  const [importPending, setImportPending] = useState(false);
  const [importErrors, setImportErrors] = useState<ImportError[] | null>(null);
  const [importResult, setImportResult] = useState<QuizImportSummary | null>(null);

  /** Re-reads the whole bank from the server and replaces local state with
   *  it. Used both by the mount effect below and after a bulk import — an
   *  import can create and update an arbitrary number of rows at once, so
   *  hand-patching local state from the summary counts would be inventing a
   *  second, weaker copy of what the store just did.
   *
   *  `cancelled` is passed in rather than closed over so the mount effect can
   *  still abandon an in-flight load on unmount, while the import path (which
   *  awaits its own call) simply passes nothing. */
  async function loadQuestions(isCancelled: () => boolean = () => false) {
    try {
      const res = await fetch("/api/admin/quiz");
      const data = await parseJson<{ error?: string; questions?: AdminQuestion[] }>(res);
      if (isCancelled()) return;
      if (!res.ok) {
        setListError(describeQuizError(res.status, data.error));
        return;
      }
      setQuestions(sortQuestions(Array.isArray(data.questions) ? data.questions : []));
      setListError(null);
    } catch {
      if (!isCancelled()) setListError("Couldn't load questions — check your connection and try again.");
    }
  }

  // First-paint data comes from `initialQuestions` (or, in production, is
  // simply empty); this replaces it with the live list once mounted in the
  // browser. Never runs under `renderToStaticMarkup`.
  useEffect(() => {
    let cancelled = false;
    void loadQuestions(() => cancelled);
    return () => {
      cancelled = true;
    };
    // `loadQuestions` is redeclared each render and only ever setStates, so
    // depending on it would re-fetch the bank on every keystroke in the
    // import textarea. This is a mount-once load, as it always was.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextOrder = questions.reduce((max, q) => Math.max(max, q.question.order), 0) + 1;

  async function postQuestion(payload: QuestionPayload): Promise<{ ok: true; row: AdminQuestion } | { ok: false; message: string }> {
    try {
      const res = await fetch("/api/admin/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parseJson<{ error?: string; question?: Question; correct?: string[] }>(res);
      if (!res.ok || !data.question) return { ok: false, message: describeQuizError(res.status, data.error) };
      // The route echoes the STORED (deduped, sorted) correct set alongside
      // the question; falling back to the payload's own set would leave the
      // list holding something the store never wrote.
      return { ok: true, row: { question: data.question, correct: data.correct ?? payload.correct } };
    } catch {
      return { ok: false, message: "Couldn't reach the server — try again." };
    }
  }

  /** Retires a bulk-import summary once anything else writes to the bank.
   *
   *  The summary describes ONE write. It used to be cleared only by the
   *  import panel's own controls (a new import, typing in the textarea,
   *  choosing a file), so it outlived every add, edit, reorder and delete —
   *  and an organizer who imported a question and then deleted it was left
   *  reading "Imported 1 question: 0 created, 1 updated." under a list that
   *  no longer contained it (#127).
   *
   *  Nothing is miscounted by that and the store is always correct, but the
   *  panel's one job is to say exactly what a bulk write did, and a stale
   *  success line invites the worst reading: that the delete also imported
   *  something. The rule: a summary of a write does not outlive the next
   *  write. Errors go with it — a resolved import error is as stale as a
   *  resolved success. */
  function retireImportSummary() {
    setImportResult(null);
    setImportErrors(null);
  }

  async function submitEditor(editor: QuestionEditor) {
    setFormPending(true);
    setFormError(null);
    const result = await postQuestion(payloadFromEditor(editor));
    setFormPending(false);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    setQuestions((prev) => upsertInList(prev, result.row));
    retireImportSummary();
    setEditing(null);
  }

  /** Applies a move optimistically, then writes back only the rows whose
   *  order actually changed. Any failure restores the pre-move list rather
   *  than leaving the panel showing an arrangement the store doesn't have. */
  async function moveQuestion(from: number, to: number) {
    if (from === to || reorderPending) return;
    const before = questions;
    const after = reorderQuestions(before, from, to);
    const changed = changedOrderRows(before, after);
    if (changed.length === 0) return;

    setQuestions(after);
    retireImportSummary();
    setReorderPending(true);
    setListError(null);
    for (const row of changed) {
      const result = await postQuestion(payloadFromRow(row));
      if (!result.ok) {
        setQuestions(before);
        setListError(result.message);
        setReorderPending(false);
        return;
      }
    }
    setReorderPending(false);
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
      setQuestions((prev) => prev.filter((q) => q.question.id !== id));
      retireImportSummary();
      setDeleteTarget(null);
    } catch {
      setDeleteError("Couldn't reach the server — try again.");
    } finally {
      setDeletePending(false);
    }
  }

  /** The export button's whole handler: build the bundle from the bank this
   *  component already holds (`exportBundleFrom`), serialize it, and hand it
   *  to the browser as a download. Entirely client-side — no endpoint round
   *  trip, so the answer keys already in memory never cross the network a
   *  second time just to be downloaded again. The object URL is revoked right
   *  after triggering the download (deferred one tick so the browser has
   *  actually started it): an un-revoked URL keeps the whole Blob pinned in
   *  memory for the rest of the page's life. Mirrors the classic panel's. */
  function handleExport() {
    const text = serializeBundle(exportBundleFrom(questions));
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "quiz-questions.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /** Reads a chosen `.json` file client-side and drops its text straight into
   *  the same textarea the paste path uses, so both paths share one
   *  validation/submit flow below. Clears the input's value afterward so
   *  choosing the SAME file again (e.g. after editing it on disk) still
   *  fires a change event. */
  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    setImportText(text);
    setImportResult(null);
    setImportErrors(null);
  }

  /** Sends the raw pasted/uploaded text to the server exactly as the wire
   *  contract requires — `{ import: <raw text> }`, the ONLY key in the body —
   *  never a pre-parsed object; the route re-validates with the same
   *  `parseBundle` this component already ran client-side (see
   *  `clientValidation` below), which is what makes it safe to accept text
   *  from a client whose own validation could in principle be skipped or
   *  stale. On success the list is refreshed from the server rather than
   *  hand-mutated, so this panel can never drift from the store. */
  async function submitImport() {
    setImportPending(true);
    setImportErrors(null);
    setImportResult(null);
    try {
      const res = await fetch("/api/admin/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ import: importText }),
      });
      const data = await parseJson<{ errors?: ImportError[]; error?: string; created?: number; updated?: number }>(res);
      if (res.ok) {
        setImportResult({ created: data.created ?? 0, updated: data.updated ?? 0 });
        setImportText("");
        await loadQuestions();
        return;
      }
      if (Array.isArray(data.errors)) {
        setImportErrors(data.errors);
        return;
      }
      setImportErrors([{ where: "(request)", message: describeQuizError(res.status, data.error) }]);
    } catch {
      setImportErrors([{ where: "(request)", message: "Couldn't reach the server — try again." }]);
    } finally {
      setImportPending(false);
    }
  }

  // Convenience only, run client-side before the button is even enabled — the
  // server re-validates the raw text regardless (see `submitImport`'s
  // comment), so this can never be the only gate. Skipped entirely on an
  // empty textarea so the panel doesn't greet an organizer who hasn't typed
  // anything yet with a wall of "must be an array" errors.
  const clientValidation = importText.trim().length > 0 ? parseBundle(importText) : null;
  const clientImportErrors = clientValidation && !clientValidation.ok ? clientValidation.errors : null;
  const canImport = clientValidation !== null && clientValidation.ok;

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
          placeholder={String(QUIZ_MAX_ATTEMPTS)}
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
          placeholder={String(QUIZ_RETRY_AFTER_MIN)}
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
            onClick={() => setEditing(newQuestionEditor(nextOrder))}
            className="rounded-md border border-[#2563eb]/50 px-3 py-1.5 text-sm font-medium text-[#7aa2ff] hover:bg-[#2563eb]/10 disabled:opacity-50"
          >
            Add question
          </button>
        </div>

        {listError && <p className="text-xs text-[#e53e3e]">{listError}</p>}

        {questions.length === 0 ? (
          <p className="text-xs text-muted">No questions yet.</p>
        ) : (
          <>
            <p className="text-xs text-muted">
              Drag a question to reorder it, or use Move up / Move down. Contestants see them in this order.
            </p>
            <ul className="flex flex-col gap-2">
              {questions.map((row, i) => (
                // The collapsed list shows the public half only — which choice
                // is correct appears when the organizer opens the edit form,
                // not on a panel that might be on a projector.
                <li
                  key={row.question.id}
                  draggable={!reorderPending}
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null) void moveQuestion(dragIndex, i);
                    setDragIndex(null);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  className="flex items-center justify-between gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="flex-none cursor-grab text-zinc-500">
                      ⠿
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white">{row.question.prompt}</p>
                      <p className="text-xs text-muted">
                        #{row.question.order} · {row.question.type} · {row.question.points} pt
                        {row.question.points === 1 ? "" : "s"} · {row.question.choices.length} choices
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-none gap-2">
                    {/* The keyboard path. Dragging is a mouse gesture and
                        cannot be the only way to reorder an organizer's own
                        content, so every row carries real buttons that move
                        it one place — same `reorderQuestions` call the drop
                        handler makes. */}
                    <button
                      type="button"
                      aria-label={`Move "${row.question.prompt}" up`}
                      disabled={reorderPending || i === 0}
                      onClick={() => void moveQuestion(i, i - 1)}
                      className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.04] disabled:opacity-40"
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      aria-label={`Move "${row.question.prompt}" down`}
                      disabled={reorderPending || i === questions.length - 1}
                      onClick={() => void moveQuestion(i, i + 1)}
                      className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.04] disabled:opacity-40"
                    >
                      Move down
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(editorFromQuestion(row))}
                      className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.04]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(row.question);
                      }}
                      className="rounded-md border border-[#e53e3e]/40 px-2 py-1 text-xs text-[#e53e3e] hover:bg-[#e53e3e]/10"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Collapsed by default: an organizer authoring one question at a time
          shouldn't have to scroll past a bulk panel to reach the list. Note
          the `<details>` rather than a `{open && ...}` toggle — `<details>`
          renders its children into the markup regardless of whether it is
          open (the collapse is native browser behavior, not conditional React
          rendering), so this stays collapsible for an organizer AND fully
          present for a `renderToStaticMarkup` test. Same choice, for the same
          reason, as the classic panel's. */}
      <details className="flex flex-col gap-3 border-t border-white/[0.06] pt-4">
        <summary className="cursor-pointer text-sm font-medium text-white">Bulk import / export</summary>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted">
              Downloads every question currently in the bank as one JSON file, correct answers included.
            </span>
            <button
              type="button"
              disabled={questions.length === 0}
              onClick={handleExport}
              className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/[0.04] disabled:opacity-40"
            >
              Export questions
            </button>
          </div>

          <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3">
            <span className="text-sm text-white">Import a bundle</span>
            {/* THE notice a shorter file could otherwise be misread against:
                see the header comment on `importBundle` in quiz-store.ts —
                this is the client-side statement of the same guarantee. */}
            <p className="text-xs text-muted">
              Import never deletes existing questions — anything already in the bank that isn&rsquo;t in the file is
              left untouched. Max attempts and Retry after are not part of a bundle: importing one never changes
              the retry gate you set above.
            </p>

            <textarea
              value={importText}
              disabled={importPending}
              onChange={(e) => {
                setImportText(e.target.value);
                setImportResult(null);
                setImportErrors(null);
              }}
              rows={6}
              placeholder="Paste a bundle's JSON here, or choose a file below."
              className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-xs text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
            />

            <input
              type="file"
              accept=".json"
              disabled={importPending}
              onChange={(e) => void handleFileChange(e)}
              className="text-xs text-zinc-300"
            />

            {clientImportErrors && clientImportErrors.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs text-[#e53e3e]">
                {clientImportErrors.map((err, i) => (
                  <li key={i}>
                    {err.where}: {err.message}
                  </li>
                ))}
              </ul>
            )}

            {importErrors && importErrors.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs text-[#e53e3e]">
                {importErrors.map((err, i) => (
                  <li key={i}>
                    {err.where}: {err.message}
                  </li>
                ))}
              </ul>
            )}

            {importResult && <p className="text-xs text-[#7aa2ff]">{formatImportSummary(importResult)}</p>}

            <button
              type="button"
              disabled={importPending || !canImport}
              onClick={() => void submitImport()}
              className="self-start rounded-md bg-[#2563eb] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {importPending ? "Importing…" : "Import bundle"}
            </button>
          </div>
        </div>
      </details>

      {editing && (
        <QuestionForm
          editor={editing}
          pending={formPending}
          error={formError}
          onChange={(draft) => setEditing({ ...editing, draft })}
          onCancel={() => {
            if (formPending) return;
            setEditing(null);
            setFormError(null);
          }}
          onSubmit={() => void submitEditor(editing)}
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
  editor,
  pending,
  error,
  onChange,
  onCancel,
  onSubmit,
}: {
  editor: QuestionEditor;
  pending: boolean;
  error: string | null;
  // Takes a DRAFT, not an editor: this form cannot express a change to the
  // question's id or its position, which is what keeps an existing question's
  // id immutable no matter how this component is edited later.
  onChange: (draft: QuestionDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const draft = editor.draft;
  const isNew = editor.mode === "new";
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
      <h4 className="text-sm font-semibold text-white">
        {editor.mode === "new" ? "Add question" : `Edit "${confirmPhraseFromPrompt(draft.prompt)}"`}
      </h4>

      {/* The id, shown and never editable. On an existing question it is the
          reference every banked answer points at, so changing it would orphan
          them; on a new one it does not exist yet. Either way there is no
          input here — see the header comment. */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">Question id</span>
        {editor.mode === "edit" ? (
          <>
            <code className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-zinc-300">
              {editor.id}
            </code>
            <span className="text-xs text-muted">
              Fixed for the life of the question — contestants&rsquo; answers are recorded against it.
            </span>
          </>
        ) : (
          <span className="text-xs text-muted">Generated from the prompt when you save.</span>
        )}
      </div>

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
        {/* Position used to be a number input here. It is now set by dragging
            (or Move up / Move down) in the list above, so the form states
            where this question sits and offers nothing to type. */}
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Position</span>
          <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-zinc-300">
            {isNew ? `#${editor.order} (last)` : `#${editor.order}`}
          </span>
        </div>
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
