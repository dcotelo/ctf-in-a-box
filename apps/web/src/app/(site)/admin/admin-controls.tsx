"use client";

// Freeze / hints / hint-cost controls for the organizer admin page. All
// writes go through POST /api/admin/settings (auth + validation enforced
// server-side — see src/app/api/admin/settings/route.ts); this component is
// display + dispatch only, mirroring the shape of TeamCard.

import { useState } from "react";
import type { ReactNode } from "react";
import type { AdminSettings } from "@/lib/admin-store";
import { eventConfig } from "@/lib/event-config";
import { enabledModules } from "@/lib/modules";
import ConfirmModal from "@/components/confirm-modal";

type ConfirmState = {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  requireType?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
};

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
        className="flex-none rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
      />
    </label>
  );
}

async function postSettings(patch: Record<string, unknown>): Promise<{ settings?: AdminSettings; error?: string }> {
  const res = await fetch("/api/admin/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = (await res.json().catch(() => ({}))) as { settings?: AdminSettings; error?: string };
  if (!res.ok) return { error: data.error ?? "Request failed" };
  return { settings: data.settings };
}

export default function AdminControls({ initial, demoMode = false }: { initial: AdminSettings; demoMode?: boolean }) {
  const [settings, setSettings] = useState(initial);
  const [hintCostInput, setHintCostInput] = useState(initial.hintCost === null ? "" : String(initial.hintCost));
  const [minSolvesInput, setMinSolvesInput] = useState(
    initial.hintsMinSolves === null ? "" : String(initial.hintsMinSolves),
  );
  const [unlockAfterInput, setUnlockAfterInput] = useState(
    initial.hintsUnlockAfterMin === null ? "" : String(initial.hintsUnlockAfterMin),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [resetInfo, setResetInfo] = useState<string | null>(null);

  const runConfirm = async () => {
    if (!confirm) return;
    setPending(true);
    try {
      await confirm.onConfirm();
    } finally {
      setPending(false);
      setConfirm(null);
    }
  };

  // Master reset: wipes all event data. Type-to-confirm gated in the modal;
  // the server re-checks the phrase and requires admin. On success the box is
  // frozen (the reset freezes scoring), so reflect that + show the counts.
  const doReset = async (confirmValue: string) => {
    setError(null);
    setResetInfo(null);
    const res = await fetch("/api/admin/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: confirmValue }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      cleared?: Record<string, number>;
      error?: string;
    };
    if (!res.ok) {
      setError(data.error ?? "Reset failed");
      return;
    }
    setSettings((s) => ({ ...s, paused: true }));
    const total = Object.values(data.cleared ?? {}).reduce((a, b) => a + b, 0);
    setResetInfo(`Wiped ${total} keys — scoring is now frozen. Unfreeze when you're ready.`);
  };

  // DEMO_MODE only: populate a demo leaderboard (fake contestants + teams).
  const doSeed = async () => {
    setError(null);
    setResetInfo(null);
    const res = await fetch("/api/admin/seed", { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as {
      contestants?: number;
      teams?: number;
      solves?: number;
      error?: string;
    };
    if (!res.ok) {
      setError(data.error ?? "Seed failed");
      return;
    }
    setResetInfo(
      `Seeded ${data.contestants} contestants, ${data.teams} teams, ${data.solves} solves. The board revalidates within ~30s.`,
    );
  };

  const apply = async (patch: Record<string, unknown>) => {
    setPending(true);
    setError(null);
    const result = await postSettings(patch);
    if (result.error) setError(result.error);
    else if (result.settings) {
      const s = result.settings;
      setSettings(s);
      setHintCostInput(s.hintCost === null ? "" : String(s.hintCost));
      setMinSolvesInput(s.hintsMinSolves === null ? "" : String(s.hintsMinSolves));
      setUnlockAfterInput(s.hintsUnlockAfterMin === null ? "" : String(s.hintsUnlockAfterMin));
    }
    setPending(false);
  };

  /** Shared commit for the numeric hint knobs: junk snaps back to the stored
   *  value, an unchanged value is a no-op, otherwise it's patched server-side
   *  (which re-validates the range — see admin-store). */
  const commitNumber = (
    key: "hintCost" | "hintsMinSolves" | "hintsUnlockAfterMin",
    raw: string,
    reset: (v: string) => void,
  ) => {
    const current = settings[key];
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isInteger(value) || value < 0) {
      reset(current === null ? "" : String(current));
      return;
    }
    if (value === current) return;
    void apply({ [key]: value });
  };

  return (
    <div className="ds-card flex flex-col gap-4 rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Controls</h2>

      <section className="flex flex-col gap-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Event</h3>

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

        <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-4">
          <div>
            <span className="text-white">Schedule (auto dates)</span>
            <span className="block text-xs text-muted">
              Optional. Times are your local time; leave blank for no bound. Scoring
              auto-freezes outside its window; registration auto-closes outside its
              window — on top of the manual toggles above.
            </span>
          </div>
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
          <div className="flex flex-col gap-3 rounded-md border border-[#2563eb]/30 bg-[#2563eb]/[0.04] p-4">
            <div>
              <span className="text-[#7aa2ff]">Demo mode</span>
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
              className="self-start rounded-md border border-[#2563eb]/50 px-3 py-1.5 text-sm font-medium text-[#7aa2ff] hover:bg-[#2563eb]/10 disabled:opacity-50"
            >
              Seed demo data
            </button>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-md border border-[#e53e3e]/30 bg-[#e53e3e]/[0.04] p-4">
          <div>
            <span className="text-[#e53e3e]">Danger zone</span>
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
            className="self-start rounded-md border border-[#e53e3e]/40 px-3 py-1.5 text-sm font-medium text-[#e53e3e] hover:bg-[#e53e3e]/10 disabled:opacity-50"
          >
            Reset event data…
          </button>
          {resetInfo && <p className="text-xs text-[#7dd3a0]">{resetInfo}</p>}
        </div>
      </section>

      {enabledModules.map((mod) => (
        <section key={mod.id} className="flex flex-col gap-4 border-t border-white/[0.06] pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{mod.displayName}</h3>

          {mod.id === "secure-development" ? (
            <>
              <label className="flex items-center justify-between gap-3">
                <span>
                  <span className="text-white">Hints enabled</span>
                  <span className="block text-xs text-muted">Overrides the environment default when set.</span>
                </span>
                <input
                  type="checkbox"
                  checked={settings.hintsEnabled ?? false}
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
          ) : (
            <p className="text-xs text-muted">No settings for this module yet.</p>
          )}
        </section>
      ))}

      {settings.updatedBy && settings.updatedAt && (
        <p className="text-xs text-muted">
          last changed by {settings.updatedBy} at {settings.updatedAt}
        </p>
      )}
      {error && <p className="text-xs text-[#e53e3e]">{error}</p>}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          requireType={confirm.requireType}
          danger={confirm.danger}
          pending={pending}
          onConfirm={() => void runConfirm()}
          onCancel={() => !pending && setConfirm(null)}
        />
      )}
    </div>
  );
}
