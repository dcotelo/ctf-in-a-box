"use client";

// The Overview screen (admin-redesign.md PR 1): "is scoring on, how many
// teams, is anything stuck" answered in one screen instead of three tabs.
// Replaces the old page-level Status card (folded in here as the sync
// health line) plus the pieces of Event that were really state, not
// settings.
//
// Read-only except the Scoring and Registration switches, which dispatch
// through the exact same `apply`/`setConfirm` flow admin-event-tab.tsx's
// checkboxes already use — same confirmation copy, same settings write.
//
// The team/player/submitted/stuck figures and the activity preview are each
// ONE fetch on mount, not a poll: PR 2 adds the 15s refresh this screen will
// eventually keep itself current with. Until then this is a snapshot as of
// when the organizer opened the tab, same as Insights already is.

import { useEffect, useState } from "react";
import type { AdminSettings, SyncStatus } from "@/lib/admin-store";
import { formatRelativeTime } from "@/lib/relative-time";
import { getRemaining, formatCompact } from "@/lib/countdown";
import type { ModuleSetupContent, ResolvedModule } from "@/lib/modules";
import { phaseBoundaryLabel, phaseFromSettings, PHASE_COLOR } from "@/components/phase";
import { setupCountLabel, setupStepStatus, type ModuleInventory } from "@/components/admin-module-setup";
import { formatWhen, TYPE_LABELS, type ActivityEntry } from "./admin-activity-tab";
import type { ConfirmState } from "./types";

type Funnel = { onATeam: number; attempted: number; stuck: number };
type MetricsResponse = { funnel: Funnel; teams: unknown[]; error?: string };
type ActivityResponse = { entries?: ActivityEntry[]; total?: number; error?: string };

