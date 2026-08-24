"use client";

// The Event tab: the control-plane settings that belong to the platform
// itself rather than to any one module — the scoring freeze, team
// registration, the scheduling windows, demo seeding, and the master reset.
//
// Presentational: every piece of state it reads (`settings`, `pending`,
// `resetInfo`) and every mutation it triggers (`apply`, `setConfirm`,
// `doReset`, `doSeed`) is owned by `admin-controls.tsx` and passed in, so the
// shell stays the single writer of settings state across all tabs.

import { useState } from "react";
import type { AdminSettings } from "@/lib/admin-store";
import { outsideWindow } from "@/lib/schedule-window";
import { TEAM_MAX_MEMBERS, TEAM_MAX_MEMBERS_MAX } from "@/lib/team-limits";
import { eventConfig } from "@/lib/event-config";
import type { CommitNumber, ConfirmState } from "./types";

// datetime-local <-> ISO. The <input type="datetime-local"> value is a naive
// local wall-clock string; JS parses it as local time, and we store the
// absolute instant as ISO. Empty input clears the bound (null).
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(s: string): string | null {
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function ScheduleField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string | null;
  disabled: boolean;
  onCommit: (iso: string | null) => void;
}) {
  const [input, setInput] = useState(toLocalInput(value));
  // Re-sync when the applied value changes (another field's POST returns fresh settings).
  const canonical = toLocalInput(value);
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="datetime-local"
        value={input}
        disabled={disabled}
        onChange={(e) => setInput(e.target.value)}
        onBlur={() => {
          if (input !== canonical) onCommit(fromLocalInput(input));
        }}
        className="flex-none rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#d29922]/70 focus-visible:outline-none"
      />
    </label>
  );
}

export type AdminEventTabProps = {
  settings: AdminSettings;
  pending: boolean;
  demoMode: boolean;
  resetInfo: string | null;
  apply: (patch: Record<string, unknown>) => Promise<boolean>;
  setConfirm: (c: ConfirmState) => void;
  doReset: (confirmValue: string) => Promise<void>;
  doSeed: () => Promise<void>;
  teamMaxMembersInput: string;
  setTeamMaxMembersInput: (v: string) => void;
  commitNumber: CommitNumber;
  /** Every module the registry knows about, with the name an organizer would
   *  recognise and whether this event may toggle it (issue #175). Includes the
   *  DISABLED ones — a switch you cannot see is not a switch. */
  moduleChoices: readonly ModuleChoice[];
  /** The ids live right now: the runtime set, or the baked one when no
   *  override is stored. */
  liveModuleIds: readonly string[];
};

export type ModuleChoice = {
  id: string;
  label: string;
  /** False for secure-development, which is provisioning rather than a flag.
   *  `reason` says so on the row instead of leaving a dead control. */
  toggleable: boolean;
  reason?: string;
};

