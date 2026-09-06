"use client";

// The confirmation standing between an open draft and the click that would
// replace it (audit F17).
//
// The module forms render BELOW the list, and every list control stays live
// while one is open, so Edit on another row — or Add — swapped the subject out
// silently. Verified in the audit: text typed into one question's prompt
// vanished the moment Edit was clicked on the next row.
//
// A modal form would also have fixed it, and was not chosen: the
// form-below-the-list layout is deliberate (the organizer reads the list while
// writing against it), and this is the smaller change. One component, three
// panels.
//
// No `requireType`. That gate is for what cannot be undone — deleting a
// challenge, wiping an event. Losing a draft is bad enough to ask about and
// not bad enough to make someone transcribe a phrase, and treating the two
// alike would teach organizers to type through both.

import ConfirmModal from "@/components/confirm-modal";

export default function DiscardDraftConfirm({
  /** What this panel edits, singular and lowercase: "question", "challenge". */
  noun,
  onConfirm,
  onCancel,
}: {
  noun: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmModal
      title={`Discard this ${noun}?`}
      body={`You have unsaved changes. Opening another ${noun} discards them — nothing has been saved yet, and there is no undo.`}
      confirmLabel="Discard changes"
      pending={false}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
