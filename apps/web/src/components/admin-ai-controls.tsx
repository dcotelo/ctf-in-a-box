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
//   - No per-tab bulk import/export button. Classic's `{import: ...}` POST
//     arm is classic-only; the ai catalogue is carried by the whole-event
//     archive on the Event tab instead (ai-io.ts / event-store.ts, #250).
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
// delete uses, with the shared `confirmPhrase` (components/admin) building
// the typed phrase — title in, safe non-empty phrase out.
//
// What deletion does NOT do: it does not clear contestant history (points
// stay banked — the master reset's job), and it DOES revoke the signing key
// immediately, breaking any external integration still using it — the
// confirm copy below says so.

import { useEffect, useState } from "react";
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
import ConfirmDelete from "@/components/admin/confirm-delete";
import CategoryEditor from "@/components/admin/category-editor";
import { categoriesRequestBody, useCategoryEditor } from "@/components/admin/use-category-editor";
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
import { type RowAccessors, nextOrder as nextOrderOf, sortByOrder, upsertRow } from "@/components/admin/ordered-rows";
import AdminAiIntegration, { AiEndpointsBlock, useBrowserOrigin } from "@/components/admin-ai-integration";
import type { ModuleInventory } from "@/components/admin-module-setup";
import AdminNumberField, { type FieldStatus } from "@/components/admin-number-field";
import { describeAdminError, parseJson, sendJson } from "@/components/admin/fetch";

type NumericSettingKey = "aiCooldownSec";

export type AdminAiControlsProps = {
  /** Parent-wide "a settings POST is in flight" flag — shared with every
   *  other section's inputs, same as classic's cooldown field. */
  pending: boolean;
  aiCooldownSecInput: string;
  setAiCooldownSecInput: (v: string) => void;
  commitNumber: (key: NumericSettingKey, raw: string, reset: (v: string) => void, label: string) => void;
  /** The shell's per-field save status, by stored key (UX audit F2). Optional
   *  so a static render without a shell still works; idle when absent. */
  statusOf?: (key: string) => FieldStatus;
  /** Test/first-paint seed only — see header comment. */
  initialChallenges?: AdminAiChallenge[];
  initialCategories?: string[];
  /** Reports the board's size to the shell for the setup checklist above this
   *  panel — after the mount-time fetch has settled, never from the seed. */
  onInventory?: (inventory: ModuleInventory) => void;
};

/** What this panel tells the shell about its content — mirrors
 *  `classicInventory`. Pure; exported for direct testing. */
export function aiInventory(rows: readonly AdminAiChallenge[], categories: readonly string[]): ModuleInventory {
  return { items: rows.length, categories: categories.length };
}

/** Maps a `/api/admin/ai` response to a message that tells a validation
 *  failure (the organizer's payload was bad — 400) apart from an
 *  infrastructure failure (the store itself is unavailable — 503). Mirrors
 *  `describeClassicError`/`describeQuizError` — each module owns its own copy
 *  of this tiny mapping rather than sharing one, same convention as those. */
export function describeAiError(status: number, message?: string): string {
  return describeAdminError(status, message, "That didn't work — check the challenge and try again.");
}

/** The exact copy + gating for the delete confirmation. The phrase is the
 *  challenge's TITLE (falling back to its id via the shared `confirmPhrase` —
 *  see that function's own doc comment for why the fallback exists at all:
 *  `ConfirmModal` treats an empty `requireType` as "no confirmation
 *  required"). Exported for direct testing. */
