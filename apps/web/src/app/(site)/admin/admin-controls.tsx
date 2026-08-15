"use client";

// Freeze / hints / hint-cost controls for the organizer admin page. All
// writes go through POST /api/admin/settings (auth + validation enforced
// server-side — see src/app/api/admin/settings/route.ts); this component is
// display + dispatch only, mirroring the shape of TeamCard.

import { useState } from "react";
import type { AdminSettings } from "@/lib/admin-store";

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

      {settings.updatedBy && settings.updatedAt && (
        <p className="text-xs text-muted">
          last changed by {settings.updatedBy} at {settings.updatedAt}
        </p>
      )}
      {error && <p className="text-xs text-[#e53e3e]">{error}</p>}
    </div>
  );
}
