"use client";

// The Classic CTF module's admin section: the submission-cooldown knob plus
// full challenge authoring (add/edit/reorder/delete) and category management,
// rendered in place of admin-controls.tsx's old "No settings for this module
// yet." placeholder for the classic module. Modeled directly on
// admin-quiz-controls.tsx — same shape of problem (list, drag-sort, keyboard
// reorder, editor form, delete confirmation) — with the differences classic's
// own shape forces:
//
//   - No choices/correct answer. A challenge has a category (drawn from an
//     organizer-managed list), a Markdown description, a point value, and a
//     flag.
//   - The wire contract is THREE payload shapes on ONE endpoint
//     (`POST /api/admin/classic`), dispatched by the server on exact key set:
//     `{categories: string[]}` (exactly one key) replaces the category list;
//     `{import: <raw text>}` (exactly one key) bulk-imports a pasted/uploaded
//     bundle, parsed and validated by `parseBundle` before anything is
//     written; anything else is parsed as a challenge-plus-flag upsert
//     against `CHALLENGE_KEYS` (see that route's header comment). This
//     component's `postCategories` and `postChallenge` helpers exist
//     specifically so every categories POST carries exactly `{categories}`
//     and nothing else — a stray extra key would fall through to the next
//     parser in line and 400.
//   - Categories can be removed only while nothing references them. The
//     store itself does not enforce this (`setCategories` just validates and
//     dedupes the list), so the refusal lives here, client-side, computed
//     from the challenge list this component already holds.
//
// Settings: `classicCooldownSecInput` reuses `commitNumber` from
// admin-controls.tsx exactly like the quiz retry knobs — passed down as a
// prop, already bound to that component's `settings`/`apply` state.
//
// Challenges: this component owns its own fetch of GET /api/admin/classic and
// its own add/edit/reorder/delete state, independent of the settings
// machinery above. `initialChallenges`/`initialCategories` seed the lists
// synchronously (used by tests, which render with `renderToStaticMarkup` and
// so never run the mount-time fetch below); in the browser they are just the
// pre-hydration paint, immediately replaced by a fresh fetch.
//
// No id field, ever. A challenge id is generated from its title
// (`generateChallengeId`, in classic-keys.ts) when a NEW challenge is saved.
// It is the field name in `ctf:classic:challenges`/`ctf:classic:flag`/
// `ctf:classic:flagnorm` AND the reference every contestant's
// `ctf:classic:solves:<login>` row is recorded against, so on an EXISTING
// challenge it is immutable — changing it would orphan every solve already
// banked against the old one. `ChallengeDraft` — the thing the form edits —
// has NO id field at all, mirroring `QuestionDraft`.
//
// The ORDER is written from list position, same as quiz: organizers drag
// rows (or use the per-row Move up/Move down buttons — the keyboard-operable
// path, and not optional). `reorderChallenges` recomputes `order` from the
// resulting positions and the changed rows are POSTed back.
//
// Secrecy: this component DOES hold the flag, and that is deliberate.
// `GET /api/admin/classic` is behind `requireAdmin` and returns
// `listChallengesForAdmin()`'s output — one `AdminChallenge`
// (`{ challenge, flag }`) per challenge — so opening an existing challenge
// for editing prefills the flag currently in force. The alternative — an
// edit form that starts blank — is worse than the leak it avoids: an
// organizer fixing a typo would have to retype the whole flag from memory,
// and getting it wrong silently redefines what counts as solved for every
// contestant, with no diff and no warning. Anyone through the admin gate can
// already rewrite or delete the flag outright, so withholding it here buys
// nothing. The flag INPUT is still masked (`type="password"`, reveal toggle)
// because an organizer editing this panel may well be screen-sharing it.
//
// What has NOT changed: the contestant path is flagless, absolutely. `/flags`
// calls `listChallenges()`, which never reads `ctf:classic:flag` or
// `ctf:classic:flagnorm`, and the `Challenge` type it returns has nowhere to
// put a flag even if it tried. `AdminChallenge` is deliberately NOT
// assignable to `Challenge` (see classic-store.ts) — reaching the public half
// takes an explicit `.challenge`, so a record from THIS component cannot be
// handed to a contestant-facing component by mistake; it's a compile error,
// not a code-review catch.
//
// Deletion changes live event data mid-flight — the challenge disappears from
// every contestant's board and can no longer be submitted against — so it is
// gated behind the same `ConfirmModal` + `requireType` pattern the master
// reset and quiz's question delete use: Confirm stays disabled until the
// organizer types the challenge's own TITLE. `ConfirmModal` reads an EMPTY
// `requireType` as "no confirmation required" (see its own comment), so a
// challenge with a blank/whitespace-only title would delete on one click if
// the phrase were derived from the title alone — `confirmPhraseFromTitle`
// falls back to the challenge's id (always non-empty, `CLASSIC_ID_RE`) for
// exactly that case.
//
// What deletion does NOT do: it does not clear contestant history. Points
// already banked for the challenge stay on the leaderboard, because
// `deleteChallenge` removes only the challenge and its flag rows (see its doc
// comment in classic-store.ts). Clearing banked points is the master reset's
// job. The confirm copy below says so in as many words; keep the two in step.

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { CLASSIC_COOLDOWN_SEC } from "@/lib/classic-defaults";
// Type-only import: `classic-store.ts` is `server-only`, but a `import type`
// is fully erased at compile time — no runtime import ever reaches the
// client bundle. This is the same pattern admin-quiz-controls.tsx uses for
// `@/lib/quiz-store`. Never change this to a value import.
import type { AdminChallenge, Challenge, ImportSummary } from "@/lib/classic-store";
import { generateChallengeId, CLASSIC_POINTS_MAX } from "@/lib/classic-keys";
import { CLASSIC_BUNDLE_VERSION, parseBundle, serializeBundle, type ClassicBundle, type ImportError } from "@/lib/classic-io";
import { MARKDOWN_MAX } from "@/lib/markdown";
import Markdown from "@/components/markdown";
import ConfirmModal from "@/components/confirm-modal";

