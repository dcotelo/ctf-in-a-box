"use client";

// The Hints tab (admin-redesign.md PR 1: the Event/Hints/Admins split). The
// four hint-policy settings, lifted verbatim out of admin-event-tab.tsx onto
// their own destination — the policy is not any one module's:
// `hint-store.ts` reads the same four settings (`hintsEnabled`, `hintCost`,
// `hintsMinSolves`, `hintsUnlockAfterMin`) for secure-development targets,
// classic challenges and ai challenges alike, so a classic-only or ai-only
// event needs them reachable somewhere that always exists (UX audit F1) —
// same reasoning that put them on Event before this split, just its own
// screen now rather than a section of a longer one.
//
// Presentational, like every other destination: state and mutations are
// owned by admin-controls.tsx and passed in.

import type { AdminSettings } from "@/lib/admin-store";
import { HINT_COST, HINT_DEFAULT_ENABLED, HINT_MIN_SOLVES, HINT_UNLOCK_AFTER_MIN } from "@/lib/hint-defaults";
import AdminNumberField, { type FieldStatus } from "@/components/admin-number-field";
import type { CommitNumber } from "./types";

export type AdminHintsTabProps = {
  settings: AdminSettings;
  pending: boolean;
  apply: (patch: Record<string, unknown>) => Promise<boolean>;
  statusOf: (key: string) => FieldStatus;
  commitNumber: CommitNumber;
  hintCostInput: string;
  setHintCostInput: (v: string) => void;
  minSolvesInput: string;
  setMinSolvesInput: (v: string) => void;
  unlockAfterInput: string;
  setUnlockAfterInput: (v: string) => void;
};

export default function AdminHintsTab({
  settings,
  pending,
  apply,
  statusOf,
  commitNumber,
  hintCostInput,
  setHintCostInput,
  minSolvesInput,
  setMinSolvesInput,
  unlockAfterInput,
  setUnlockAfterInput,
}: AdminHintsTabProps) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-white">Hints</h3>
        <p className="text-xs text-muted">
          Event-wide policy. Secure Development, Classic CTF and AI Challenges all sell their hints through
          these four settings; the quiz has no hints. Each module&rsquo;s own tab holds the hint text.
        </p>
      </div>

      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="text-white">Hints enabled</span>
          <span className="block text-xs text-muted">
            Hints are on unless you turn them off. Off hides the hint button and the leaderboard&rsquo;s
            hint-penalty column; points already spent stay recorded.
          </span>
        </span>
        <input
          type="checkbox"
          checked={settings.hintsEnabled ?? HINT_DEFAULT_ENABLED}
          disabled={pending}
          onChange={(e) => void apply({ hintsEnabled: e.target.checked })}
          className="h-5 w-5 flex-none accent-[#2563eb]"
        />
      </label>

      <AdminNumberField
        id="hint-cost"
        label="Hint cost"
        help="Points deducted from the buyer when a hint is revealed."
        value={hintCostInput}
        placeholder={String(HINT_COST)}
        disabled={pending}
        status={statusOf("hintCost")}
        onChange={setHintCostInput}
        onBlur={() => commitNumber("hintCost", hintCostInput, setHintCostInput, "Hint cost")}
      />

      <AdminNumberField
        id="hints-min-solves"
        label="Hints: solves required"
        help="Solves needed on a target (or across the Classic or AI board) before its hints can be bought. Blocks throwaway accounts from farming hint text for a team. 0 disables the gate."
        value={minSolvesInput}
        placeholder={String(HINT_MIN_SOLVES)}
        disabled={pending}
        status={statusOf("hintsMinSolves")}
        onChange={setMinSolvesInput}
        onBlur={() => commitNumber("hintsMinSolves", minSolvesInput, setMinSolvesInput, "Hints: solves required")}
      />

      <AdminNumberField
        id="hints-unlock-after-min"
        label="Hints: unlock after (min)"
        help="Minutes after the scoring start before any hint can be bought. 0 = available immediately. Needs Scoring opens (on the Event tab) to be set to have any effect."
        value={unlockAfterInput}
        placeholder={String(HINT_UNLOCK_AFTER_MIN)}
        disabled={pending}
        status={statusOf("hintsUnlockAfterMin")}
        onChange={setUnlockAfterInput}
        onBlur={() =>
          commitNumber("hintsUnlockAfterMin", unlockAfterInput, setUnlockAfterInput, "Hints: unlock after (min)")
        }
      />
    </section>
  );
}
