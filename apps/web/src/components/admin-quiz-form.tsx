"use client";

// The quiz panel's add/edit form: prompt, type, points, the read-only
// position, and the choices with their correct-answer selection — on the
// shared EditorFrame/IdBlock and fields (components/admin). Takes a DRAFT
// (`QuestionDraft`) and can therefore never express a change to a question's
// id or position; see admin-quiz-controls.tsx's header for why that matters.

import type { QuestionType } from "@/lib/quiz-store";
import EditorFrame, { EDITOR_FOCUS_ATTR, IdBlock, editorHeading } from "@/components/admin/editor-frame";
import { INPUT_CLASS, NumberField, PositionReadout } from "@/components/admin/editor-fields";
import {
  type ChoiceDraft,
  type QuestionDraft,
  type QuestionEditor,
  confirmPhraseFromPrompt,
  isDraftValid,
} from "@/components/admin-quiz-model";

export default function QuestionForm({
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
        {/* Claims the open-focus explicitly: this is the form's first real
            field but it is a textarea, and EditorFrame's fallback selector
            sees only text inputs — of which the first one here is a choice
            id. */}
        <textarea
          {...{ [EDITOR_FOCUS_ATTR]: "" }}
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