function Figure({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3">
      <p className={`font-mono text-xl tabular-nums ${warn ? "text-[#d4a017]" : "text-white"}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

/** "Classic · setup complete · 4 categories · 12 challenges" — reusing the
 *  same step-status/count logic the full checklist panel renders with
 *  (admin-module-setup.tsx), so the two never disagree about what "done"
 *  means. A module the registry gave no setup block just says "enabled". */
export function moduleSummary(setup: ModuleSetupContent | undefined, inventory: ModuleInventory | undefined): string {
  if (!setup) return "enabled";
  const checkable = setup.steps.filter((s) => s.check);
  // Nothing countable (secure-development: every step is provisioning done
  // outside the panel) — there is no verdict to give, so none is given.
  if (checkable.length === 0) return "enabled";
  const statuses = checkable.map((s) => setupStepStatus(s, inventory));
  // The counts arrive from each module's own panel after ITS mount-time
  // fetch settles (see `inventory` in admin-controls.tsx). Until then the
  // honest word is "checking" — the same rule the checklist itself follows —
  // never "incomplete", which would accuse a fully set-up module on every
  // first paint.
  if (statuses.some((s) => s === "unknown")) return "checking…";
  const allDone = checkable.length > 0 && statuses.every((s) => s === "done");
  const counts = checkable
    .map((s) => setupCountLabel(s, inventory))
    .filter((label): label is string => label !== null && label !== "None yet");
  const parts = [allDone ? "setup complete" : "setup incomplete", ...counts];
  return parts.join(" · ");
}

export default function AdminOverviewTab({
  settings,
  pending,
  apply,
  setConfirm,
  nowMs,
  sync,
  modules,
  setups,
  inventory,
  onNavigate,
}: {
  settings: AdminSettings;
  pending: boolean;
  apply: (patch: Record<string, unknown>) => Promise<boolean>;
  setConfirm: (c: ConfirmState) => void;
  /** Same "as of" stamp the Event tab's schedule readout uses — see
   *  `settingsAt` in admin-controls.tsx. */
  nowMs: number;
  sync: SyncStatus | null;
  modules: readonly ResolvedModule[];
  setups?: Partial<Record<string, ModuleSetupContent>>;
  inventory: Record<string, ModuleInventory>;
  /** Switches to another destination in this same shell — the sidebar's own
   *  `onSelect`, threaded down so "linking to Activity" etc. is a real state
   *  change, not a second navigation mechanism. */
  onNavigate: (id: string) => void;
}) {
  const resolution = phaseFromSettings(settings, nowMs);
  const boundary = phaseBoundaryLabel(resolution.phase, resolution.startsAt, resolution.endsAt);
  const boundaryMs =
    resolution.phase === "registration" && resolution.startsAt
      ? Date.parse(resolution.startsAt)
      : resolution.phase === "live" && resolution.endsAt
        ? Date.parse(resolution.endsAt)
        : NaN;
  const remaining = Number.isFinite(boundaryMs) ? getRemaining(boundaryMs, nowMs) : null;

  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/admin/metrics")
      .then((res) => res.json())
      .then((data: MetricsResponse) => {
        if (live && !data.error) setMetrics(data);
      })
      .catch(() => {});
    fetch("/api/admin/activity?offset=0&limit=5")
      .then((res) => res.json())
      .then((data: ActivityResponse) => {
        if (live && Array.isArray(data.entries)) setActivity(data.entries);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const figures = metrics
    ? [
        { label: "Teams", value: metrics.teams.length },
        { label: "Players", value: metrics.funnel.onATeam },
        { label: "Submitted", value: metrics.funnel.attempted },
        { label: "Stuck", value: metrics.funnel.stuck, warn: metrics.funnel.stuck > 0 },
      ]
    : [];
  // Stuck is the one that matters live, so it leads when non-zero.
  const orderedFigures =
    metrics && metrics.funnel.stuck > 0 ? [figures[3], ...figures.slice(0, 3)] : figures;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
            style={{
              color: PHASE_COLOR[resolution.phase],
              borderColor: `${PHASE_COLOR[resolution.phase]}80`,
              background: `${PHASE_COLOR[resolution.phase]}1a`,
            }}
          >
            {resolution.phase}
          </span>
          {boundary && <span className="text-xs text-muted">{boundary}</span>}
          {remaining && <span className="text-xs text-muted">({formatCompact(remaining)} left)</span>}
        </div>

        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="text-white">Scoring</span>
            <span className="block text-xs text-muted">Pause new submissions from being scored.</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={!settings.paused}
            checked={!settings.paused}
            disabled={pending}
            onChange={(e) => {
              const next = !e.target.checked;
              setConfirm({
                title: next ? "Freeze scoring?" : "Unfreeze scoring?",
                body: next ? "New submissions will stop being scored for everyone." : "Scoring resumes for everyone.",
                confirmLabel: next ? "Freeze" : "Unfreeze",
                onConfirm: () => apply({ paused: next }),
              });
            }}
            className="h-5 w-5 flex-none accent-[#2563eb]"
          />
        </label>

        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="text-white">Registration</span>
            <span className="block text-xs text-muted">Allow players to create or join teams.</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={settings.teamRegistrationOpen}
            checked={settings.teamRegistrationOpen}
            disabled={pending}
            onChange={(e) => {
              const next = e.target.checked;
              setConfirm({
                title: next ? "Open team registration?" : "Close team registration?",
                body: next
                  ? "Players will be able to create and join teams."
                  : "Players will no longer be able to create or join teams.",
                confirmLabel: next ? "Open" : "Close",
                onConfirm: () => apply({ teamRegistrationOpen: next }),
              });
            }}
            className="h-5 w-5 flex-none accent-[#2563eb]"
          />
        </label>
      </section>

      {metrics && (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {orderedFigures.map((f) => (
            <Figure key={f.label} label={f.label} value={f.value} warn={f.warn} />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold text-white">Sync</h3>
        {sync ? (
          <details>
            {/* The one-line health check; the full breakdown — the whole old
                Status card — sits behind the disclosure. */}
            <summary className="cursor-pointer text-xs text-muted">
              last poll {sync.lastPollAt ? formatRelativeTime(sync.lastPollAt) : "never"} · ingested {sync.ingested} ·{" "}
              <span className={sync.dropped > 0 ? "text-[#d4a017]" : undefined}>dropped {sync.dropped}</span> ·{" "}
              {sync.paused ? "paused" : "running"}
            </summary>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Last poll</dt>
                <dd className="font-mono text-white">{sync.lastPollAt ? formatRelativeTime(sync.lastPollAt) : "never"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Ingested</dt>
                <dd className="font-mono tabular-nums text-white">{sync.ingested}</dd>
              </div>
              {/* Beside Ingested on purpose: the pair is the whole health
                  check. Amber only when nonzero — a warning colour on a
                  permanent zero teaches organizers to ignore the colour. */}
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Dropped</dt>
                <dd className={`font-mono tabular-nums ${sync.dropped > 0 ? "text-[#d4a017]" : "text-white"}`}>
                  {sync.dropped}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Repos polled</dt>
                <dd className="font-mono tabular-nums text-white">{sync.reposPolled}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Sync paused</dt>
                <dd className="font-mono text-white">{sync.paused ? "yes" : "no"}</dd>
              </div>
              {sync.lastDrop && (
                <div className="col-span-2 sm:col-span-5">
                  <dt className="text-xs uppercase tracking-wide text-muted">Last drop</dt>
                  <dd className="font-mono text-xs text-[#d4a017]">{sync.lastDrop}</dd>
                </div>
              )}
              {sync.lastError && (
                <div className="col-span-2 sm:col-span-5">
                  <dt className="text-xs uppercase tracking-wide text-muted">Last error</dt>
                  <dd className="font-mono text-xs text-[#e53e3e]">{sync.lastError}</dd>
                </div>
              )}
            </dl>
          </details>
        ) : (
          <p className="text-xs text-muted">Sync not running.</p>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Recent activity</h3>
          <button
            type="button"
            onClick={() => onNavigate("activity")}
            className="text-xs text-zinc-400 transition-colors hover:text-white"
          >
            View all
          </button>
        </div>
        {activity && activity.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs text-zinc-300">
            {activity.map((e, i) => (
              <li key={`${e.at}-${e.type}-${e.login}-${i}`} className="flex gap-2">
                <span className="font-mono tabular-nums text-muted">{formatWhen(e.at)}</span>
                <span>{TYPE_LABELS[e.type] ?? e.type}</span>
                <span className="font-mono text-white">{e.login}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">{activity ? "Nothing recorded yet." : "Loading…"}</p>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold text-white">Modules</h3>
        <ul className="flex flex-col gap-1">
          {modules.map((mod) => (
            <li key={mod.id}>
              <button
                type="button"
                onClick={() => onNavigate(mod.id)}
                className="text-xs text-zinc-300 transition-colors hover:text-white"
              >
                {mod.title} · {moduleSummary(setups?.[mod.id], inventory[mod.id])}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
