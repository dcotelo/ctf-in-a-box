"use client";

// Re-exported from admin-ai-controls.tsx so the masking/mode-gating/preview
// properties can be proven directly against the SAME component this module
// renders — not a copy — without first driving the parent's `editing`
// useState open. Mirrors classic's exported `ChallengeForm`; see this
// component's test file header comment for why.
//
// Built on the shared EditorFrame/IdBlock and fields (components/admin);
// takes a DRAFT (`AiChallengeDraft`) and can therefore never express a
// change to a challenge's id. Event-mode hides the flag and case-sensitivity
// inputs (the store discards both for that mode).

import { AI_MODES, AI_POINTS_MAX, validateUrlTemplate, type AiMode } from "@/lib/ai-keys";
import EditorFrame, { IdBlock, editorHeading } from "@/components/admin/editor-frame";
import {
  CaseSensitiveField,
  CategorySelect,
  DescriptionField,
  FlagField,
  HintField,
  INPUT_CLASS,
  MONO_INPUT_CLASS,
  NumberField,
  TextField,
} from "@/components/admin/editor-fields";
import { confirmPhrase } from "@/components/admin/confirm-phrase";
import {
  AI_MODE_LABELS,
  type AiChallengeDraft,
  type AiChallengeEditor,
  isAiDraftValid,
} from "@/components/admin-ai-model";

export function AiChallengeForm({
  editor,
  categories,
  pending,
  error,
  flagRevealed,
  setFlagRevealed,
  onChange,
  onCancel,
  onSubmit,
}: {
  editor: AiChallengeEditor;
  categories: readonly string[];
  pending: boolean;
  error: string | null;
  flagRevealed: boolean;
  setFlagRevealed: (v: boolean) => void;
  // Takes a DRAFT, not an editor: this form cannot express a change to the
  // challenge's id, which is what keeps an existing challenge's id immutable
  // no matter how this component is edited later.
  onChange: (draft: AiChallengeDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const draft = editor.draft;
  const isNew = editor.mode === "new";
  const set = (patch: Partial<AiChallengeDraft>) => onChange({ ...draft, ...patch });
  const urlCheck = validateUrlTemplate(draft.urlTemplate);
  const graded = draft.mode !== "event";
  const phrase = editor.mode === "edit" ? confirmPhrase(draft.title, editor.id) : "";

  return (
    <EditorFrame
      heading={editorHeading(isNew, "Add challenge", phrase)}
      focusKey={editor.mode === "edit" ? editor.id : "new"}
      pending={pending}
      valid={isAiDraftValid(draft)}
      isNew={isNew}
      addLabel="Add challenge"
      error={error}
      onCancel={onCancel}
      onSubmit={onSubmit}
    >
      <IdBlock
        label="Challenge id"
        id={editor.mode === "edit" ? editor.id : undefined}
        fixedHelp={
          <>
            Fixed for the life of the challenge — contestants&rsquo; solves and any external integration&rsquo;s
            signing key are pinned to it.
          </>
        }
        generatedHelp="Generated from the title when you save."
      />

      <TextField label="Title" value={draft.title} disabled={pending} onChange={(title) => set({ title })} />

      <div className="flex gap-3">
        <CategorySelect value={draft.category} categories={categories} disabled={pending} onChange={(category) => set({ category })} />
        <NumberField label="Points" value={draft.points} max={AI_POINTS_MAX} disabled={pending} onChange={(points) => set({ points })} />
        <NumberField label="Position" value={draft.order} disabled={pending} onChange={(order) => set({ order })} />
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Solve mode</span>
        <select
          value={draft.mode}
          disabled={pending}
          onChange={(e) => set({ mode: e.target.value as AiMode })}
          className={INPUT_CLASS}
        >
          {AI_MODES.map((m) => (
            <option key={m} value={m}>
              {AI_MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">
          Launch URL — must contain <code className="rounded bg-white/10 px-1 text-white">{"{token}"}</code>, which
          is replaced with the minted launch token.
        </span>
        <input
          value={draft.urlTemplate}
          disabled={pending}
          onChange={(e) => set({ urlTemplate: e.target.value })}
          className={MONO_INPUT_CLASS}
        />
        {!urlCheck.ok && <p className="text-xs text-[#e53e3e]">{urlCheck.reason}</p>}
      </label>

      {graded ? (
        <>
          {/* Masked, reveal-only, defaulting off on every fresh open (the
              parent force-remounts via `key`). */}
          <FlagField
            value={draft.flag}
            revealed={flagRevealed}
            onToggle={() => setFlagRevealed(!flagRevealed)}
            disabled={pending}
            onChange={(flag) => set({ flag })}
          />

          <CaseSensitiveField
            checked={draft.caseSensitive}
            disabled={pending}
            onChange={(caseSensitive) => set({ caseSensitive })}
            help={
              <>
                Off by default, which forgives the commonest contestant mistake. Turn it on only when the
                capitalisation IS the answer. Leading and trailing spaces are still forgiven either way.
              </>
            }
          />
        </>
      ) : (
        <p className="text-xs text-muted">
          Event-mode challenges take no flag — solves arrive from the external site.
        </p>
      )}

      <HintField value={draft.hint} disabled={pending} onChange={(hint) => set({ hint })} />

      <DescriptionField value={draft.description} disabled={pending} onChange={(description) => set({ description })} />
    </EditorFrame>
  );
}
