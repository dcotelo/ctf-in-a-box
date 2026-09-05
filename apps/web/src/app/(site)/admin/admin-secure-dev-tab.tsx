"use client";

// The Secure Development module's admin tab: the one knob that is this
// module's alone, the re-run cooldown between scored runs on a PR.
//
// The four hint knobs used to render here. They are not this module's: the
// same `hintsEnabled`/`hintCost`/`hintsMinSolves`/`hintsUnlockAfterMin`
// govern Classic's and AI's paid hints too (hint-store.ts), and this tab
// exists only while secure-development is enabled — so an event without it
// had no hint switch at all (UX audit F1). They live on the Event tab now.
// The stored keys and their server-side validation in `lib/admin-store.ts`
// are unchanged; a deployed event's settings keep their exact meaning.
//
// Presentational: the shell (`admin-controls.tsx`) owns `settings`, the
// draft input string, and `apply`/`commitNumber`; nothing here writes to
// Redis directly.

import type { AdminSettings } from "@/lib/admin-store";
import { SCORE_COOLDOWN_MIN, SCORE_COOLDOWN_MIN_MAX } from "@/lib/scoring-defaults";
import type { CommitNumber } from "./types";

export type AdminSecureDevTabProps = {
  settings: AdminSettings;
  pending: boolean;
  apply: (patch: Record<string, unknown>) => Promise<boolean>;
  commitNumber: CommitNumber;
  cooldownInput: string;
  setCooldownInput: (v: string) => void;
};

export default function AdminSecureDevTab({ pending, commitNumber, cooldownInput, setCooldownInput }: AdminSecureDevTabProps) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>
        <span className="text-white">Re-run cooldown (min)</span>
        <span className="block text-xs text-muted">
          Minimum minutes between SCORED runs on the same PR. Every run hands back a per-challenge pass/fail, so a
          short cooldown lets a contestant iterate a check-gaming patch against the rubric. 0 disables it. Takes
          effect on the next push — each fork&apos;s Action reads this value when it runs. Hint policy is on the
          Event tab.
        </span>
      </span>
      <input
        type="number"
        min={0}
        max={SCORE_COOLDOWN_MIN_MAX}
        value={cooldownInput}
        placeholder={String(SCORE_COOLDOWN_MIN)}
        disabled={pending}
        onChange={(e) => setCooldownInput(e.target.value)}
        onBlur={() => commitNumber("scoreCooldownMin", cooldownInput, setCooldownInput)}
        className="w-28 flex-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-right text-sm text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
      />
    </label>
  );
}
