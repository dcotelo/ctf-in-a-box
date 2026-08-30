"use client";

// Reusable confirmation dialog for disruptive admin actions. Two modes:
//   - plain (impactful, reversible): one-click Confirm.
//   - requireType set (destructive, irreversible): Confirm stays disabled until
//     the operator types the exact phrase, so a wipe can't be a single misclick.
// Display + gating only; the caller owns the action and its pending state.

import { useEffect, useRef, useState } from "react";
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

  const panelRef = useRef<HTMLDivElement>(null);

  // Focus management for a modal dialog (WAI-ARIA "Dialog (Modal)"). The
  // markup already claimed `aria-modal="true"`, but nothing enforced it: Tab
  // walked straight out of the dialog into the admin page behind the overlay,
  // where an operator could keep tabbing — and pressing — controls they could
  // not see, on the one surface in this app whose buttons wipe an event. A
  // dialog that says it is modal has to actually be.
  //
  // Three things happen here, in the order the pattern calls for:
  //
  //   1. Focus moves INTO the dialog on mount. The typed-phrase input already
  //      autoFocuses when there is one; the plain confirm mode had no focus
  //      target at all, so focus stayed on a trigger that is now behind the
  //      overlay and a screen reader announced nothing. Falls back to the
  //      panel itself (tabIndex={-1}) when the dialog has no controls yet.
  //   2. Tab and Shift+Tab wrap within the dialog's own focusables.
  //   3. Focus returns to whatever opened the dialog when it unmounts, so a
  //      keyboard operator resumes where they were rather than at the top of
  //      the document.
  //
  // The dialog is mounted only while open (see the note on ConfirmModalProps),
  // so mount/unmount IS open/close and these can be plain mount effects.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // Let autoFocus win when the typed-phrase input is present; otherwise put
    // focus on the panel so the dialog's name is announced.
    if (!panelRef.current?.contains(document.activeElement)) {
      panelRef.current?.focus();
    }
    return () => opener?.focus?.();
  }, []);

  // Escape cancels (but never while the action is in flight), and Tab is
  // confined to the dialog. Both live on one listener because both are the
  // same contract: while this is open, the keyboard belongs to it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) {
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      // Queried per keypress rather than cached: the Confirm button flips
      // between enabled and disabled as the phrase is typed, and a disabled
      // button is not focusable — a cached list would wrap to a control the
      // browser then skips.
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || activeEl === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onCancel]);

  const typeOk = !requireType || typed === requireType;
  const confirmDisabled = pending || !typeOk;
  const accent = danger ? "bg-[#e53e3e] hover:bg-[#e53e3e]" : "bg-[#2563eb] hover:bg-[#1d4ed8]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => !pending && onCancel()}
    >
      {/* tabIndex={-1} makes the panel a programmatic focus target only — it
          is never reached by Tab, so it is the one place in this app that
          suppresses the amber ring rather than showing it: a ring drawn
          around the whole dialog the moment it opens reads as an error
          state, and there is no keyboard user to serve it to. Every control
          INSIDE keeps its ring. */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-lg border border-white/10 bg-[#16162a] p-5 shadow-2xl focus:outline-none"
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
              className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white focus-visible:border-[#e53e3e]/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
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
