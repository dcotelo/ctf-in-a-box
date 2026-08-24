"use client";

// Per-module title/blurb editor. Rendered as the FIRST child of every module
// panel in admin-controls.tsx, driven by the modules list — so a third
// module gets identity editing for free with no per-module special case.
//
// Presentational, like the other tab bodies: the shell owns `apply` and
// posts through it.
//
// An empty string CLEARS the override server-side (admin-store.ts HDELs the
// field, restoring the registry default) — the placeholder shows that
// default so it's discoverable what blank restores, and the help text below
// spells it out.

import { useState } from "react";
import type { ChangeEvent } from "react";
import { MODULE_TITLE_MAX, MODULE_BLURB_MAX } from "@/lib/modules";

export type AdminModuleIdentityProps = {
  moduleId: string;
  /** Registry defaults (displayName/description) — shown as placeholders,
   *  never as the field value, so clearing the override is discoverable. */
  defaults: { title: string; blurb: string };
  /** The organizer's current override for this module, if any. */
  override: { title?: string; blurb?: string } | undefined;
  pending: boolean;
  /** Resolves `true` iff the patch was accepted server-side, so a rejected
   *  edit (control characters, an over-length paste past what `maxLength`
   *  alone stops) can snap back instead of sitting there re-POSTing the same
   *  rejected text on every later blur. */
  apply: (patch: Record<string, unknown>) => Promise<boolean>;
};

/**
 * The blur-commit decision for one identity field, factored out as a pure
 * function (no hooks, no DOM) so it's unit-testable directly — including
 * asserting on the exact patch object POSTed to `apply`, not just on
 * rendered markup.
 *
 * - Compares TRIMMED input against `stored`: whitespace typed over an
 *   already-empty override is treated as still-empty, so it's a no-op
 *   instead of re-POSTing "  " (which would clear nothing, since the server
 *   also trims) on every subsequent blur.
 * - An unchanged (post-trim) value never calls `apply`.
 * - A changed value POSTs `{ [patchKey]: trimmed }` — `patchKey` is the
 *   caller's single source for both this and the rendered `name` attribute,
 *   never a second hand-written string.
 * - Returns the value the field should now display: the trimmed text on
 *   success, or `stored` (snap back) if `apply` reports rejection.
 */
export async function commitIdentityField(opts: {
  patchKey: string;
  input: string;
  stored: string;
  apply: (patch: Record<string, unknown>) => Promise<boolean>;
}): Promise<string> {
  const { patchKey, input, stored, apply } = opts;
  const trimmed = input.trim();
  if (trimmed === stored) return trimmed;
  const ok = await apply({ [patchKey]: trimmed });
  return ok ? trimmed : stored;
}

const fieldClass =
  "w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-none";

/** One editable field (title or blurb). `patchKey` is computed ONCE by the
 *  caller (AdminModuleIdentity) and used for both the `name` attribute and
 *  the `apply()` call via `commitIdentityField` — never written out twice —
 *  so the rendered field and the POSTed patch key can't drift apart.
 *
 *  Keyed by the caller on its OWN `stored` value — the same
 *  remount-on-server-value trick `ScheduleField` uses — so committing this
 *  field never discards uncommitted text in the other.
 *
 *  `onBlur` reads the value straight off the event's `currentTarget` rather
 *  than closing over the `input` state — behaviourally identical in the
 *  browser (a controlled input's DOM value always matches `input` at blur
 *  time), but it also means the field's blur-commit can be exercised with a
 *  bare stub event (`{ currentTarget: { value } }`) against the SAME
 *  returned element `name` was read from, without needing to drive a real
 *  `onChange` first. See `admin-module-identity.test.ts`'s
 *  "name/onBlur binding" suite, which does exactly that to prove the two
 *  can't drift apart.
 *
 *  Exported (not just `AdminModuleIdentity`) so that test can invoke it
 *  directly and inspect the single element it returns. */
export function IdentityField({
  patchKey,
  stored,
  placeholder,
  maxLength,
  disabled,
  multiline,
  apply,
}: {
  patchKey: string;
  stored: string;
  placeholder: string;
  maxLength: number;
  disabled: boolean;
  multiline: boolean;
  apply: (patch: Record<string, unknown>) => Promise<boolean>;
}) {
  const [input, setInput] = useState(stored);

  const shared = {
    name: patchKey,
    value: input,
    placeholder,
    maxLength,
    disabled,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setInput(e.target.value),
    onBlur: (e: { currentTarget: { value: string } }) => {
      void commitIdentityField({ patchKey, input: e.currentTarget.value, stored, apply }).then(setInput);
    },
    className: fieldClass,
  };

  return multiline ? <textarea rows={2} {...shared} /> : <input type="text" {...shared} />;
}

export default function AdminModuleIdentity({ moduleId, defaults, override, pending, apply }: AdminModuleIdentityProps) {
  // The stored value is the override text itself (never the registry
  // default) — an absent override means "" on the wire, which is exactly
  // what clears it, so "unchanged" and "already cleared" agree.
  const storedTitle = override?.title ?? "";
  const storedBlurb = override?.blurb ?? "";
  const titleKey = `moduleTitle:${moduleId}`;
  const blurbKey = `moduleBlurb:${moduleId}`;

  return (
    <div className="flex flex-col gap-3 border-b border-white/[0.06] pb-4">
      <div>
        <span className="text-white">Module identity</span>
        <span className="block text-xs text-muted">
          Plain text. Leave a field blank to clear the override and go back to the default shown in
          the box.
        </span>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Title</span>
        <IdentityField
          key={`title-${storedTitle}`}
          patchKey={titleKey}
          stored={storedTitle}
          placeholder={defaults.title}
          maxLength={MODULE_TITLE_MAX}
          disabled={pending}
          multiline={false}
          apply={apply}
        />
        {/* Each claim here is a surface that actually renders the resolved
            title today. The leaderboard block and the landing-page section
            heading are called out as multi-module only because both are
            suppressed on a single-module event (there is nothing to
            disambiguate), so on most events a rename reaches the first three
            and no more. Overstating the reach is how an organizer ends up
            hunting for a name that was never going to appear. */}
        <span className="text-xs text-muted">
          Renames the module on this tab, in the nav, and on the module&rsquo;s own page. With more
          than one module enabled it also heads that module&rsquo;s leaderboard block and its
          landing-page section.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Blurb</span>
        <IdentityField
          key={`blurb-${storedBlurb}`}
          patchKey={blurbKey}
          stored={storedBlurb}
          placeholder={defaults.blurb}
          maxLength={MODULE_BLURB_MAX}
          disabled={pending}
          multiline
          apply={apply}
        />
        {/* The blurb is very nearly write-only, and saying so is the honest
            thing to put in front of the organizer typing into it: the only
            consumer in the app is /quiz's `generateMetadata` description.
            Do NOT fix this by inventing a page to render it on. */}
        <span className="text-xs text-muted">
          Not shown on any page. It only sets the module page&rsquo;s meta description, for search
          results and link previews &mdash; and only where that page has one, which today means the
          quiz.
        </span>
      </label>
    </div>
  );
}