export function aiChallengeDeleteConfirm(challenge: AiChallenge): {
  title: string;
  body: string;
  requireType: string;
  confirmLabel: string;
} {
  const phrase = confirmPhrase(challenge.title, challenge.id);
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
export const AI_COOLDOWN_LABEL = "Submission cooldown (sec)";

export function commitAiCooldown(
  commitNumber: (key: NumericSettingKey, raw: string, reset: (v: string) => void, label: string) => void,
  raw: string,
  reset: (v: string) => void,
): void {
  commitNumber("aiCooldownSec", raw, reset, AI_COOLDOWN_LABEL);
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
 *  this precise. Built once, in `useCategoryEditor` (components/admin); this
 *  binding keeps the name this module's tests drive into the real route. */
export function aiCategoriesRequestBody(categories: readonly string[]): { categories: string[] } {
  return categoriesRequestBody(categories);
}

const AI_MODE_LABELS: Record<AiMode, string> = {
  flag: "Graded by flag",
  event: "External event only (no flag)",
  both: "Either — flag or external event",
};

/** Where an ai row keeps its id and position (components/admin/ordered-rows.ts). */
const AI_ROWS: RowAccessors<AdminAiChallenge> = {
  id: (row) => row.challenge.id,
  order: (row) => row.challenge.order,
  withOrder: (row, order) => ({ ...row, challenge: { ...row.challenge, order } }),
};

function sortChallenges(list: AdminAiChallenge[]): AdminAiChallenge[] {
  return sortByOrder(list, AI_ROWS);
}

function upsertInList(list: AdminAiChallenge[], row: AdminAiChallenge): AdminAiChallenge[] {
  return upsertRow(list, row, AI_ROWS);
}

export default function AdminAiControls({
  pending,
  aiCooldownSecInput,
  setAiCooldownSecInput,
  commitNumber,
  statusOf = () => ({ state: "idle" }),
  initialChallenges = [],
  initialCategories = [],
  onInventory,
}: AdminAiControlsProps) {
  const [challenges, setChallenges] = useState<AdminAiChallenge[]>(() => sortChallenges(initialChallenges));
  const [categories, setCategories] = useState<string[]>(initialCategories);
  const [listError, setListError] = useState<string | null>(null);
  // True once a real read has landed; gates the inventory report so the shell
  // never hears "0 challenges" from the pre-hydration seed.
  const [loaded, setLoaded] = useState(false);

  // Report upward whenever the board changes, once it is real. A report to
  // the parent's subscriber, not a setState of this component's own.
  useEffect(() => {
    if (loaded) onInventory?.(aiInventory(challenges, categories));
  }, [loaded, challenges, categories, onInventory]);

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

  // Category editing (input, in-flight flag, refusal) and its writes; the
  // list itself stays here because the same GET owns it.
  const categoryEditor = useCategoryEditor({
    endpoint: "/api/admin/ai",
    describeError: describeAiError,
    categories,
    setCategories,
    usageCount: (name) => categoryUsageCount(challenges, name),
  });

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
      setLoaded(true);
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
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setListError("Couldn't load challenges — check your connection and try again.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const nextOrder = nextOrderOf(challenges, AI_ROWS);

  async function postChallenge(
    payload: AiChallengePayload,
  ): Promise<{ ok: true; row: AdminAiChallenge } | { ok: false; message: string }> {
    const result = await sendJson<{
      error?: string;
      challenge?: AiChallenge;
      flag?: string;
      hint?: string | null;
      signingKey?: string;
    }>("/api/admin/ai", { method: "POST", body: payload }, describeAiError);
    if (!result.ok) return result;
    const { status, data } = result;
    if (!data.challenge) return { ok: false, message: describeAiError(status, data.error) };
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
      const result = await sendJson<{ error?: string }>("/api/admin/ai", { method: "DELETE", body: { id } }, describeAiError);
      if (!result.ok) {
        setDeleteError(result.message);
        return;
      }
      setChallenges((prev) => prev.filter((c) => c.challenge.id !== id));
      setDeleteTarget(null);
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
    try {
      const result = await sendJson<{ error?: string; signingKey?: string }>(
        "/api/admin/ai",
        { method: "POST", body: { rotate: id } },
        describeAiError,
      );
      if (!result.ok) {
        setRotateError(result.message);
        throw new Error("rotate failed");
      }
      const { status, data } = result;
      if (typeof data.signingKey !== "string") {
        setRotateError(describeAiError(status, data.error));
        throw new Error("rotate failed");
      }
      const signingKey = data.signingKey;
      setChallenges((prev) => prev.map((row) => (row.challenge.id === id ? { ...row, signingKey } : row)));
    } finally {
      setRotatingId(null);
    }
  }

  const confirmCopy = deleteTarget ? aiChallengeDeleteConfirm(deleteTarget) : null;

  // Hydration-safe: "" on the server and on the first browser render, the
  // real origin after — see `useBrowserOrigin`. The per-row panel uses the
  // same hook, so both halves of the integration UI agree.
  const origin = useBrowserOrigin();

  return (
    <>
      <AdminNumberField
        id="ai-cooldown-sec"
        label={AI_COOLDOWN_LABEL}
        help="Seconds a contestant must wait between graded flag submissions on the same challenge. 0 = no cooldown. Signed events from the external side are never rate-limited by this — there is no wrong answer to throttle."
        value={aiCooldownSecInput}
        placeholder={String(AI_COOLDOWN_SEC)}
        disabled={pending}
        status={statusOf("aiCooldownSec")}
        onChange={setAiCooldownSecInput}
        onBlur={() => commitAiCooldown(commitNumber, aiCooldownSecInput, setAiCooldownSecInput)}
      />

      <CategoryEditor
        categories={categories}
        input={categoryEditor.input}
        error={categoryEditor.error}
        pending={categoryEditor.pending}
        onInput={categoryEditor.setInput}
        onAdd={categoryEditor.add}
        onRemove={categoryEditor.remove}
        onMove={categoryEditor.move}
      />

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

        {/* Once, for the whole board (UX audit F5) — every row used to
            repeat these three URLs. */}
        <AiEndpointsBlock origin={origin} />

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
        <ConfirmDelete
          copy={confirmCopy}
          error={deleteError}
          pending={deletePending}
          onConfirm={() => void doDelete(deleteTarget.id)}
          onCancel={() => {
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
