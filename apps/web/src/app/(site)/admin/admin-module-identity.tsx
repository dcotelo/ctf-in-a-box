"use client";

// Per-module title/blurb editor. Rendered as the FIRST child of every module
// panel in admin-controls.tsx, driven by the modules list — so a third
// module gets identity editing for free with no per-module special case.
//
// Presentational, like the other tab bodies: the shell owns `apply` and
// posts through it. Commits on blur, same idiom as ScheduleField
// (admin-event-tab.tsx) and commitNumber (admin-controls.tsx): an unchanged
// value is a no-op, so blurring without editing never POSTs.
//
// An empty string CLEARS the override server-side (admin-store.ts HDELs the
// field, restoring the registry default) — the placeholder shows that
// default so it's discoverable what blank restores, and the help text below
// spells it out.

import { useState } from "react";
import { MODULE_TITLE_MAX, MODULE_BLURB_MAX } from "@/lib/modules";

export type AdminModuleIdentityProps = {
  moduleId: string;
  /** Registry defaults (displayName/description) — shown as placeholders,
   *  never as the field value, so clearing the override is discoverable. */
  defaults: { title: string; blurb: string };
  /** The organizer's current override for this module, if any. */
  override: { title?: string; blurb?: string } | undefined;
  pending: boolean;
  apply: (patch: Record<string, unknown>) => Promise<void>;
};

const fieldClass =
  "w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none";

export default function AdminModuleIdentity({ moduleId, defaults, override, pending, apply }: AdminModuleIdentityProps) {
  // The stored value is the override text itself (never the registry
  // default) — an absent override means "" on the wire, which is exactly
  // what clears it, so "unchanged" and "already cleared" agree.
  const storedTitle = override?.title ?? "";
  const storedBlurb = override?.blurb ?? "";
  const [titleInput, setTitleInput] = useState(storedTitle);
  const [blurbInput, setBlurbInput] = useState(storedBlurb);

  return (
    <div className="flex flex-col gap-3 border-b border-white/[0.06] pb-4">
      <div>
        <span className="text-white">Module identity</span>
        <span className="block text-xs text-muted">
          Leave blank to use the default. Shown in the nav, on the leaderboard, and on the home page.
        </span>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Title</span>
        <input
          type="text"
          name={`moduleTitle:${moduleId}`}
          value={titleInput}
          placeholder={defaults.title}
          maxLength={MODULE_TITLE_MAX}
          disabled={pending}
          onChange={(e) => setTitleInput(e.target.value)}
          onBlur={() => {
            if (titleInput === storedTitle) return;
            void apply({ [`moduleTitle:${moduleId}`]: titleInput });
          }}
          className={fieldClass}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Blurb</span>
        <textarea
          name={`moduleBlurb:${moduleId}`}
          value={blurbInput}
          placeholder={defaults.blurb}
          maxLength={MODULE_BLURB_MAX}
          disabled={pending}
          rows={2}
          onChange={(e) => setBlurbInput(e.target.value)}
          onBlur={() => {
            if (blurbInput === storedBlurb) return;
            void apply({ [`moduleBlurb:${moduleId}`]: blurbInput });
          }}
          className={fieldClass}
        />
      </label>
    </div>
  );
}
