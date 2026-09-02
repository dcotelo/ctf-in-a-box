"use client";

// The ai (externally hosted AI/LLM) module's admin section: the submission-
// cooldown knob plus challenge authoring (add/edit/delete) and category
// management, rendered in place of admin-controls.tsx's old "No settings for
// this module yet." placeholder for the ai module. Modeled on
// admin-classic-controls.tsx — same shape of problem (list, editor form,
// category manager, delete confirmation) — kept deliberately SMALLER, with
// the differences ai's own shape forces:
//
//   - A challenge has a `mode` (flag / event / both — see AiMode in
//     ai-keys.ts) and a `urlTemplate` (the external launch link, containing
//     `{token}`), neither of which classic has at all.
//   - `mode === "event"` means the box stores no flag for that challenge —
//     the store DELETES both flag hashes on an event-mode upsert (see
//     `upsertAiChallenge`'s doc comment) — so the form hides the flag and
//     case-sensitivity inputs in that mode rather than rendering controls for
//     fields that would silently be discarded.
//   - The launch URL is validated with `validateUrlTemplate` from
//     `@/lib/ai-keys` — the SAME function `upsertAiChallenge` runs
//     server-side — never re-implemented here. Client-side validation is a
//     convenience only; the server re-checks regardless (spec §8.1: enforced
//     both sides, one implementation).
//   - No reordering UI. Classic earned drag-and-drop plus keyboard move
//     buttons because organizers actively curate a long-running board; this
//     panel keeps `order` as a plain editable number instead — simpler code,
//     and nothing in this task calls for parity there.
//   - No bulk import/export. Classic's `{import: ...}` POST arm is
//     classic-only; the ai archive story is a later PR (#155's ai half).
//   - The wire contract is THREE payload shapes on ONE endpoint
//     (`POST /api/admin/ai`), dispatched by the server on exact key set —
//     see that route's header comment. This component's `aiCategoriesRequestBody`
//     helper exists for the same reason `categoriesRequestBody` exists in
//     the classic component: every categories POST must carry EXACTLY
//     `{categories}` and nothing else.
//   - Categories can be removed only while nothing references them, checked
//     client-side here exactly like classic (`setAiCategories` doesn't
//     enforce it either).
//
// Settings: `aiCooldownSecInput` reuses `commitNumber` from
// admin-controls.tsx exactly like classic's `classicCooldownSecInput`.
//
// Challenges: this component owns its own fetch of GET /api/admin/ai and its
// own add/edit/delete state, independent of the settings machinery above.
// `initialChallenges`/`initialCategories` seed the lists synchronously (used
// by tests, which render with `renderToStaticMarkup` and so never run the
// mount-time fetch below); in the browser they are just the pre-hydration
// paint, immediately replaced by a fresh fetch.
//
// No id field, ever, on the form — mirrors classic exactly. An id is
// generated from the title (`generateChallengeId`, re-exported from
// `@/lib/ai-keys`) when a NEW challenge is saved, and is immutable on an
// existing one: it is the field name in `ctf:ai:challenges`/`ctf:ai:flag`/
// `ctf:ai:flagnorm`/`ctf:ai:signkey` AND the reference every contestant's
// `ctf:ai:solves:<login>` row and every external integration's signing key
// are pinned against.
//
// Secrecy: this component DOES hold the flag AND the signing key — the same
// reasoning as classic's flag (see that file's header comment): `requireAdmin`
// gates the GET before any store read, so anyone past it can already rewrite
// or delete either outright, and prefilling saves an organizer from retyping
// a flag from memory (which risks silently redefining what counts as solved)
// or re-pasting a key into every external integration. The flag input still
// masks (`type="password"`, reveal toggle) for the screen-share case.
//
// The signing key itself is NOT rendered by this component at all — reading
// or rotating it is `AdminAiIntegration`'s job (the per-challenge integration
// panel, imported below), rendered inside every row of the challenge list.
//
// Deletion changes live event data mid-flight, so it is gated behind the
// same `ConfirmModal` + typed-title-confirm pattern classic's challenge
// delete uses. `confirmPhraseFromTitle` is imported from
// admin-classic-controls.tsx rather than re-implemented: it is
// module-agnostic (title in, safe non-empty phrase out) and already
// exported for exactly this kind of reuse.
//
// What deletion does NOT do: it does not clear contestant history (points
// stay banked — the master reset's job), and it DOES revoke the signing key
// immediately, breaking any external integration still using it — the
// confirm copy below says so.