// `CLASSIC_POINTS_MAX` is re-exported (not just imported) because this
// component's OWN test file imports it from here, mirroring how the rest of
// this module's helpers are exported for direct testing.
export { CLASSIC_POINTS_MAX };

type NumericSettingKey = "classicCooldownSec";

export type AdminClassicControlsProps = {
  /** Parent-wide "a settings POST is in flight" flag — shared with every
   *  other section's inputs, same as the quiz retry knobs. */
  pending: boolean;
  classicCooldownSecInput: string;
  setClassicCooldownSecInput: (v: string) => void;
  commitNumber: (key: NumericSettingKey, raw: string, reset: (v: string) => void) => void;
  /** Test/first-paint seed only — see header comment. */
  initialChallenges?: AdminChallenge[];
  initialCategories?: string[];
};

/** Maps a `/api/admin/classic` response to a message that tells a validation
 *  failure (the organizer's payload was bad — 400) apart from an
 *  infrastructure failure (the store itself is unavailable — 503), mirroring
 *  `describeQuizError`. */
export function describeClassicError(status: number, message?: string): string {
  if (status === 503) {
    return message ? `Store unavailable — ${message}` : "Store unavailable — try again shortly.";
  }
  return message ?? "That didn't work — check the challenge and try again.";
}

/** Longest phrase the delete confirmation asks an organizer to retype,
 *  mirroring `DELETE_CONFIRM_PHRASE_MAX` in admin-quiz-controls.tsx. */
export const DELETE_CONFIRM_PHRASE_MAX = 48;

/** The exact string the delete confirmation makes the organizer type: the
 *  challenge's title, whitespace-collapsed and truncated at a word boundary
 *  like `confirmPhraseFromPrompt` — EXCEPT that a blank/whitespace-only title
 *  falls back to `fallbackId` instead of an empty string.
 *
 *  That fallback is the whole guard: `ConfirmModal` treats an empty
 *  `requireType` as "no confirmation required" (ConfirmModal's own comment),
 *  so a challenge whose title is empty or all whitespace would otherwise
 *  delete on a single click with no typed confirmation at all. `fallbackId`
 *  is always non-empty (`CLASSIC_ID_RE` requires 1-64 chars), so the guard
 *  can never itself produce the empty string it exists to avoid. Exported
 *  for direct testing. */
