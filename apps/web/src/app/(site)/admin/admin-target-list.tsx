"use client";

// The Secure Development tab's target checkbox list (issue #386, PR 2). One
// row per catalogue entry (lib/apps.ts) in catalogue order, checked against
// `settings.secureDevTargets` (or the all-six default when unset). The write
// belongs to this one field, so it goes through `applyField` and reports
// through the shared `FieldStatusLine`, exactly like every other row on this
// panel (admin-redesign.md § Controls) — there is no panel-wide `apply` for
// this list.
//
// Presentational: the shell (`admin-controls.tsx`, by way of
// `admin-secure-dev-tab.tsx`) owns `settings`/`pending` and the `applyField`/
// `statusOf` writers; nothing here writes to Redis directly.

import { apps, type AppId } from "@/lib/apps";
import { TARGET_IDS } from "@/lib/secure-dev-targets";
import { FieldStatusLine, type FieldStatus } from "@/components/admin-number-field";

/** The next target list after checking/unchecking `id`, in catalogue order —
 *  never the order the organizer happened to click boxes in, so the stored
 *  list and the checkbox order never disagree. `null` when the change would
 *  leave the list empty: the server refuses an empty `secureDevTargets`
 *  write (`checkSecureDevTargets`), and this is the pure decision the
 *  component uses to refuse it client-side too, before ever calling
 *  `applyField`. Exported for direct testing — no DOM required. */
export function nextTargets(current: readonly AppId[], id: AppId, checked: boolean): AppId[] | null {
  const wanted = new Set(current);
  if (checked) wanted.add(id);
  else wanted.delete(id);
  const ordered = TARGET_IDS.filter((t) => wanted.has(t));
  return ordered.length > 0 ? ordered : null;
}

const TARGETS_HELP_ID = "secure-dev-targets-help";
const TARGETS_STATUS_ID = "secure-dev-targets-status";
const MIN_TARGET_HELP_ID = "secure-dev-targets-min-help";

export default function AdminTargetList({
  targets,
  pending,
  statusOf,
  applyField,
}: {
  /** The running set — `settings.secureDevTargets ?? DEFAULT_SECURE_DEV_TARGETS`,
   *  resolved by the caller. */
  targets: readonly AppId[];
  pending: boolean;
  statusOf: (key: string) => FieldStatus;
  applyField: (key: string, patch: Record<string, unknown>, label: string) => Promise<boolean>;
}) {
  const status = statusOf("secureDevTargets");
  const hasLine = status.state !== "idle";
  const checked = new Set(targets);
  // Only meaningful when exactly one box is checked — the box that IS that
  // one target is the one that must not be uncheckable.
  const onlyTarget = targets.length === 1 ? targets[0] : null;

  return (
    <div className="flex flex-col gap-2">
      <div>
        <span className="text-white">Targets</span>
        <p id={TARGETS_HELP_ID} className="text-sm text-muted">
          Which targets this event runs. Contestants see only these; the poller reads the list every tick.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {apps.map((app) => {
          const isChecked = checked.has(app.id);
          const isOnlyChecked = isChecked && onlyTarget === app.id;
          const describedBy = [isOnlyChecked ? MIN_TARGET_HELP_ID : null, hasLine ? TARGETS_STATUS_ID : null]
            .filter(Boolean)
            .join(" ");
          return (
            <label key={app.id} htmlFor={`target-${app.id}`} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="secureDevTargets"
                value={app.id}
                id={`target-${app.id}`}
                checked={isChecked}
                disabled={pending || isOnlyChecked}
                aria-describedby={describedBy || undefined}
                onChange={(e) => {
                  const next = nextTargets(targets, app.id, e.target.checked);
                  if (next === null) return;
                  void applyField("secureDevTargets", { secureDevTargets: next }, "Targets");
                }}
                className="h-4 w-4 flex-none rounded border-white/20 bg-white/[0.03] accent-[#2563eb] disabled:opacity-40"
              />
              <span className={isOnlyChecked ? "text-zinc-400" : "text-white"}>{app.name}</span>
            </label>
          );
        })}
      </div>
      <p id={MIN_TARGET_HELP_ID} className="text-xs text-muted">
        At least one target must stay on.
      </p>
      <FieldStatusLine id={TARGETS_STATUS_ID} status={status} />
    </div>
  );
}