import { useEffect, useRef, useState } from "react";
import { AI_COOLDOWN_SEC } from "@/lib/ai-defaults";
import {
  AI_MODES,
  AI_POINTS_MAX,
  generateChallengeId,
  validateUrlTemplate,
  type AiMode,
} from "@/lib/ai-keys";
// Type-only import: `ai-store.ts` is `server-only`, but a `import type` is
// fully erased at compile time — no runtime import ever reaches the client
// bundle. Same pattern admin-classic-controls.tsx uses for `classic-store.ts`.
import type { AdminAiChallenge, AiChallenge } from "@/lib/ai-store";
import { MARKDOWN_MAX } from "@/lib/markdown";
import Markdown from "@/components/markdown";
import ConfirmModal from "@/components/confirm-modal";
// Named import only — this module never needs classic's default export, just
// the module-agnostic phrase helper (title in, safe non-empty phrase out).
import { confirmPhraseFromTitle } from "@/components/admin-classic-controls";
import AdminAiIntegration from "@/components/admin-ai-integration";

type NumericSettingKey = "aiCooldownSec";

export type AdminAiControlsProps = {
  /** Parent-wide "a settings POST is in flight" flag — shared with every
   *  other section's inputs, same as classic's cooldown field. */
  pending: boolean;
  aiCooldownSecInput: string;
  setAiCooldownSecInput: (v: string) => void;
  commitNumber: (key: NumericSettingKey, raw: string, reset: (v: string) => void) => void;
  /** Test/first-paint seed only — see header comment. */
  initialChallenges?: AdminAiChallenge[];
  initialCategories?: string[];
};

/** Maps a `/api/admin/ai` response to a message that tells a validation
 *  failure (the organizer's payload was bad — 400) apart from an
 *  infrastructure failure (the store itself is unavailable — 503). Mirrors
 *  `describeClassicError`/`describeQuizError` — each module owns its own copy
 *  of this tiny mapping rather than sharing one, same convention as those. */
export function describeAiError(status: number, message?: string): string {
  if (status === 503) {
    return message ? `Store unavailable — ${message}` : "Store unavailable — try again shortly.";
  }
  return message ?? "That didn't work — check the challenge and try again.";
}

/** The exact copy + gating for the delete confirmation. The phrase is the
 *  challenge's TITLE (falling back to its id via `confirmPhraseFromTitle`,
 *  imported from admin-classic-controls.tsx — see that function's own doc
 *  comment for why the fallback exists at all: `ConfirmModal` treats an empty
 *  `requireType` as "no confirmation required"). Exported for direct testing. */
export function aiChallengeDeleteConfirm(challenge: AiChallenge): {
  title: string;
  body: string;
  requireType: string;
  confirmLabel: string;
} {
  const phrase = confirmPhraseFromTitle(challenge.title, challenge.id);
  return {
    title: `Delete "${phrase}"?`,
    body:
      `This removes the challenge (id ${challenge.id}) from the board and hides it from contestants, ` +
      "and revokes its signing key immediately — any external integration still using it will start failing. " +
      "Points already banked for it stay on the leaderboard — to clear those, use the master reset.",
    requireType: phrase,
    confirmLabel: "Delete challenge",
  };
}