export default function AdminEventTab({
  settings,
  pending,
  demoMode,
  resetInfo,
  apply,
  setConfirm,
  doReset,
  doSeed,
  teamMaxMembersInput,
  setTeamMaxMembersInput,
  commitNumber,
  moduleChoices,
  liveModuleIds,
}: AdminEventTabProps) {
  const live = new Set(liveModuleIds);
  // The last LIVE module cannot be switched off — the server refuses a set that
  // would end up empty (ADR 24's runtime analogue), and a control that always
  // errors is worse than one that explains itself.
  //
  // Counted over every live module, INCLUDING the ones that cannot be toggled.
  // Counting only the toggleable ones was wrong: on an event running
  // secure-development plus quiz, it locked quiz on the grounds that quiz was
  // the last *switchable* module — while secure-development sat right above it,
  // enabled and serving. The event would have been left with content, the
  // server would have accepted the change, and the UI refused it anyway. What
  // makes a set legal is that SOMETHING is live, not that something switchable
  // is live.
  const liveCount = moduleChoices.filter((m) => live.has(m.id)).length;
  // Effective state for the schedule section's readout — the same
  // toggle-AND-window rule effectivePaused / effectiveRegistrationOpen apply
  // server-side, built on the shared outsideWindow. Client render time is an
  // acceptable "now": the readout re-computes on every settings change, and
  // an organizer parked on the tab across a boundary sees it on their next
  // interaction.
  const nowMs = Date.now();
  const scoringLiveNow = !settings.paused && !outsideWindow(nowMs, settings.scoringStartsAt, settings.scoringEndsAt);
  const registrationOpenNow =
    settings.teamRegistrationOpen && !outsideWindow(nowMs, settings.registrationStartsAt, settings.registrationEndsAt);
  // No "Event" heading inside the panel: the old flat layout needed an <h3> to
  // separate this group from the module sections below it, but the tab strip is
  // that heading now (the panel is labelled by its own tab via
  // aria-labelledby, and module panels carry no equivalent heading either), so
  // repeating it would just duplicate the tab's own label.
  return (
    <section className="flex flex-col gap-4">
      <section className="flex flex-col gap-2 border-b border-white/[0.06] pb-4">
        <div>
          <h3 className="text-white">Modules</h3>
          <p className="text-xs text-muted">
            What this event serves. Switching one off hides its board and its nav link straight away —
            it deletes nothing, so switching it back on restores the same answers, solves and points.
          </p>
        </div>
        {moduleChoices.map((mod) => {
          const on = live.has(mod.id);
          const isLastOn = on && mod.toggleable && liveCount === 1;
          const disabled = pending || !mod.toggleable || isLastOn;
          return (
            <label key={mod.id} className="flex items-center justify-between gap-3">
              <span>
                <span className={mod.toggleable ? "text-white" : "text-zinc-400"}>{mod.label}</span>
                {!mod.toggleable && mod.reason && <span className="block text-xs text-muted">{mod.reason}</span>}
                {isLastOn && (
                  <span className="block text-xs text-muted">
                    The only module left — an event has to serve something.
                  </span>
                )}
              </span>
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={(e) => {
                  const next = e.target.checked;
                  const ids = next
                    ? [...live, mod.id]
                    : [...live].filter((id) => id !== mod.id);
                  setConfirm({
                    title: next ? `Enable ${mod.label}?` : `Disable ${mod.label}?`,
                    body: next
                      ? `${mod.label} appears in the nav and its board opens, for everyone, on their next page load.`
                      : `${mod.label} disappears from the nav and its board stops resolving, for everyone, on their next page load. Nothing is deleted — enabling it again brings the same board back.`,
                    confirmLabel: next ? "Enable" : "Disable",
                    onConfirm: () => apply({ enabledModules: ids }),
                  });
                }}
                className="h-5 w-5 flex-none accent-[#2563eb] disabled:opacity-40"
              />
            </label>
          );
        })}
      </section>

      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="text-white">Freeze scoring</span>
          <span className="block text-xs text-muted">Pause new submissions from being scored.</span>
        </span>
        <input
          type="checkbox"
          checked={settings.paused}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            setConfirm({
              title: next ? "Freeze scoring?" : "Unfreeze scoring?",
              body: next
                ? "New submissions will stop being scored for everyone."
                : "Scoring resumes for everyone.",
              confirmLabel: next ? "Freeze" : "Unfreeze",
              onConfirm: () => apply({ paused: next }),
            });
          }}
          className="h-5 w-5 flex-none accent-[#2563eb]"
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="text-white">Team registration open</span>
          <span className="block text-xs text-muted">Allow players to create or join teams.</span>
        </span>
        <input
          type="checkbox"
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

      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="text-white">Players per team</span>
          <span className="block text-xs text-muted">
            Enforced when someone joins. Lowering it never removes anyone from a team
            that is already larger — those teams keep their players and simply cannot
            take another. Blank uses the default ({TEAM_MAX_MEMBERS}).
          </span>
        </span>
        <input
          type="number"
          min={1}
          max={TEAM_MAX_MEMBERS_MAX}
          value={teamMaxMembersInput}
          placeholder={String(TEAM_MAX_MEMBERS)}
          disabled={pending}
          onChange={(e) => setTeamMaxMembersInput(e.target.value)}
          onBlur={() => commitNumber("teamMaxMembers", teamMaxMembersInput, setTeamMaxMembersInput)}
          className="w-28 flex-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-right text-sm text-white focus-visible:border-[#d29922]/70 focus-visible:outline-none"
        />
      </label>

      <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-4">
        <div>
          <span className="text-white">Schedule (auto dates)</span>
          <span className="block text-xs text-muted">
            Optional. Times are your local time; leave blank for no bound. Scoring
            auto-freezes outside its window; registration auto-closes outside its
            window — on top of the manual toggles above.
          </span>
        </div>
        {/* The EFFECTIVE state, computed from the same fields this section
            edits — manual toggle AND window, via the shared outsideWindow
            (the app's copy of the three-reader contract). Without it the
            organizer does that boolean in their head from four datetime
            fields plus two toggles, mid-event (issue #200, 3.3). Client
            render time is the "now"; it refreshes with every edit. */}
        <p className="text-xs leading-relaxed">
          <span className="uppercase tracking-wider text-muted">Right now: </span>
          <span className={scoringLiveNow ? "text-[#3fb950]" : "text-[#d29922]"}>
            scoring {scoringLiveNow ? "is live" : settings.paused ? "is frozen (manual)" : "is frozen (outside its window)"}
          </span>
          <span className="text-muted"> · </span>
          <span className={registrationOpenNow ? "text-[#3fb950]" : "text-[#d29922]"}>
            registration {registrationOpenNow ? "is open" : settings.teamRegistrationOpen ? "is closed (outside its window)" : "is closed (manual)"}
          </span>
        </p>
        <ScheduleField
          key={`ss-${settings.scoringStartsAt ?? ""}`}
          label="Scoring opens"
          value={settings.scoringStartsAt}
          disabled={pending}
          onCommit={(iso) => void apply({ scoringStartsAt: iso })}
        />
        <ScheduleField
          key={`se-${settings.scoringEndsAt ?? ""}`}
          label="Scoring closes"
          value={settings.scoringEndsAt}
          disabled={pending}
          onCommit={(iso) => void apply({ scoringEndsAt: iso })}
        />
        <ScheduleField
          key={`rs-${settings.registrationStartsAt ?? ""}`}
          label="Registration opens"
          value={settings.registrationStartsAt}
          disabled={pending}
          onCommit={(iso) => void apply({ registrationStartsAt: iso })}
        />
        <ScheduleField
          key={`re-${settings.registrationEndsAt ?? ""}`}
          label="Registration closes"
          value={settings.registrationEndsAt}
          disabled={pending}
          onCommit={(iso) => void apply({ registrationEndsAt: iso })}
        />
      </div>

      {demoMode && (
        <div className="flex flex-col gap-3 rounded-md border border-[#e6edf3]/30 bg-[#e6edf3]/[0.04] p-4">
          <div>
            <span className="text-[#e6edf3]">Demo mode</span>
            <span className="block text-xs text-muted">
              Populate the leaderboard with fake contestants, teams, and solves to
              preview the app. Injects real-challenge-id scores so points render.
              Only shown because <code>DEMO_MODE</code> is set — never in a real event.
            </span>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              setConfirm({
                title: "Seed demo data?",
                confirmLabel: "Seed",
                body: "Adds fake contestants, teams, and solves to the leaderboard. Run a master reset to clear them.",
                onConfirm: doSeed,
              })
            }
            className="self-start rounded-md border border-[#e6edf3]/45 px-3 py-1.5 text-sm font-medium text-[#e6edf3] hover:bg-white/[0.06] disabled:opacity-50"
          >
            Seed demo data
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-md border border-[#f85149]/30 bg-[#f85149]/[0.04] p-4">
        <div>
          <span className="text-[#f85149]">Danger zone</span>
          <span className="block text-xs text-muted">
            Master reset wipes <strong>all</strong> event data — teams, points,
            per-player data, and hint spend. It freezes scoring and can&apos;t be
            undone. In poll mode, also clear the source PR comments for a wipe that
            stays gone after you unfreeze.
          </span>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            setConfirm({
              title: "Reset all event data?",
              danger: true,
              confirmLabel: "Wipe everything",
              requireType: eventConfig.name,
              body: (
                <>
                  This permanently deletes every team, score, player record, and
                  hint purchase, and freezes scoring. This cannot be undone.
                </>
              ),
              onConfirm: () => doReset(eventConfig.name),
            })
          }
          className="self-start rounded-md border border-[#f85149]/40 px-3 py-1.5 text-sm font-medium text-[#f85149] hover:bg-[#f85149]/10 disabled:opacity-50"
        >
          Reset event data…
        </button>
        {resetInfo && <p className="text-xs text-[#7dd3a0]">{resetInfo}</p>}
      </div>
    </section>
  );
}
