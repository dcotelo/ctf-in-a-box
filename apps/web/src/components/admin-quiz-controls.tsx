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

import { useEffect } from "react";
import { QUIZ_MAX_ATTEMPTS, QUIZ_RETRY_AFTER_MIN } from "@/lib/quiz-defaults";
import type { AdminQuestion, Choice, Question, QuestionType, QuizImportSummary } from "@/lib/quiz-store";
import { generateQuestionId } from "@/lib/quiz-keys";
import { QUIZ_BUNDLE_VERSION, parseBundle, serializeBundle, type QuizBundle } from "@/lib/quiz-io";
import ConfirmDelete from "@/components/admin/confirm-delete";
import ImportPanel from "@/components/admin/import-panel";
import { downloadJson, useBundleImport } from "@/components/admin/use-bundle-import";
import SortableList from "@/components/admin/sortable-list";
import EditorFrame, { IdBlock, editorHeading } from "@/components/admin/editor-frame";
import { INPUT_CLASS, NumberField, PositionReadout } from "@/components/admin/editor-fields";
import type { ModuleInventory } from "@/components/admin-module-setup";
import AdminNumberField, { type FieldStatus } from "@/components/admin-number-field";
import { describeAdminError } from "@/components/admin/fetch";
import { useAdminResource } from "@/components/admin/use-admin-resource";
import { DELETE_CONFIRM_PHRASE_MAX, confirmPhrase } from "@/components/admin/confirm-phrase";
import { type RowAccessors, changedOrderRows as changedRows, reorderRows } from "@/components/admin/ordered-rows";

type NumericSettingKey = "quizMaxAttempts" | "quizRetryAfterMin";

export type AdminQuizControlsProps = {
  /** Parent-wide "a settings POST is in flight" flag — shared with every
   *  other section's inputs, same as the hint knobs. */
  pending: boolean;
  quizMaxAttemptsInput: string;
  setQuizMaxAttemptsInput: (v: string) => void;
  quizRetryAfterInput: string;
  setQuizRetryAfterInput: (v: string) => void;
  commitNumber: (key: NumericSettingKey, raw: string, reset: (v: string) => void, label: string) => void;
  /** The shell's per-field save status, by stored key (UX audit F2). Optional
   *  so a static render without a shell still works; idle when absent. */
  statusOf?: (key: string) => FieldStatus;
  /** Test/first-paint seed only — see header comment. */
  initialQuestions?: AdminQuestion[];
  /** Reports the bank's size to the shell for the setup checklist above this
   *  panel, AFTER the mount-time fetch has settled and again on every change
   *  — never from the pre-hydration seed, which would report an empty bank
   *  for the second before the real list lands. */
  onInventory?: (inventory: ModuleInventory) => void;
};

/** What this panel tells the shell about its content. Pure, so the shape is
 *  provable without running the effect that sends it. Exported for direct
 *  testing. */
export function quizInventory(rows: readonly AdminQuestion[]): ModuleInventory {
  return { items: rows.length };
}

/** Maps a `/api/admin/quiz` response to a message that tells a validation
 *  failure (the organizer's payload was bad — 400) apart from an
 *  infrastructure failure (the store itself is unavailable — 503), so an
 *  organizer is never told "bad request" for a problem that was never
 *  theirs to fix. Exported for direct testing. */
export function describeQuizError(status: number, message?: string): string {
  return describeAdminError(status, message, "That didn't work — check the question and try again.");
}

export { DELETE_CONFIRM_PHRASE_MAX };

/** The exact string the delete confirmation makes the organizer type: the
 *  question's prompt, through the shared `confirmPhrase` (whitespace-collapsed,
 *  cut at a word boundary inside `DELETE_CONFIRM_PHRASE_MAX`). No fallback:
 *  a prompt is required non-empty, so there is nothing to fall back from.
 *  Exported for direct testing. */