/** Everything about a challenge that the FORM may change.
 *
 *  Deliberately missing: `id`. `order` is here (unlike classic's
 *  `ChallengeDraft`) because this panel has no drag-reorder UI — see the
 *  header comment — so position is just another number the form edits. */
export type AiChallengeDraft = {
  title: string;
  category: string;
  description: string;
  points: string;
  order: string;
  /** flag / event / both — see AiMode in ai-keys.ts. */
  mode: AiMode;
  /** The external launch template, containing `{token}`. Validated live with
   *  `validateUrlTemplate` — the same function the store runs. */
  urlTemplate: string;
  flag: string;
  /** Compare the flag with capitalisation intact, mirroring classic's field
   *  (issue #193). Meaningless (and hidden) in event mode. */
  caseSensitive: boolean;
  /** Optional paid-hint text, identical to classic's: empty = no hint, and
   *  saving an emptied field is a deliberate CLEAR, not "leave unchanged". */
  hint: string;
};

/** The form's whole state: the editable draft plus the identity the form
 *  does not own. Mirrors classic's `ChallengeEditor` discriminated union —
 *  an id is reachable only after establishing which case you are in, so an
 *  existing challenge's id can never be expressed as editable. */
export type AiChallengeEditor =
  | { mode: "new"; draft: AiChallengeDraft }
  | { mode: "edit"; id: string; draft: AiChallengeDraft };

/** The POST body `/api/admin/ai` parses for a challenge upsert. Mirrors that
 *  route's `ChallengePayload` (its exported `CHALLENGE_KEYS` names the exact
 *  key set) — this type just keeps the client from assembling something
 *  obviously wrong. `flag`/`caseSensitive` are optional in the TYPE because
 *  the route allows omitting them; in practice `hint` is always sent (see
 *  `payloadFromAiEditor`), same as classic. */
export type AiChallengePayload = {
  id: string;
  title: string;
  category: string;
  description: string;
  points: number;
  order: number;
  mode: AiMode;
  urlTemplate: string;
  flag?: string;
  caseSensitive?: boolean;
  hint?: string;
};

/** The cooldown field's `onBlur` handler logic, pulled out as a pure
 *  function so a test can prove the EXACT key wired to `commitNumber`
 *  without needing to simulate a real blur event — this repo's component
 *  tests render with `renderToStaticMarkup`, which never fires DOM events
 *  (see this file's test file header comment). */
export function commitAiCooldown(
  commitNumber: (key: NumericSettingKey, raw: string, reset: (v: string) => void) => void,
  raw: string,
  reset: (v: string) => void,
): void {
  commitNumber("aiCooldownSec", raw, reset);
}

export function emptyAiDraft(defaultCategory: string = "", nextOrder: number = 1): AiChallengeDraft {
  return {
    title: "",
    category: defaultCategory,
    description: "",
    points: "10",
    order: String(nextOrder),
    mode: "flag",
    urlTemplate: "",
    flag: "",
    caseSensitive: false,
    hint: "",
  };
}

/** A brand-new challenge. No id: one is generated from the finished title
 *  when the draft is submitted. */
export function newAiChallengeEditor(nextOrder: number, defaultCategory: string = ""): AiChallengeEditor {
  return { mode: "new", draft: emptyAiDraft(defaultCategory, nextOrder) };
}

/** Seeds an edit draft from an existing challenge — INCLUDING its flag, for
 *  the same reason classic's `draftFromChallenge` does: an organizer fixing a
 *  typo should never have to retype a flag from memory. */
export function draftFromAiChallenge({ challenge: c, flag, hint }: AdminAiChallenge): AiChallengeDraft {
  return {
    title: c.title,
    category: c.category,
    description: c.description,
    points: String(c.points),
    order: String(c.order),
    mode: c.mode,
    urlTemplate: c.urlTemplate,
    flag,
    hint: hint ?? "",
    // Coerced, because the stored field is absent-when-false and a checkbox
    // needs a real boolean — an `undefined` here makes React switch the
    // input from controlled to uncontrolled the first time it is ticked.
    caseSensitive: c.caseSensitive === true,
  };
}