export function confirmPhraseFromTitle(title: string, fallbackId: string): string {
  const clean = title.trim().replace(/\s+/g, " ");
  if (clean.length === 0) return fallbackId;
  if (clean.length <= DELETE_CONFIRM_PHRASE_MAX) return clean;
  const cut = clean.slice(0, DELETE_CONFIRM_PHRASE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/** The exact copy + gating for the delete confirmation. Mirrors
 *  `questionDeleteConfirm`: the phrase is the challenge's TITLE (falling back
 *  to its id — see `confirmPhraseFromTitle`), never its id by preference,
 *  because reading the id back proves only that the organizer can copy a
 *  string, not that they know WHICH challenge is about to disappear. The id
 *  still appears in `body` as a fact, since two challenges can share a title
 *  prefix. Exported for direct testing. */
export function challengeDeleteConfirm(challenge: Challenge): {
  title: string;
  body: string;
  requireType: string;
  confirmLabel: string;
} {
  const phrase = confirmPhraseFromTitle(challenge.title, challenge.id);
  return {
    title: `Delete "${phrase}"?`,
    body:
      `This removes the challenge (id ${challenge.id}) from the board and hides it from contestants. ` +
      "Points already banked for it stay on the leaderboard — to clear those, use the master reset.",
    requireType: phrase,
    confirmLabel: "Delete challenge",
  };
}

/** Everything about a challenge that the FORM may change.
 *
 *  Deliberately missing: `id` and `order`, mirroring `QuestionDraft` — both
 *  are storage plumbing derived elsewhere, and their absence here is what
 *  makes "an edit cannot change a challenge's id" a property of the types
 *  rather than of a `disabled` attribute somebody could remove. */
export type ChallengeDraft = {
  title: string;
  category: string;
  description: string;
  points: string;
  flag: string;
  /** Compare the flag with capitalisation intact (issue #193). A plain boolean
   *  rather than the string every other field here is: those are strings
   *  because a number input can hold "" mid-edit, which a checkbox cannot. */
  caseSensitive: boolean;
};

/** The form's whole state: the editable draft plus the identity/position the
 *  form does not own. A discriminated union rather than `{ id?: string }`, so
 *  the id is reachable only after establishing which case you are in — a NEW
 *  challenge genuinely has no id yet (minted from the title at save time),
 *  and an EXISTING one's is fixed. */
export type ChallengeEditor =
  | { mode: "new"; order: number; draft: ChallengeDraft }
  | { mode: "edit"; id: string; order: number; draft: ChallengeDraft };

/** The POST body `/api/admin/classic` parses for a challenge upsert. Mirrors
 *  that route's `ChallengePayload` (its exported `CHALLENGE_KEYS` names the
 *  exact key set) — this type just keeps the client from assembling something
 *  obviously wrong. */
export type ChallengePayload = {
  id: string;
  title: string;
  category: string;
  description: string;
  points: number;
  order: number;
  flag: string;
  caseSensitive?: boolean;
};

export function emptyDraft(defaultCategory: string = ""): ChallengeDraft {
  return { title: "", category: defaultCategory, description: "", points: "10", flag: "", caseSensitive: false };
}

/** A brand-new challenge, positioned at the end of the list. No id: one is
 *  generated from the finished title when the draft is submitted. */
export function newChallengeEditor(nextOrder: number, defaultCategory: string = ""): ChallengeEditor {
  return { mode: "new", order: nextOrder, draft: emptyDraft(defaultCategory) };
}

/** Seeds an edit draft from an existing challenge — INCLUDING its flag, which
 *  is the whole point of taking an `AdminChallenge` here rather than a bare
 *  `Challenge`. Starting a typo fix with a blank flag box forces the
 *  organizer to retype the whole thing from memory, and a mistake there
 *  silently redefines what counts as solved for every contestant. */
export function draftFromChallenge({ challenge: c, flag }: AdminChallenge): ChallengeDraft {
  return {
    title: c.title,
    category: c.category,
    description: c.description,
    points: String(c.points),
    flag,
    // Coerced, because the stored field is absent-when-false and a checkbox
    // needs a real boolean — an `undefined` here makes React switch the input
    // from controlled to uncontrolled the first time it is ticked.
    caseSensitive: c.caseSensitive === true,
  };
}

/** Opens an existing challenge for editing: its draft, plus the id and order
 *  the form cannot touch. */
export function editorFromChallenge(row: AdminChallenge): ChallengeEditor {
  return { mode: "edit", id: row.challenge.id, order: row.challenge.order, draft: draftFromChallenge(row) };
}

/** Whether `draft` could be submitted as-is, mirroring the store's own rules
 *  (`upsertChallenge`) PLUS basic form hygiene, so an organizer can't build
 *  something the store would reject and only find out on submit.
 *
 *  `categories` is the CURRENT category list — a category the organizer
 *  removed after opening this draft must fail validation rather than silently
 *  resubmit a now-unknown one. Exported for direct testing. */
export function isDraftValid(d: ChallengeDraft, categories: readonly string[]): boolean {
  if (d.title.trim().length === 0) return false;
  if (!categories.includes(d.category)) return false;
  if (d.description.length > MARKDOWN_MAX) return false;

  const points = Number(d.points);
  if (d.points.trim() === "" || !Number.isInteger(points) || points < 0 || points > CLASSIC_POINTS_MAX) return false;

  if (d.flag.trim().length === 0) return false;

  return true;
}

/** The POST body for an editor's current state.
 *
 *  The id rule mirrors `payloadFromEditor` in admin-quiz-controls.tsx: on
 *  `mode: "edit"` it is `editor.id`, full stop — never re-derived from a
 *  (possibly just-rewritten) title, because changing an id would orphan every
 *  solve already recorded against the old one. On `mode: "new"` it is minted
 *  from the title.
 *
 *  `newId` is injectable so a test can pin the generated value; production
 *  always uses `generateChallengeId`. Exported for direct testing. */
export function payloadFromEditor(
  editor: ChallengeEditor,
  newId: (title: string) => string = generateChallengeId,
): ChallengePayload {
  const d = editor.draft;
  const title = d.title.trim();
  return {
    id: editor.mode === "edit" ? editor.id : newId(title),
    title,
    category: d.category,
    description: d.description,
    points: Number(d.points),
    order: editor.order,
    flag: d.flag,
    // Sent only when true, matching the route's parser and the store's stored
    // shape — one challenge has one representation whichever door it came
    // through, so an unchanged challenge re-saved from this form produces a
    // byte-identical record.
    ...(d.caseSensitive ? { caseSensitive: true as const } : {}),
  };
}

/** The POST body that re-saves an existing row unchanged apart from whatever
 *  the caller already rewrote on it — used by the reorder path, which changes
 *  `order` and nothing else. Goes through the same endpoint (and therefore
 *  the same validation and audit line) as an edit. Carries the row's own
 *  flag: the upsert endpoint requires `flag` as one of `CHALLENGE_KEYS`, and a
 *  reorder must not silently blank or rewrite it. */
export function payloadFromRow({ challenge: c, flag }: AdminChallenge): ChallengePayload {
  return { id: c.id, title: c.title, category: c.category, description: c.description, points: c.points, order: c.order, flag };
}

/** Moves the row at `from` to index `to` and rewrites EVERY row's `order`
 *  from its new position (1-based). Mirrors `reorderQuestions` exactly —
 *  see that function's comment for why this is a pure, exported function
 *  rather than logic living inside a drag handler. */
export function reorderChallenges(list: readonly AdminChallenge[], from: number, to: number): AdminChallenge[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;

  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);

  return next.map((row, i) =>
    row.challenge.order === i + 1 ? row : { ...row, challenge: { ...row.challenge, order: i + 1 } },
  );
}

/** The rows whose `order` differs between two versions of the list — exactly
 *  the challenges a reorder has to write back. Matched by challenge id, never
 *  by position. */
export function changedOrderRows(before: readonly AdminChallenge[], after: readonly AdminChallenge[]): AdminChallenge[] {
  const orderById = new Map(before.map((row) => [row.challenge.id, row.challenge.order]));
  return after.filter((row) => orderById.get(row.challenge.id) !== row.challenge.order);
}

function sortChallenges(list: AdminChallenge[]): AdminChallenge[] {
  return [...list].sort((a, b) => a.challenge.order - b.challenge.order || a.challenge.id.localeCompare(b.challenge.id));
}

function upsertInList(list: AdminChallenge[], row: AdminChallenge): AdminChallenge[] {
  return sortChallenges([...list.filter((x) => x.challenge.id !== row.challenge.id), row]);
}

/** The exact request body a categories POST sends: EXACTLY one key,
 *  `categories`. This is the whole client-side half of the wire contract
 *  Task 7's route pins (`POST /api/admin/classic` dispatches on
 *  `Object.keys(body).length === 1 && keys[0] === "categories"`) — the
 *  route's exported `CATEGORIES_KEYS` names the same single key. A second key
 *  here, however added, would silently fall through to the challenge-upsert
 *  parser and get rejected with a 400 rather than replacing the category
 *  list. Exported so it is the ONE place `postCategories` builds this body
 *  from, and so a test can drive it straight into the real route (see the
 *  route-level wire-contract test in this component's test file) rather than
 *  only asserting on its own shape. */
export function categoriesRequestBody(categories: readonly string[]): { categories: string[] } {
  return { categories: [...categories] };
}

/** How many challenges currently file under `category` — what lets category
 *  removal refuse with an exact count instead of a vague warning, and what
 *  makes that refusal possible at all: `setCategories` (classic-store.ts)
 *  does not itself check for references, so this component is the only place
 *  that does. Exported for direct testing. */
export function categoryUsageCount(challenges: readonly AdminChallenge[], category: string): number {
  return challenges.filter((row) => row.challenge.category === category).length;
}

async function parseJson<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

/** Builds a bundle from the board this component already holds — `rows`
 *  (each carrying its flag, same as `payloadFromRow`'s input) and the current
 *  category list — so the export button's download handler is a thin
 *  binding around a pure function, the same shape `payloadFromEditor`/
 *  `reorderChallenges` are pure for the same reason: `renderToStaticMarkup`
 *  cannot exercise a click handler, so the logic worth testing has to live
 *  outside one. Mirrors `exportBundle` in classic-store.ts field for field —
 *  that one reads the store server-side; this one reads client state — so an
 *  export built here round-trips through `parseBundle` exactly like a
 *  server-side export would. Exported for direct testing. */
export function exportBundleFrom(rows: readonly AdminChallenge[], categories: readonly string[]): ClassicBundle {
  return {
    version: CLASSIC_BUNDLE_VERSION,
    categories: [...categories],
    challenges: rows.map(({ challenge: c, flag }) => ({
      id: c.id,
      title: c.title,
      category: c.category,
      description: c.description,
      points: c.points,
      order: c.order,
      flag,
    })),
  };
}

/** Formats an `ImportSummary` into the panel's after-import message. Pure for
 *  the same reason `exportBundleFrom` just above is: `importResult` is
 *  `useState`, which `renderToStaticMarkup` can never reach, so the
 *  pluralization branch (and the created/updated interpolation next to it)
 *  has to live outside a render tree to be exercised by a test at all.
 *  Exported for direct testing. */
export function formatImportSummary({ created, updated, categories }: ImportSummary): string {
  const categoryWord = categories === 1 ? "category" : "categories";
  return `Imported: ${created} created, ${updated} updated. (${categories} ${categoryWord} listed in the file.)`;
}

export default function AdminClassicControls({
  pending,
  classicCooldownSecInput,
  setClassicCooldownSecInput,
  commitNumber,
  initialChallenges = [],
  initialCategories = [],
}: AdminClassicControlsProps) {
  const [challenges, setChallenges] = useState<AdminChallenge[]>(() => sortChallenges(initialChallenges));
  const [categories, setCategories] = useState<string[]>(initialCategories);
  const [listError, setListError] = useState<string | null>(null);

  const [editing, setEditing] = useState<ChallengeEditor | null>(null);
  const [formPending, setFormPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [flagRevealed, setFlagRevealed] = useState(false);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [reorderPending, setReorderPending] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Challenge | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [newCategoryInput, setNewCategoryInput] = useState("");
  const [categoryPending, setCategoryPending] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const [importText, setImportText] = useState("");
  const [importPending, setImportPending] = useState(false);
  const [importErrors, setImportErrors] = useState<ImportError[] | null>(null);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);

  /** Re-fetches the challenge and category lists from the store, the same GET
   *  the mount-time effect below runs. Shared with the bulk-import success
   *  path so a successful import refreshes from the server rather than
   *  hand-mutating local state — the store, not this component's memory of
   *  what it just sent, is the source of truth for what actually landed.
   *  `isCancelled` lets the mount effect skip its own setState calls after
   *  unmount, mirroring that effect's original guard. */
  async function refreshLists(isCancelled: () => boolean = () => false): Promise<void> {
    try {
      const res = await fetch("/api/admin/classic");
      const data = await parseJson<{ error?: string; challenges?: AdminChallenge[]; categories?: string[] }>(res);
      if (isCancelled()) return;
      if (!res.ok) {
        setListError(describeClassicError(res.status, data.error));
        return;
      }
      setChallenges(sortChallenges(Array.isArray(data.challenges) ? data.challenges : []));
      setCategories(Array.isArray(data.categories) ? data.categories : []);
      setListError(null);
    } catch {
      if (!isCancelled()) setListError("Couldn't load challenges — check your connection and try again.");
    }
  }

  // First-paint data comes from `initialChallenges`/`initialCategories` (or,
  // in production, is simply empty); this replaces it with the live data
  // once mounted in the browser. Never runs under `renderToStaticMarkup`.
  useEffect(() => {
    let cancelled = false;
    void refreshLists(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, []);

  const nextOrder = challenges.reduce((max, c) => Math.max(max, c.challenge.order), 0) + 1;

  async function postChallenge(payload: ChallengePayload): Promise<{ ok: true; row: AdminChallenge } | { ok: false; message: string }> {
    try {
      const res = await fetch("/api/admin/classic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parseJson<{ error?: string; challenge?: Challenge; flag?: string }>(res);
      if (!res.ok || !data.challenge) return { ok: false, message: describeClassicError(res.status, data.error) };
      // The route echoes the STORED (trimmed) flag alongside the challenge;
      // falling back to the payload's own flag would leave the list holding
      // something the store never actually wrote.
      return { ok: true, row: { challenge: data.challenge, flag: data.flag ?? payload.flag } };
    } catch {
      return { ok: false, message: "Couldn't reach the server — try again." };
    }
  }

  /** Retires a bulk-import summary once anything else writes to the bank.
   *  Mirrors `retireImportSummary` in admin-quiz-controls.tsx — the two
   *  panels mirror each other deliberately, and #127 was present in both.
   *  A summary of a write must not outlive the next write. */
  function retireImportSummary() {
    setImportResult(null);
    setImportErrors(null);
  }

  async function submitEditor(editor: ChallengeEditor) {
    setFormPending(true);
    setFormError(null);
    const result = await postChallenge(payloadFromEditor(editor));
    setFormPending(false);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    setChallenges((prev) => upsertInList(prev, result.row));
    retireImportSummary();
    setEditing(null);
  }

  /** Applies a move optimistically, then writes back only the rows whose
   *  order actually changed. Any failure restores the pre-move list. Mirrors
   *  `moveQuestion` in admin-quiz-controls.tsx. */
  async function moveChallenge(from: number, to: number) {
    if (from === to || reorderPending) return;
    const before = challenges;
    const after = reorderChallenges(before, from, to);
    const changed = changedOrderRows(before, after);
    if (changed.length === 0) return;

    setChallenges(after);
    retireImportSummary();
    setReorderPending(true);
    setListError(null);
    for (const row of changed) {
      const result = await postChallenge(payloadFromRow(row));
      if (!result.ok) {
        setChallenges(before);
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
      const res = await fetch("/api/admin/classic", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await parseJson<{ error?: string }>(res);
      if (!res.ok) {
        setDeleteError(describeClassicError(res.status, data.error));
        return;
      }
      setChallenges((prev) => prev.filter((c) => c.challenge.id !== id));
      retireImportSummary();
      setDeleteTarget(null);
    } catch {
      setDeleteError("Couldn't reach the server — try again.");
    } finally {
      setDeletePending(false);
    }
  }

  /** POSTs the category list. This is the ONLY place in this component that
   *  builds a categories body, and it builds EXACTLY `{categories}` — the
   *  server's dispatch requires that shape have no other key (see the header
   *  comment), so a second key here would silently fall through to the
   *  challenge-upsert parser and 400. */
  async function postCategories(next: string[]): Promise<{ ok: true; categories: string[] } | { ok: false; message: string }> {
    try {
      const res = await fetch("/api/admin/classic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(categoriesRequestBody(next)),
      });
      const data = await parseJson<{ error?: string; categories?: string[] }>(res);
      if (!res.ok || !Array.isArray(data.categories)) return { ok: false, message: describeClassicError(res.status, data.error) };
      return { ok: true, categories: data.categories };
    } catch {
      return { ok: false, message: "Couldn't reach the server — try again." };
    }
  }

  async function applyCategories(next: string[]) {
    const before = categories;
    setCategories(next);
    setCategoryPending(true);
    setCategoryError(null);
    const result = await postCategories(next);
    setCategoryPending(false);
    if (!result.ok) {
      setCategories(before);
      setCategoryError(result.message);
      return;
    }
    setCategories(result.categories);
  }

  function addCategory() {
    const name = newCategoryInput.trim();
    if (!name) return;
    if (categories.some((c) => c.toLowerCase() === name.toLowerCase())) {
      setCategoryError(`"${name}" is already a category.`);
      return;
    }
    setNewCategoryInput("");
    void applyCategories([...categories, name]);
  }

  /** Refuses to remove a category still in use, naming exactly how many
   *  challenges reference it — the store itself does not check this (see
   *  `categoryUsageCount`'s comment), so this is the only guard there is. */
  function removeCategory(name: string) {
    const count = categoryUsageCount(challenges, name);
    if (count > 0) {
      setCategoryError(
        `Can't remove "${name}" — ${count} challenge${count === 1 ? "" : "s"} still ${count === 1 ? "uses" : "use"} it. Reassign or delete ${count === 1 ? "it" : "them"} first.`,
      );
      return;
    }
    setCategoryError(null);
    void applyCategories(categories.filter((c) => c !== name));
  }

  function moveCategory(from: number, to: number) {
    if (to < 0 || to >= categories.length) return;
    const next = [...categories];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setCategoryError(null);
    void applyCategories(next);
  }

  /** The export button's whole handler: build the bundle from the board this
   *  component already holds (`exportBundleFrom`), serialize it, and hand it
   *  to the browser as a download. Entirely client-side — no endpoint round
   *  trip, so an organizer's own flags never cross the network a second time
   *  just to be downloaded again. The object URL is revoked right after
   *  triggering the download (deferred one tick so the browser has actually
   *  started the download first): an un-revoked URL keeps the whole Blob
   *  pinned in memory for the rest of the page's life. */
  function handleExport() {
    const text = serializeBundle(exportBundleFrom(challenges, categories));
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "classic-challenges.json";
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
   *  contract requires — `{ import: <raw text> }`, the ONLY key in the body
   *  — never a pre-parsed object; the route re-validates with the same
   *  `parseBundle` this component already ran client-side (see
   *  `clientValidation` below), which is what makes it safe to accept text
   *  from a client whose own validation could in principle be skipped or
   *  stale. On success, the lists are refreshed from the server rather than
   *  hand-mutated, so this panel can never drift from the store. */
  async function submitImport() {
    setImportPending(true);
    setImportErrors(null);
    setImportResult(null);
    try {
      const res = await fetch("/api/admin/classic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ import: importText }),
      });
      const data = await parseJson<{
        errors?: ImportError[];
        error?: string;
        created?: number;
        updated?: number;
        categories?: number;
      }>(res);
      if (res.ok) {
        setImportResult({ created: data.created ?? 0, updated: data.updated ?? 0, categories: data.categories ?? 0 });
        setImportText("");
        await refreshLists();
        return;
      }
      if (Array.isArray(data.errors)) {
        setImportErrors(data.errors);
        return;
      }
      setImportErrors([{ where: "(request)", message: describeClassicError(res.status, data.error) }]);
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

  const confirmCopy = deleteTarget ? challengeDeleteConfirm(deleteTarget) : null;

  return (
    <>
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="text-white">Submission cooldown (sec)</span>
          <span className="block text-xs text-muted">
            Seconds a contestant must wait between flag submissions on the same challenge. 0 = no cooldown.
          </span>
        </span>
        <input
          type="number"
          min={0}
          value={classicCooldownSecInput}
          placeholder={String(CLASSIC_COOLDOWN_SEC)}
          disabled={pending}
          onChange={(e) => setClassicCooldownSecInput(e.target.value)}
          onBlur={() => commitNumber("classicCooldownSec", classicCooldownSecInput, setClassicCooldownSecInput)}
          className="w-28 flex-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-right text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
        />
      </label>

      <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-white">Categories</span>
        </div>
        {categoryError && <p className="text-xs text-[#e53e3e]">{categoryError}</p>}
        {categories.length === 0 ? (
          <p className="text-xs text-muted">No categories yet — add one before authoring a challenge.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {categories.map((name, i) => (
              <li
                key={name}
                className="flex items-center justify-between gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
              >
                <span className="truncate text-sm text-white">{name}</span>
                <div className="flex flex-none gap-2">
                  <button
                    type="button"
                    aria-label={`Move "${name}" up`}
                    disabled={categoryPending || i === 0}
                    onClick={() => moveCategory(i, i - 1)}
                    className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.04] disabled:opacity-40"
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    aria-label={`Move "${name}" down`}
                    disabled={categoryPending || i === categories.length - 1}
                    onClick={() => moveCategory(i, i + 1)}
                    className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.04] disabled:opacity-40"
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    disabled={categoryPending}
                    onClick={() => removeCategory(name)}
                    className="rounded-md border border-[#e53e3e]/40 px-2 py-1 text-xs text-[#e53e3e] hover:bg-[#e53e3e]/10 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            value={newCategoryInput}
            placeholder="New category"
            disabled={categoryPending}
            onChange={(e) => setNewCategoryInput(e.target.value)}
            className="flex-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
          />
          <button
            type="button"
            disabled={categoryPending || newCategoryInput.trim().length === 0}
            onClick={addCategory}
            className="rounded-md border border-[#2563eb]/50 px-3 py-1.5 text-sm font-medium text-[#7aa2ff] hover:bg-[#2563eb]/10 disabled:opacity-50"
          >
            Add category
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-white">Challenges</span>
          <button
            type="button"
            disabled={formPending || categories.length === 0}
            onClick={() => {
              setFlagRevealed(false);
              setEditing(newChallengeEditor(nextOrder, categories[0] ?? ""));
            }}
            className="rounded-md border border-[#2563eb]/50 px-3 py-1.5 text-sm font-medium text-[#7aa2ff] hover:bg-[#2563eb]/10 disabled:opacity-50"
          >
            Add challenge
          </button>
        </div>

        {listError && <p className="text-xs text-[#e53e3e]">{listError}</p>}

        {challenges.length === 0 ? (
          <p className="text-xs text-muted">No challenges yet.</p>
        ) : (
          <>
            <p className="text-xs text-muted">
              Drag a challenge to reorder it, or use Move up / Move down. Contestants see them in this order.
            </p>
            <ul className="flex flex-col gap-2">
              {challenges.map((row, i) => (
                // The collapsed list shows the public half only — the flag
                // appears when the organizer opens the edit form, not on a
                // panel that might be on a projector.
                <li
                  key={row.challenge.id}
                  draggable={!reorderPending}
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null) void moveChallenge(dragIndex, i);
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
                      <p className="truncate text-sm text-white">{row.challenge.title}</p>
                      <p className="text-xs text-muted">
                        #{row.challenge.order} · {row.challenge.category} · {row.challenge.points} pt
                        {row.challenge.points === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-none gap-2">
                    {/* The keyboard path. Dragging is a mouse gesture and
                        cannot be the only way to reorder an organizer's own
                        content, so every row carries real buttons that move
                        it one place — same `reorderChallenges` call the drop
                        handler makes. */}
                    <button
                      type="button"
                      aria-label={`Move "${row.challenge.title}" up`}
                      disabled={reorderPending || i === 0}
                      onClick={() => void moveChallenge(i, i - 1)}
                      className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.04] disabled:opacity-40"
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      aria-label={`Move "${row.challenge.title}" down`}
                      disabled={reorderPending || i === challenges.length - 1}
                      onClick={() => void moveChallenge(i, i + 1)}
                      className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.04] disabled:opacity-40"
                    >
                      Move down
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFlagRevealed(false);
                        setEditing(editorFromChallenge(row));
                      }}
                      className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.04]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(row.challenge);
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

      {/* Collapsible via the native <details>/<summary> pair rather than a
          `useState` toggle: a `useState`-gated section never appears in a
          `renderToStaticMarkup` render (see the test file's header comment),
          but the controls here need to be provable statically. `<details>`
          renders its children into the markup regardless of whether it is
          open — the collapse is native browser behavior, not conditional
          React rendering — so this stays collapsible for an organizer AND
          fully present for the test. */}
      <details className="flex flex-col gap-3 border-t border-white/[0.06] pt-4">
        <summary className="cursor-pointer text-sm font-medium text-white">Bulk import / export</summary>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted">
              Downloads every challenge currently on the board as one JSON file, flags included.
            </span>
            <button
              type="button"
              disabled={challenges.length === 0}
              onClick={handleExport}
              className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/[0.04] disabled:opacity-40"
            >
              Export challenges
            </button>
          </div>

          <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3">
            <span className="text-sm text-white">Import a bundle</span>
            {/* THE notice a shorter file could otherwise be misread against:
                see the header comment on `importBundle` in classic-store.ts —
                this is the client-side statement of the same guarantee. */}
            <p className="text-xs text-muted">
              Import never deletes existing challenges — anything already on the board that isn&rsquo;t in the file
              is left untouched. Categories the bundle mentions are added to the existing list, never used to
              replace it.
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
        <ChallengeForm
          key={editing.mode === "edit" ? editing.id : "new"}
          editor={editing}
          categories={categories}
          pending={formPending}
          error={formError}
          flagRevealed={flagRevealed}
          setFlagRevealed={setFlagRevealed}
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

// Exported (unlike quiz's un-exported `QuestionForm`) so the masking/preview/
// no-id properties can be proven directly against the SAME component this
// module renders — not a copy — without first driving the parent's `editing`
// useState open. That gating is real (see the header comment on why this
// repo's tests use `renderToStaticMarkup`, which never runs an effect or a
// click handler), so a static render of `<AdminClassicControls>` alone can
// prove the list and its buttons but not the form's own markup.
export function ChallengeForm({
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
  editor: ChallengeEditor;
  categories: readonly string[];
  pending: boolean;
  error: string | null;
  flagRevealed: boolean;
  setFlagRevealed: (v: boolean) => void;
  // Takes a DRAFT, not an editor: this form cannot express a change to the
  // challenge's id or its position, which is what keeps an existing
  // challenge's id immutable no matter how this component is edited later.
  onChange: (draft: ChallengeDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const draft = editor.draft;
  const isNew = editor.mode === "new";
  const valid = isDraftValid(draft, categories);

  // The form opens BELOW the full challenge list, while the button that
  // opens it sits above — on a board of a dozen challenges the click
  // appeared to do nothing (issue #200, 3.4). Scroll it into view and put
  // the cursor in the first editable field on every open. Keyed on which
  // thing is being edited, not on mount alone, so clicking Edit on another
  // row (same mounted form, new subject) counts as a fresh open — while a
  // keystroke re-render does not re-steal the scroll position.
  const formRef = useRef<HTMLDivElement>(null);
  const editingKey = editor.mode === "edit" ? editor.id : "new";
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    formRef.current?.querySelector<HTMLInputElement>("input[type='text']")?.focus({ preventScroll: true });
  }, [editingKey]);

  return (
    <div ref={formRef} className="flex flex-col gap-3 rounded-md border border-[#2563eb]/30 bg-[#2563eb]/[0.04] p-4">
      <h4 className="text-sm font-semibold text-white">
        {editor.mode === "new" ? "Add challenge" : `Edit "${confirmPhraseFromTitle(draft.title, editor.id)}"`}
      </h4>

      {/* The id, shown and never editable. On an existing challenge it is the
          reference every banked solve points at, so changing it would orphan
          them; on a new one it does not exist yet. Either way there is no
          input here — see the header comment. */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">Challenge id</span>
        {editor.mode === "edit" ? (
          <>
            <code className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-zinc-300">
              {editor.id}
            </code>
            <span className="text-xs text-muted">
              Fixed for the life of the challenge — contestants&rsquo; solves are recorded against it.
            </span>
          </>
        ) : (
          <span className="text-xs text-muted">Generated from the title when you save.</span>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Title</span>
        <input
          value={draft.title}
          disabled={pending}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
        />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Category</span>
          <select
            value={draft.category}
            disabled={pending}
            onChange={(e) => onChange({ ...draft, category: e.target.value })}
            className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
          >
            {!categories.includes(draft.category) && (
              <option value={draft.category} disabled>
                {draft.category || "Select a category"}
              </option>
            )}
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Points</span>
          <input
            type="number"
            min={0}
            max={CLASSIC_POINTS_MAX}
            value={draft.points}
            disabled={pending}
            onChange={(e) => onChange({ ...draft, points: e.target.value })}
            className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
          />
        </label>
        {/* Position used to be a number input here. It is now set by
            dragging (or Move up / Move down) in the list above. */}
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Position</span>
          <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-zinc-300">
            {isNew ? `#${editor.order} (last)` : `#${editor.order}`}
          </span>
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">
          Flag
          <button
            type="button"
            onClick={() => setFlagRevealed(!flagRevealed)}
            className="ml-2 text-[#7aa2ff] hover:underline"
          >
            {flagRevealed ? "Hide" : "Reveal"}
          </button>
        </span>
        {/* type="password" so a flag is never projected in the clear on a
            screen-shared admin panel. The reveal toggle above is the ONLY
            way to see it in the clear, and it defaults off on every fresh
            open of this form (see the `key`-forced remount in the parent). */}
        <input
          type={flagRevealed ? "text" : "password"}
          value={draft.flag}
          disabled={pending}
          onChange={(e) => onChange({ ...draft, flag: e.target.value })}
          className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
        />
      </label>

      {/* Directly under the flag, because it changes what that flag MEANS —
          not down with the presentation fields. */}
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={draft.caseSensitive}
          disabled={pending}
          onChange={(e) => onChange({ ...draft, caseSensitive: e.target.checked })}
          className="mt-0.5 h-4 w-4 flex-none accent-[#2563eb]"
        />
        <span className="text-xs text-muted">
          <span className="text-white">Case-sensitive flag</span>
          <span className="block">
            Off by default, which forgives the commonest contestant mistake. Turn it on only when the
            capitalisation IS the answer — a recovered password, a base64 string. Contestants are told
            on the challenge card, so nobody loses to a shift key without knowing why. Leading and
            trailing spaces are still forgiven either way.
          </span>
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Description (Markdown, max {MARKDOWN_MAX} characters)</span>
        <textarea
          value={draft.description}
          disabled={pending}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          rows={4}
          maxLength={MARKDOWN_MAX}
          className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
        />
      </label>

      {/* Live preview through the SAME renderer the contestant board uses —
          a second renderer here would drift and this would stop being a
          preview of anything real. */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">Preview</span>
        <div className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
          <Markdown source={draft.description} />
        </div>
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
          {pending ? "Saving…" : isNew ? "Add challenge" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
