"use client";

// Freeze / hints / hint-cost controls for the organizer admin page. All
// writes go through POST /api/admin/settings (auth + validation enforced
// server-side — see src/app/api/admin/settings/route.ts); this component is
// display + dispatch only, mirroring the shape of TeamCard.

import { useState } from "react";
import type { AdminSettings } from "@/lib/admin-store";

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

export default function AdminControls({ initial }: { initial: AdminSettings }) {
  const [settings, setSettings] = useState(initial);
  const [hintCostInput, setHintCostInput] = useState(initial.hintCost === null ? "" : String(initial.hintCost));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (patch: Record<string, unknown>) => {
    setPending(true);
    setError(null);
    const result = await postSettings(patch);
    if (result.error) setError(result.error);
    else if (result.settings) {
      setSettings(result.settings);
      setHintCostInput(result.settings.hintCost === null ? "" : String(result.settings.hintCost));
    }
    setPending(false);
  };

  const commitHintCost = () => {
    const value = Number(hintCostInput);
    if (hintCostInput.trim() === "" || !Number.isInteger(value) || value < 0) {
      setHintCostInput(settings.hintCost === null ? "" : String(settings.hintCost));
      return;
    }
    if (value === settings.hintCost) return;
    void apply({ hintCost: value });
  };

  return (
    <div className="ds-card flex flex-col gap-4 rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Controls</h2>

      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="text-white">Freeze scoring</span>
          <span className="block text-xs text-muted">Pause new submissions from being scored.</span>
        </span>
        <input
          type="checkbox"
          checked={settings.paused}
          disabled={pending}
          onChange={(e) => void apply({ paused: e.target.checked })}
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
          onChange={(e) => void apply({ teamRegistrationOpen: e.target.checked })}
          className="h-5 w-5 flex-none accent-[#2563eb]"
        />
      </label>

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
          onBlur={commitHintCost}
          className="w-28 flex-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-right text-sm text-white focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
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

      {settings.updatedBy && settings.updatedAt && (
        <p className="text-xs text-muted">
          last changed by {settings.updatedBy} at {settings.updatedAt}
        </p>
      )}
      {error && <p className="text-xs text-[#e53e3e]">{error}</p>}
    </div>
  );
}
