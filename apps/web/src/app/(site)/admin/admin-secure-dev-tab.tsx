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
// draft input string, `apply`/`commitNumber` and the per-field save status;
// nothing here writes to Redis directly.

import type { AdminSettings } from "@/lib/admin-store";
import { SCORE_COOLDOWN_MIN, SCORE_COOLDOWN_MIN_MAX } from "@/lib/scoring-defaults";
import AdminNumberField, { type FieldStatus } from "@/components/admin-number-field";
import type { CommitNumber } from "./types";

export type AdminSecureDevTabProps = {
  settings: AdminSettings;
  pending: boolean;
  apply: (patch: Record<string, unknown>) => Promise<boolean>;
  commitNumber: CommitNumber;
  /** The shell's per-field save status, by stored key (UX audit F2). */
  statusOf: (key: string) => FieldStatus;
  cooldownInput: string;
  setCooldownInput: (v: string) => void;
};

const COOLDOWN_LABEL = "Re-run cooldown (min)";

export default function AdminSecureDevTab({ pending, commitNumber, statusOf, cooldownInput, setCooldownInput }: AdminSecureDevTabProps) {
  return (
    <AdminNumberField
      id="score-cooldown-min"
      label={COOLDOWN_LABEL}
      help={
        <>
          Minimum minutes between SCORED runs on the same PR. Every run hands back a per-challenge pass/fail, so a
          short cooldown lets a contestant iterate a check-gaming patch against the rubric. 0 disables it. Takes
          effect on the next push — each fork&apos;s Action reads this value when it runs. Hint policy is on the
          Event tab.
        </>
      }
      value={cooldownInput}
      placeholder={String(SCORE_COOLDOWN_MIN)}
      max={SCORE_COOLDOWN_MIN_MAX}
      disabled={pending}
      status={statusOf("scoreCooldownMin")}
      onChange={setCooldownInput}
      onBlur={() => commitNumber("scoreCooldownMin", cooldownInput, setCooldownInput, COOLDOWN_LABEL)}
    />
  );
}