/** Opens an existing challenge for editing: its draft, plus the id the form
 *  cannot touch. */
export function editorFromAiChallenge(row: AdminAiChallenge): AiChallengeEditor {
  return { mode: "edit", id: row.challenge.id, draft: draftFromAiChallenge(row) };
}

/** Whether `draft` could be submitted as-is, mirroring the store's own rules
 *  (`upsertAiChallenge`) PLUS basic form hygiene, so an organizer can't build
 *  something the store would reject and only find out on submit. Unlike
 *  classic's `isDraftValid`, this takes no `categories` list — the category
 *  select only ever offers a value already in the current list, so there is
 *  nothing extra to police here. Exported for direct testing. */
export function isAiDraftValid(draft: AiChallengeDraft): boolean {
  if (draft.title.trim().length === 0) return false;
  if (draft.category.trim().length === 0) return false;
  if (draft.description.length > MARKDOWN_MAX) return false;

  const points = Number(draft.points);
  if (draft.points.trim() === "" || !Number.isInteger(points) || points < 0 || points > AI_POINTS_MAX) return false;

  const order = Number(draft.order);
  if (draft.order.trim() === "" || !Number.isInteger(order) || order < 0) return false;

  if (!validateUrlTemplate(draft.urlTemplate).ok) return false;

  // A flag is required unless the challenge is event-only — mirrors the
  // store's own `graded` rule in `upsertAiChallenge` exactly.
  if (draft.mode !== "event" && draft.flag.trim().length === 0) return false;

  return true;
}

/** The POST body for an editor's current state.
 *
 *  The id rule mirrors `payloadFromEditor` in admin-classic-controls.tsx: on
 *  `mode: "edit"` it is `editor.id`, full stop — never re-derived from a
 *  (possibly just-rewritten) title, because changing an id would orphan every
 *  solve and invalidate every external integration already pinned to the old
 *  one. On `mode: "new"` it is minted from the title.
 *
 *  `flag` is included only when the challenge is graded (`mode !== "event"`)
 *  — the store deletes both flag hashes on an event-mode upsert regardless of
 *  what is sent, so sending a stale value from a form the organizer can no
 *  longer even see would only be confusing, never load-bearing. `caseSensitive`
 *  is likewise omitted in event mode for the same reason: with no flag to
 *  compare, an organizer who set it while the challenge was flag/both-mode and
 *  then flipped to event-mode would otherwise leave `caseSensitive: true`
 *  riding along in the payload and landing stored, semantically orphaned —
 *  a flag-comparison flag with no flag left to apply it to.
 *
 *  `newId` is injectable so a test can pin the generated value; production
 *  always uses `generateChallengeId`. Exported for direct testing. */
export function payloadFromAiEditor(
  editor: AiChallengeEditor,
  newId: (title: string) => string = generateChallengeId,
): AiChallengePayload {
  const d = editor.draft;
  const title = d.title.trim();
  const graded = d.mode !== "event";
  return {
    id: editor.mode === "edit" ? editor.id : newId(title),
    title,
    category: d.category,
    description: d.description,
    points: Number(d.points),
    order: Number(d.order),
    mode: d.mode,
    urlTemplate: d.urlTemplate.trim(),
    // The hint is ALWAYS sent: an emptied field is a deliberate clear, and
    // the store deletes the row for an empty string — identical to classic.
    hint: d.hint,
    ...(graded ? { flag: d.flag } : {}),
    ...(graded && d.caseSensitive ? { caseSensitive: true as const } : {}),
  };
}

/** How many challenges currently file under `category` — mirrors classic's
 *  `categoryUsageCount` exactly (small enough that reimplementing it here
 *  beats importing a function typed against classic's own row shape).
 *  Exported for direct testing. */
export function categoryUsageCount(challenges: readonly AdminAiChallenge[], category: string): number {
  return challenges.filter((row) => row.challenge.category === category).length;
}

