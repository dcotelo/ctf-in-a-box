"use client";

// Reusable confirmation dialog for disruptive admin actions. Two modes:
//   - plain (impactful, reversible): one-click Confirm.
//   - requireType set (destructive, irreversible): Confirm stays disabled until
//     the operator types the exact phrase, so a wipe can't be a single misclick.
// Display + gating only; the caller owns the action and its pending state.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

// Mount this only while open (`{confirm && <ConfirmModal .../>}`) so each open is
// a fresh mount — the typed-phrase state resets naturally, no effect needed.
export type ConfirmModalProps = {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  /** When set, the operator must type this exact string to enable Confirm. */
  requireType?: string;
  /** Red styling for destructive actions. */
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmModal({
  title,
  body,
  confirmLabel = "Confirm",
  requireType,
  danger = false,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [typed, setTyped] = useState("");

  // Escape cancels (but never while the action is in flight).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onCancel]);

  const typeOk = !requireType || typed === requireType;
  const confirmDisabled = pending || !typeOk;
  const accent = danger ? "bg-[#e53e3e] hover:bg-[#c53030]" : "bg-[#2563eb] hover:bg-[#1d4ed8]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => !pending && onCancel()}
    >
      <div
        className="w-full max-w-md rounded-lg border border-white/10 bg-[#16162a] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={`text-base font-semibold ${danger ? "text-[#e53e3e]" : "text-white"}`}>{title}</h3>
        <div className="mt-2 text-sm text-zinc-300">{body}</div>

        {requireType && (
          <label className="mt-4 block">
            <span className="block text-xs text-muted">
              Type <code className="rounded bg-white/10 px-1 text-white">{requireType}</code> to confirm
            </span>
            <input
              autoFocus
              value={typed}
              disabled={pending}
              onChange={(e) => setTyped(e.target.value)}
              className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white focus-visible:border-[#e53e3e]/60 focus-visible:outline-none"
            />
          </label>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/[0.04] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 ${accent}`}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
