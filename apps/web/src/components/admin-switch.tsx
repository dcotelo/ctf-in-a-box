"use client";

// The one on/off settings control, used by every admin row that flips a
// boolean: the module switches, Freeze scoring and Team registration on
// Event, Scoring and Registration on Overview, Hints enabled. Before this
// each was a native checkbox that said nothing about whether the flip
// saved — a rejection landed as a developer-keyed string under the whole
// panel while the box kept the state the organizer asked for
// (admin-redesign.md § Controls; the boolean half of UX audit F2).
//
// Presentational, like AdminNumberField: the shell owns the value, the
// write and the per-row `status` it derives from that write; this renders
// the row and the three states beside it — "Saving…", "Saved", or the
// reason it was refused — through the same `FieldStatusLine` the numeric
// knobs use, so the two kinds of field never disagree about what a save
// looks like.
//
// The control itself is a real `<input type="checkbox" role="switch">`,
// visually replaced by a track: keyboard operation (Tab, Space), the label
// association, the disabled state and `aria-checked` all come from the
// browser, and a static render still exposes `checked` for the tests.

import type { ReactNode } from "react";
import { FieldStatusLine, type FieldStatus } from "./admin-number-field";

export default function AdminSwitch({
  id,
  label,
  help,
  checked,
  disabled,
  status,
  onChange,
}: {
  /** Stable id; the status line is `${id}-status` and the input points at it. */
  id: string;
  label: string;
  /** The row's explanation. A row that is disabled for a reason puts the
   *  reason here — a dead control with no explanation reads as a bug. */
  help?: ReactNode;
  checked: boolean;
  disabled: boolean;
  status: FieldStatus;
  /** Called with the state the organizer asked for. The shell decides what
   *  happens next — a confirm modal, a direct write — and reports back
   *  through `status`; this component never flips itself. */
  onChange: (next: boolean) => void;
}) {
  const statusId = `${id}-status`;
  const rejected = status.state === "rejected";
  const hasLine = status.state !== "idle";
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className={disabled && !checked ? "text-zinc-400" : "text-white"}>{label}</span>
          {help && <span className="block text-xs text-muted">{help}</span>}
        </span>
        <span className="relative inline-flex flex-none items-center">
          <input
            id={id}
            type="checkbox"
            role="switch"
            aria-checked={checked}
            checked={checked}
            disabled={disabled}
            aria-invalid={rejected ? true : undefined}
            aria-describedby={hasLine ? statusId : undefined}
            onChange={(e) => onChange(e.target.checked)}
            className="peer sr-only"
          />
          {/* The track and knob. Driven entirely by the input's state through
              `peer-*`, so there is no second source of truth to drift. */}
          <span
            aria-hidden="true"
            className="relative block h-5 w-9 rounded-full bg-white/15 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-[#2563eb] peer-checked:after:translate-x-4 peer-disabled:opacity-40 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#d4a017]"
          />
        </span>
      </label>
      <FieldStatusLine id={statusId} status={status} />
    </div>
  );
}
