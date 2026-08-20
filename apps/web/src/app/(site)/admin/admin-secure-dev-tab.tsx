"use client";

// The Secure Development module's admin tab: the paid-hint knobs (master
// toggle, price, and the two anti-burner gates).
//
// These controls used to live in a "Secure Development" section of the flat
// admin panel; the tab shell is a UI relocation ONLY. The stored keys —
// `hintsEnabled`, `hintCost`, `hintsMinSolves`, `hintsUnlockAfterMin` — and
// their server-side validation in `lib/admin-store.ts` are unchanged, so a
// deployed event's existing settings keep their exact meaning.
//
// Presentational: the shell (`admin-controls.tsx`) owns `settings`, the
// draft input strings, and `apply`/`commitNumber`; nothing here writes to
// Redis directly.

import type { AdminSettings } from "@/lib/admin-store";
import { HINT_DEFAULT_ENABLED } from "@/lib/hint-defaults";
import type { CommitNumber } from "./types";

export type AdminSecureDevTabProps = {
  settings: AdminSettings;
  pending: boolean;
  apply: (patch: Record<string, unknown>) => Promise<boolean>;
  hintCostInput: string;
  setHintCostInput: (v: string) => void;
  minSolvesInput: string;
  setMinSolvesInput: (v: string) => void;
  unlockAfterInput: string;
  setUnlockAfterInput: (v: string) => void;
  commitNumber: CommitNumber;
};

export default function AdminSecureDevTab({
  settings,
  pending,
  apply,
  hintCostInput,
  setHintCostInput,
  minSolvesInput,
  setMinSolvesInput,
  unlockAfterInput,
  setUnlockAfterInput,
  commitNumber,
}: AdminSecureDevTabProps) {
  return (
    <>
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="text-white">Hints enabled</span>
          <span className="block text-xs text-muted">Hints are on unless you turn them off.</span>
        </span>
        <input
          type="checkbox"
          checked={settings.hintsEnabled ?? HINT_DEFAULT_ENABLED}
          disabled={pending}
          onChange={(e) => void apply({ hintsEnabled: e.target.checked })}
          className="h-5 w-5 flex-none accent-[#2563eb]"
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span className="text-white">Hint cost</span>
        <input
          type="number"
          min={0}
          value={hintCostInput}
          disabled={pending}
          onChange={(e) => setHintCostInput(e.target.value)}
          onBlur={() => commitNumber("hintCost", hintCostInput, setHintCostInput)}
          className="w-28 flex-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-right text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="text-white">Hints: solves required</span>
          <span className="block text-xs text-muted">
            Solves needed on a target before its hints can be bought. Blocks throwaway
            accounts from farming hint text for a team. 0 disables the gate.
          </span>
        </span>
        <input
          type="number"
          min={0}
          value={minSolvesInput}
          disabled={pending}
          onChange={(e) => setMinSolvesInput(e.target.value)}
          onBlur={() => commitNumber("hintsMinSolves", minSolvesInput, setMinSolvesInput)}
          className="w-28 flex-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-right text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="text-white">Hints: unlock after (min)</span>
          <span className="block text-xs text-muted">
            Minutes after the scoring start before any hint can be bought. 0 = available
            immediately; needs a scoring start below to have any effect.
          </span>
        </span>
        <input
          type="number"
          min={0}
          value={unlockAfterInput}
          disabled={pending}
          onChange={(e) => setUnlockAfterInput(e.target.value)}
          onBlur={() => commitNumber("hintsUnlockAfterMin", unlockAfterInput, setUnlockAfterInput)}
          className="w-28 flex-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-right text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
        />
      </label>
    </>
  );
}