/** The exact request body a categories POST sends: EXACTLY one key,
 *  `categories` — see the route's header comment for why the shape has to be
 *  this precise. Exported so it is the ONE place `postCategories` builds this
 *  body from. Mirrors classic's `categoriesRequestBody`. */
export function aiCategoriesRequestBody(categories: readonly string[]): { categories: string[] } {
  return { categories: [...categories] };
}

const AI_MODE_LABELS: Record<AiMode, string> = {
  flag: "Graded by flag",
  event: "External event only (no flag)",
  both: "Either — flag or external event",
};

function sortChallenges(list: AdminAiChallenge[]): AdminAiChallenge[] {
  return [...list].sort((a, b) => a.challenge.order - b.challenge.order || a.challenge.id.localeCompare(b.challenge.id));
}

function upsertInList(list: AdminAiChallenge[], row: AdminAiChallenge): AdminAiChallenge[] {
  return sortChallenges([...list.filter((x) => x.challenge.id !== row.challenge.id), row]);
}

async function parseJson<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

export default function AdminAiControls({
  pending,
  aiCooldownSecInput,
  setAiCooldownSecInput,
  commitNumber,
  initialChallenges = [],
  initialCategories = [],
}: AdminAiControlsProps) {
  const [challenges, setChallenges] = useState<AdminAiChallenge[]>(() => sortChallenges(initialChallenges));
  const [categories, setCategories] = useState<string[]>(initialCategories);
  const [listError, setListError] = useState<string | null>(null);

  const [editing, setEditing] = useState<AiChallengeEditor | null>(null);
  const [formPending, setFormPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [flagRevealed, setFlagRevealed] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AiChallenge | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Which challenge's signing key is currently being rotated (driven by
  // `AdminAiIntegration`, the per-challenge integration panel) — at most one
  // at a time, driven per-row by that panel's own `pending` prop
  // (`rotatingId === row.challenge.id`).
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotateError, setRotateError] = useState<string | null>(null);

  const [newCategoryInput, setNewCategoryInput] = useState("");
  const [categoryPending, setCategoryPending] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  /** Re-fetches the challenge and category lists from the store. Wired to
   *  the Retry control rendered below `listError` — a real user click, never
   *  called from an effect (see the mount effect's own comment for why the
   *  mount-time load does NOT go through this function). No cancellation
   *  guard: a manual click has no unmount race to guard against the way a
   *  mount effect does. */
  async function refreshLists(): Promise<void> {
    try {
      const res = await fetch("/api/admin/ai");
      const data = await parseJson<{ error?: string; challenges?: AdminAiChallenge[]; categories?: string[] }>(res);
      if (!res.ok) {
        setListError(describeAiError(res.status, data.error));
        return;
      }
      setChallenges(sortChallenges(Array.isArray(data.challenges) ? data.challenges : []));
      setCategories(Array.isArray(data.categories) ? data.categories : []);
      setListError(null);
    } catch {
      setListError("Couldn't load challenges — check your connection and try again.");
    }
  }

  // First-paint data comes from `initialChallenges`/`initialCategories` (or,
  // in production, is simply empty); this replaces it with the live data
  // once mounted in the browser. Never runs under `renderToStaticMarkup`.
  //
  // Written as an inline `.then()` chain — deliberately NOT `void
  // refreshLists(() => cancelled)` the way classic's/quiz's mount effects are
  // written. `react-hooks/set-state-in-effect` traces a setState call through
  // a closed-over async helper invoked from an effect body and flags it as
  // "calling setState synchronously within an effect", even though every
  // setter below already only fires once the fetch has settled and is
  // already guarded by `cancelled`. Writing the continuation directly in the
  // effect's own body — nothing routed through an intermediate closure the
  // rule has to trace through — clears the false positive without an
  // eslint-disable.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/ai")
      .then((res) =>
        parseJson<{ error?: string; challenges?: AdminAiChallenge[]; categories?: string[] }>(res).then((data) => ({
          res,
          data,
        })),
      )
      .then(({ res, data }) => {
        if (cancelled) return;
        if (!res.ok) {
          setListError(describeAiError(res.status, data.error));
          return;
        }
        setChallenges(sortChallenges(Array.isArray(data.challenges) ? data.challenges : []));
        setCategories(Array.isArray(data.categories) ? data.categories : []);
        setListError(null);
      })
      .catch(() => {
        if (!cancelled) setListError("Couldn't load challenges — check your connection and try again.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const nextOrder = challenges.reduce((max, c) => Math.max(max, c.challenge.order), 0) + 1;

  async function postChallenge(
    payload: AiChallengePayload,
  ): Promise<{ ok: true; row: AdminAiChallenge } | { ok: false; message: string }> {
    try {
      const res = await fetch("/api/admin/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await parseJson<{
        error?: string;
        challenge?: AiChallenge;
        flag?: string;
        hint?: string | null;
        signingKey?: string;
      }>(res);
      if (!res.ok || !data.challenge) return { ok: false, message: describeAiError(res.status, data.error) };
      // The route echoes the STORED record (mode/urlTemplate may have been
      // normalized, and a signing key is guaranteed), not the raw payload, so
      // this panel's state matches what a subsequent GET would return.
      return {
        ok: true,
        row: {
          challenge: data.challenge,
          flag: data.flag ?? (payload.flag ?? ""),
          hint: data.hint ?? null,
          signingKey: data.signingKey ?? "",
        },
      };
    } catch {
      return { ok: false, message: "Couldn't reach the server — try again." };
    }
  }

  async function submitEditor(editor: AiChallengeEditor) {
    setFormPending(true);
    setFormError(null);
    const result = await postChallenge(payloadFromAiEditor(editor));
    setFormPending(false);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    setChallenges((prev) => upsertInList(prev, result.row));
    setEditing(null);
  }

  async function doDelete(id: string) {
    setDeletePending(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/admin/ai", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await parseJson<{ error?: string }>(res);
      if (!res.ok) {
        setDeleteError(describeAiError(res.status, data.error));
        return;
      }
      setChallenges((prev) => prev.filter((c) => c.challenge.id !== id));
      setDeleteTarget(null);
    } catch {
      setDeleteError("Couldn't reach the server — try again.");
    } finally {
      setDeletePending(false);
    }
  }

  /** POST `{rotate: id}` — mints a new signing key for one challenge and
   *  swaps it into `challenges` from the response, exactly like every other
   *  write in this component echoes the store's own result rather than
   *  something derived client-side. Wired to `AdminAiIntegration`'s
   *  `onRotate` prop at the seam below; errors surface through the same
   *  `describeAiError` idiom every other write in this file uses. ALWAYS
   *  rethrows on failure (network or a non-2xx) so the panel's own confirm
   *  (`confirmRotate` in admin-ai-integration.tsx) knows not to close itself
   *  — an organizer who just saw an error should still see the confirm, not
   *  have it vanish as if the rotate had succeeded. */
  async function rotateSigningKey(id: string): Promise<void> {
    setRotatingId(id);
    setRotateError(null);
    let handled = false;
    try {
      const res = await fetch("/api/admin/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotate: id }),
      });
      const data = await parseJson<{ error?: string; signingKey?: string }>(res);
      if (!res.ok || typeof data.signingKey !== "string") {
        handled = true;
        setRotateError(describeAiError(res.status, data.error));
        throw new Error("rotate failed");
      }
      const signingKey = data.signingKey;
      setChallenges((prev) => prev.map((row) => (row.challenge.id === id ? { ...row, signingKey } : row)));
    } catch (err) {
      if (!handled) setRotateError("Couldn't reach the server — try again.");
      throw err;
    } finally {
      setRotatingId(null);
    }
  }

  /** POSTs the category list. The ONLY place in this component that builds a
   *  categories body, and it builds EXACTLY `{categories}` — see
   *  `aiCategoriesRequestBody`'s comment. */
  async function postCategories(next: string[]): Promise<{ ok: true; categories: string[] } | { ok: false; message: string }> {
    try {
      const res = await fetch("/api/admin/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(aiCategoriesRequestBody(next)),
      });
      const data = await parseJson<{ error?: string; categories?: string[] }>(res);
      if (!res.ok || !Array.isArray(data.categories)) return { ok: false, message: describeAiError(res.status, data.error) };
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
   *  challenges reference it — mirrors classic's `removeCategory` exactly. */
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

  const confirmCopy = deleteTarget ? aiChallengeDeleteConfirm(deleteTarget) : null;

  return (
    <>
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="text-white">Submission cooldown (sec)</span>
          <span className="block text-xs text-muted">
            Seconds a contestant must wait between graded flag submissions on the same challenge. 0 = no cooldown.
            Signed events from the external side are never rate-limited by this — there is no wrong answer to
            throttle.
          </span>
        </span>
        <input
          type="number"
          min={0}
          value={aiCooldownSecInput}
          placeholder={String(AI_COOLDOWN_SEC)}
          disabled={pending}
          onChange={(e) => setAiCooldownSecInput(e.target.value)}
          onBlur={() => commitAiCooldown(commitNumber, aiCooldownSecInput, setAiCooldownSecInput)}
          className="w-28 flex-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-right text-sm text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
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
            className="flex-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
          />
          <button
            type="button"
            disabled={categoryPending || newCategoryInput.trim().length === 0}
            onClick={addCategory}
            className="rounded-md border border-[#2563eb]/45 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/[0.06] disabled:opacity-50"
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
              setEditing(newAiChallengeEditor(nextOrder, categories[0] ?? ""));
            }}
            className="rounded-md border border-[#2563eb]/45 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/[0.06] disabled:opacity-50"
          >
            Add challenge
          </button>
        </div>

        {listError && (
          <p className="text-xs text-[#e53e3e]">
            {listError}{" "}
            <button type="button" onClick={() => void refreshLists()} className="text-white hover:underline">
              Retry
            </button>
          </p>
        )}

        {/* Rotate errors are global rather than per-row, same as every other
            write in this component (listError, categoryError, deleteError) —
            an organizer only ever has one rotate in flight at a time. */}
        {rotateError && <p className="text-xs text-[#e53e3e]">{rotateError}</p>}

        {challenges.length === 0 ? (
          <p className="text-xs text-muted">No challenges yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {challenges.map((row) => (
              // Every row renders `AdminAiIntegration` below, but the flag
              // and signing key stay out of the list itself: the flag
              // appears only once the organizer opens the edit form, and the
              // signing key is masked by default inside the integration
              // panel (Reveal is an explicit click) — the raw key is absent
              // from this row's markup until then, never sitting exposed on
              // a panel that might be on a projector.
              <li
                key={row.challenge.id}
                className="flex flex-col gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{row.challenge.title}</p>
                    <p className="text-xs text-muted">
                      #{row.challenge.order} · {row.challenge.category} · {row.challenge.points} pt
                      {row.challenge.points === 1 ? "" : "s"} · {AI_MODE_LABELS[row.challenge.mode]}
                    </p>
                  </div>
                  <div className="flex flex-none gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setFlagRevealed(false);
                        setEditing(editorFromAiChallenge(row));
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
                </div>
                <AdminAiIntegration
                  challenge={row.challenge}
                  signingKey={row.signingKey}
                  pending={rotatingId === row.challenge.id}
                  onRotate={() => rotateSigningKey(row.challenge.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <AiChallengeForm
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

// Exported (unlike a private form) so the masking/mode-gating/preview
// properties can be proven directly against the SAME component this module
// renders — not a copy — without first driving the parent's `editing`
// useState open. Mirrors classic's exported `ChallengeForm`; see this
// component's test file header comment for why.
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
  const valid = isAiDraftValid(draft);
  const urlCheck = validateUrlTemplate(draft.urlTemplate);
  const graded = draft.mode !== "event";

  // Same "the click appeared to do nothing" fix as classic's ChallengeForm
  // (issue #200, 3.4): scroll the form into view and focus its first field on
  // every open, keyed on which thing is being edited rather than on mount
  // alone.
  const formRef = useRef<HTMLDivElement>(null);
  const editingKey = editor.mode === "edit" ? editor.id : "new";
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    formRef.current?.querySelector<HTMLInputElement>("input[type='text']")?.focus({ preventScroll: true });
  }, [editingKey]);

  return (
    <div ref={formRef} className="flex flex-col gap-3 rounded-md border border-[#2563eb]/30 bg-white/[0.04] p-4">
      <h4 className="text-sm font-semibold text-white">
        {editor.mode === "new" ? "Add challenge" : `Edit "${confirmPhraseFromTitle(draft.title, editor.id)}"`}
      </h4>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">Challenge id</span>
        {editor.mode === "edit" ? (
          <>
            <code className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-zinc-300">
              {editor.id}
            </code>
            <span className="text-xs text-muted">
              Fixed for the life of the challenge — contestants&rsquo; solves and any external integration&rsquo;s
              signing key are pinned to it.
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
          className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
        />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Category</span>
          <select
            value={draft.category}
            disabled={pending}
            onChange={(e) => onChange({ ...draft, category: e.target.value })}
            className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
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
            max={AI_POINTS_MAX}
            value={draft.points}
            disabled={pending}
            onChange={(e) => onChange({ ...draft, points: e.target.value })}
            className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Position</span>
          <input
            type="number"
            min={0}
            value={draft.order}
            disabled={pending}
            onChange={(e) => onChange({ ...draft, order: e.target.value })}
            className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Solve mode</span>
        <select
          value={draft.mode}
          disabled={pending}
          onChange={(e) => onChange({ ...draft, mode: e.target.value as AiMode })}
          className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
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
          onChange={(e) => onChange({ ...draft, urlTemplate: e.target.value })}
          className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-sm text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
        />
        {!urlCheck.ok && <p className="text-xs text-[#e53e3e]">{urlCheck.reason}</p>}
      </label>

      {graded ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">
              Flag
              <button
                type="button"
                onClick={() => setFlagRevealed(!flagRevealed)}
                className="ml-2 text-white hover:underline"
              >
                {flagRevealed ? "Hide" : "Reveal"}
              </button>
            </span>
            {/* type="password" so a flag is never projected in the clear on
                a screen-shared admin panel. The reveal toggle is the ONLY way
                to see it in the clear, and defaults off on every fresh open
                of this form (the parent force-remounts via `key`). */}
            <input
              type={flagRevealed ? "text" : "password"}
              value={draft.flag}
              disabled={pending}
              onChange={(e) => onChange({ ...draft, flag: e.target.value })}
              className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-sm text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
            />
          </label>

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
                capitalisation IS the answer. Leading and trailing spaces are still forgiven either way.
              </span>
            </span>
          </label>
        </>
      ) : (
        <p className="text-xs text-muted">
          Event-mode challenges take no flag — solves arrive from the external site.
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">
          Hint (optional). Contestants pay the configured hint cost to reveal it — leave empty for no
          hint. Secret until purchased, like the flag.
        </span>
        <textarea
          value={draft.hint}
          disabled={pending}
          onChange={(e) => onChange({ ...draft, hint: e.target.value })}
          rows={2}
          className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Description (Markdown, max {MARKDOWN_MAX} characters)</span>
        <textarea
          value={draft.description}
          disabled={pending}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          rows={4}
          maxLength={MARKDOWN_MAX}
          className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-sm text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
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
