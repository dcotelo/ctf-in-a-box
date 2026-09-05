// The phrase a delete confirmation makes an organizer retype — shared by the
// quiz (a question's prompt), classic and ai (a challenge's title) admin
// panels, which used to carry three copies of the same algorithm.
//
// The phrase is the item's own human-readable text, never its id: reading an
// id back proves only that someone can copy a string, not that they know
// WHICH item is about to disappear, which is the entire job of the gate. The
// truncation is applied ONCE by the caller and the result used for BOTH the
// modal's title and its `requireType`, so what the organizer reads is exactly
// what they must type.

/** Longest phrase the delete confirmation asks an organizer to retype. A
 *  prompt or title can run to a paragraph; making someone transcribe one
 *  verbatim turns a safety gate into a copy-paste ritual, which is the
 *  opposite of making them read it. */
export const DELETE_CONFIRM_PHRASE_MAX = 48;

/** `text`, whitespace-collapsed and — if long — cut at the last word boundary
 *  inside `DELETE_CONFIRM_PHRASE_MAX`.
 *
 *  A blank/whitespace-only `text` yields `fallback`. `ConfirmModal` treats an
 *  empty `requireType` as "no confirmation required", so a challenge with a
 *  blank title would otherwise delete on one click; classic and ai pass the
 *  item's id (always non-empty by its id regex) for exactly that case. The
 *  quiz passes nothing — a question's prompt is required non-empty — and gets
 *  the empty string it always did. */
export function confirmPhrase(text: string, fallback: string = ""): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length === 0) return fallback;
  if (clean.length <= DELETE_CONFIRM_PHRASE_MAX) return clean;
  const cut = clean.slice(0, DELETE_CONFIRM_PHRASE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}