export function confirmPhraseFromPrompt(prompt: string): string {
  return confirmPhrase(prompt);
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

/** Where a quiz row keeps its id and position — the one thing that
 *  distinguishes this panel's list arithmetic from classic's and ai's (see
 *  components/admin/ordered-rows.ts). */
const QUESTION_ROWS: RowAccessors<AdminQuestion> = {
  id: (row) => row.question.id,
  order: (row) => row.question.order,
  withOrder: (row, order) => ({ ...row, question: { ...row.question, order } }),
};

/** Moves the row at `from` to index `to` and rewrites EVERY row's `order`
 *  from its new position (1-based) — the shared `reorderRows` over quiz rows.
 *  Pure and exported so the drag handlers and Move up/down buttons only ever
 *  work out a pair of indices (see the shared module's header for why). */
export function reorderQuestions(list: readonly AdminQuestion[], from: number, to: number): AdminQuestion[] {
  return reorderRows(list, from, to, QUESTION_ROWS);
}

/** The rows whose `order` differs between two versions of the list — exactly
 *  the questions a reorder has to write back. Matched by question id. */
export function changedOrderRows(before: readonly AdminQuestion[], after: readonly AdminQuestion[]): AdminQuestion[] {
  return changedRows(before, after, QUESTION_ROWS);
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
  statusOf = () => ({ state: "idle" }),
  initialQuestions = [],
  onInventory,
}: AdminQuizControlsProps) {
  // The bank, the open editor, the delete target and every write over them
  // live in the shared resource hook (components/admin/use-admin-resource.ts).
  // What is quiz-shaped is the config: the endpoint, where a row keeps its
  // id/order, how the route's replies map to rows, and the payload builders
  // above. `initialQuestions` seeds the first paint; the hook's mount-time
  // GET replaces it in the browser (never under `renderToStaticMarkup`).
  const resource = useAdminResource<AdminQuestion, Question, QuestionEditor, QuestionPayload>({
    endpoint: "/api/admin/quiz",
    describeError: describeQuizError,
    rows: QUESTION_ROWS,
    parseList: (data) => ({ rows: Array.isArray(data.questions) ? (data.questions as AdminQuestion[]) : [], categories: [] }),
    loadErrorMessage: "Couldn't load questions — check your connection and try again.",
    // The route echoes the STORED (deduped, sorted) correct set alongside
    // the question; falling back to the payload's own set would leave the
    // list holding something the store never wrote.
    parseUpsert: (data, payload) => {
      const question = data.question as Question | undefined;
      if (!question) return null;
      return { question, correct: (data.correct as string[] | undefined) ?? payload.correct };
    },
    toPayload: payloadFromEditor,
    rowPayload: payloadFromRow,
    initialRows: initialQuestions,
    initialCategories: [],
    // A summary of a write does not outlive the next write (#127).
    onWrite: () => bundleImport.retire(),
  });
  const { rows: questions, loaded, listError, editing, formPending, deleteTarget, reorderPending, nextOrder } = resource;

  // The bulk import/export flow (textarea, file pick, `{import}` POST,
  // after-import summary) — see components/admin/use-bundle-import.ts. On
  // success the bank is re-read from the server, never hand-patched.
  const bundleImport = useBundleImport<QuizImportSummary>({
    endpoint: "/api/admin/quiz",
    describeError: describeQuizError,
    parse: parseBundle,
    parseSummary: (reply) => ({ created: reply.created ?? 0, updated: reply.updated ?? 0 }),
    afterImport: resource.reload,
  });

  // Report the bank's size upward whenever it changes, once it is real. The
  // callback is the parent's, so this is a report to a subscriber, not a
  // setState of this component's own.
  useEffect(() => {
    if (loaded) onInventory?.(quizInventory(questions));
  }, [loaded, questions, onInventory]);

  const confirmCopy = deleteTarget ? questionDeleteConfirm(deleteTarget) : null;

  return (
    <>
      <AdminNumberField
        id="quiz-max-attempts"
        label="Max attempts"
        help="Attempts a contestant gets on a question before the retry gate refuses further submissions. 0 = unlimited."
        value={quizMaxAttemptsInput}
        placeholder={String(QUIZ_MAX_ATTEMPTS)}
        disabled={pending}
        status={statusOf("quizMaxAttempts")}
        onChange={setQuizMaxAttemptsInput}
        onBlur={() => commitNumber("quizMaxAttempts", quizMaxAttemptsInput, setQuizMaxAttemptsInput, "Max attempts")}
      />

      <AdminNumberField
        id="quiz-retry-after-min"
        label="Retry after (min)"
        help="Minutes a contestant must wait after their last attempt before retrying the same question. 0 = no cooldown."
        value={quizRetryAfterInput}
        placeholder={String(QUIZ_RETRY_AFTER_MIN)}
        disabled={pending}
        status={statusOf("quizRetryAfterMin")}
        onChange={setQuizRetryAfterInput}
        onBlur={() => commitNumber("quizRetryAfterMin", quizRetryAfterInput, setQuizRetryAfterInput, "Retry after (min)")}
      />

      <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-white">Questions</span>
          <button
            type="button"
            disabled={formPending}
            onClick={() => resource.setEditing(newQuestionEditor(nextOrder))}
            className="rounded-md border border-[#2563eb]/45 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/[0.06] disabled:opacity-50"
          >
            Add question
          </button>
        </div>

        {listError && <p className="text-xs text-[#e53e3e]">{listError}</p>}

        {/* The collapsed list shows the public half only — which choice is
            correct appears when the organizer opens the edit form, not on a
            panel that might be on a projector. */}
        <SortableList<AdminQuestion>
          rows={questions}
          keyOf={(row) => row.question.id}
          titleOf={(row) => row.question.prompt}
          meta={(row) => (
            <>
              #{row.question.order} · {row.question.type} · {row.question.points} pt
              {row.question.points === 1 ? "" : "s"} · {row.question.choices.length} choices
            </>
          )}
          intro="Drag a question to reorder it, or use Move up / Move down. Contestants see them in this order."
          emptyText="No questions yet."
          reorderPending={reorderPending}
          onMove={(from, to) => void resource.move(from, to)}
          onEdit={(row) => resource.setEditing(editorFromQuestion(row))}
          onDelete={(row) => resource.requestDelete(row.question)}
        />
      </div>

      <ImportPanel
        exportDescription="Downloads every question currently in the bank as one JSON file, correct answers included."
        exportLabel="Export questions"
        exportDisabled={questions.length === 0}
        onExport={() => downloadJson(serializeBundle(exportBundleFrom(questions)), "quiz-questions.json")}
        notice={
          <>
            Import never deletes existing questions — anything already in the bank that isn&rsquo;t in the file is
            left untouched. Max attempts and Retry after are not part of a bundle: importing one never changes
            the retry gate you set above.
          </>
        }
        text={bundleImport.text}
        pending={bundleImport.pending}
        clientErrors={bundleImport.clientErrors}
        serverErrors={bundleImport.serverErrors}
        summary={bundleImport.result ? formatImportSummary(bundleImport.result) : null}
        canImport={bundleImport.canImport}
        onText={bundleImport.setText}
        onFile={(e) => void bundleImport.handleFile(e)}
        onSubmit={() => void bundleImport.submit()}
      />

      {editing && (
        <QuestionForm
          editor={editing}
          pending={formPending}
          error={resource.formError}
          onChange={(draft) => resource.setEditing({ ...editing, draft })}
          onCancel={resource.cancelEditor}
          onSubmit={() => void resource.submitEditor(editing)}
        />
      )}

      {deleteTarget && confirmCopy && (
        <ConfirmDelete
          copy={confirmCopy}
          error={resource.deleteError}
          pending={resource.deletePending}
          onConfirm={() => void resource.remove(deleteTarget.id)}
          onCancel={resource.cancelDelete}
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
  const set = (patch: Partial<QuestionDraft>) => onChange({ ...draft, ...patch });
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
    <EditorFrame
      heading={editorHeading(isNew, "Add question", confirmPhraseFromPrompt(draft.prompt))}
      focusKey={editor.mode === "edit" ? editor.id : "new"}
      pending={pending}
      valid={isDraftValid(draft)}
      isNew={isNew}
      addLabel="Add question"
      error={error}
      onCancel={onCancel}
      onSubmit={onSubmit}
    >
      <IdBlock
        label="Question id"
        id={editor.mode === "edit" ? editor.id : undefined}
        fixedHelp="Fixed for the life of the question — contestants’ answers are recorded against it."
        generatedHelp="Generated from the prompt when you save."
      />

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Prompt</span>
        <textarea
          value={draft.prompt}
          disabled={pending}
          onChange={(e) => set({ prompt: e.target.value })}
          rows={2}
          className={INPUT_CLASS}
        />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Type</span>
          <select
            value={draft.type}
            disabled={pending}
            onChange={(e) => set({ type: e.target.value as QuestionType, correct: [] })}
            className={INPUT_CLASS}
          >
            <option value="single">Single choice</option>
            <option value="multi">Multiple choice</option>
          </select>
        </label>
        <NumberField label="Points" value={draft.points} disabled={pending} onChange={(points) => set({ points })} />
        {/* Position is set by dragging (or Move up / Move down) in the list
            above, so the form states where this question sits and offers
            nothing to type. */}
        <PositionReadout order={editor.order} isNew={isNew} />
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
              className="w-24 flex-none rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
            />
            <input
              value={c.label}
              placeholder="label"
              disabled={pending}
              onChange={(e) => setChoice(i, { label: e.target.value })}
              className="flex-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
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
    </EditorFrame>
  );
}
