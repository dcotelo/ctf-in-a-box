"use client";

// Runtime admin management (issue #147).
//
// `event.yaml`'s `admins` are BAKED into the image and are the bootstrap set:
// they always authorize and cannot be revoked here, because they are the
// recovery path if a runtime grant goes wrong. Everything added on this tab
// lives in Redis and takes effect immediately, with no rebuild.
//
// Self-contained on purpose: it owns its own fetch/pending/error state rather
// than threading through admin-controls' `apply`, because it talks to a
// different endpoint with a different shape (a set, not a settings patch) and
// folding it into the shared helper would make that helper mean two things.

import { useEffect, useState } from "react";
import ConfirmModal from "@/components/confirm-modal";

type AdminRow = { login: string; baked: boolean };

/** The confirmation for removing a runtime admin (audit F8).
 *
 *  Removing someone else used to fire on the click, with no gate at all: one
 *  misclick and a colleague lost the panel mid-event. Removing YOURSELF was
 *  gated — by `window.confirm`, the only native dialog in the panel, which
 *  skipped the focus-managed styled dialog every other destructive action here
 *  uses.
 *
 *  Both go through the same dialog now. The self-removal keeps its own
 *  sentence, which was always the sharper one and names the consequence the
 *  other admin deserves to have stated too.
 *
 *  No `requireType`: this is recoverable by any admin who still has access,
 *  and the baked `event.yaml` set can never be removed here at all — it is the
 *  lockout recovery path. Exported for direct testing. */
export function adminRemoveConfirm(login: string, viewerLogin: string): { title: string; body: string; confirmLabel: string } {
  const self = login.toLowerCase() === viewerLogin.toLowerCase();
  return {
    title: self ? "Remove your own admin access?" : `Remove ${login} as an admin?`,
    body: self
      ? "You will lose this panel immediately. Another admin — or anyone in event.yaml's baked list — can grant it back."
      : `${login} loses access to this panel immediately. Nothing they have done is undone, and you can grant it back at any time.`,
    confirmLabel: "Remove admin",
  };
}

export default function AdminAdminsTab({ viewerLogin }: { viewerLogin: string }) {
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The login awaiting a removal confirmation, or null. */
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  // The one legitimate effect here: fetch the current list once, on mount.
  // Every setState is inside a promise callback, never in the effect body —
  // the distinction `react-hooks/set-state-in-effect` is drawing, and the
  // reason this is not written as `void load()`.
  useEffect(() => {
    let live = true;
    fetch("/api/admin/admins")
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { admins?: AdminRow[]; error?: string };
        if (!live) return;
        if (!res.ok) setError(data.error ?? "Could not load admins");
        else setRows(data.admins ?? []);
      })
      .catch(() => {
        if (live) setError("Could not load admins");
      });
    return () => {
      live = false;
    };
  }, []);

  async function mutate(method: "POST" | "DELETE", login: string) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/admins", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login }),
      });
      const data = (await res.json().catch(() => ({}))) as { admins?: AdminRow[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Request failed");
        return;
      }
      setRows(data.admins ?? []);
      setInput("");
      setNotice(method === "POST" ? `${login} is now an admin.` : `${login} is no longer an admin.`);
    } catch {
      setError("Request failed");
    } finally {
      setPending(false);
    }
  }

  const granted = rows?.filter((r) => !r.baked) ?? [];
  const baked = rows?.filter((r) => r.baked) ?? [];

  return (
    <section className="flex flex-col gap-4">
      <div className="ds-card rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
        <h3 className="font-mono text-sm text-white">Admins</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Grant or revoke organizer access without rebuilding. Changes take effect immediately.
        </p>

        <form
          className="mt-4 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const login = input.trim();
            if (login) void mutate("POST", login);
          }}
        >
          <label htmlFor="admin-login" className="sr-only">
            GitHub login
          </label>
          <input
            id="admin-login"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="github-login"
            autoComplete="off"
            spellCheck={false}
            className="min-w-48 rounded-md border border-white/10 bg-[#12121e] px-3 py-1.5 font-mono text-sm text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
          />
          <button
            type="submit"
            disabled={pending || input.trim() === ""}
            className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-xs text-zinc-200 transition-colors hover:border-[#2563eb]/45 hover:text-white disabled:opacity-40"
          >
            Add admin
          </button>
        </form>

        {error && (
          <p role="alert" className="mt-3 text-sm text-[#e53e3e]">
            {error}
          </p>
        )}
        {notice && !error && <p className="mt-3 text-sm text-[#22c55e]">{notice}</p>}

        <ul className="mt-4 flex flex-col gap-1">
          {baked.map((row) => (
            <li key={row.login} className="flex items-center justify-between gap-3 py-1">
              <span className="font-mono text-sm text-zinc-200">
                {row.login}
                <span className="ml-2 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs uppercase text-zinc-400">
                  event.yaml
                </span>
              </span>
              {/* Deliberately no remove control: this is the lockout recovery
                  path. The API refuses it too, so the missing button is a
                  courtesy, not the enforcement. */}
              <span className="font-mono text-xs text-zinc-500">rebuild to change</span>
            </li>
          ))}
          {granted.map((row) => (
            <li key={row.login} className="flex items-center justify-between gap-3 py-1">
              <span className="font-mono text-sm text-zinc-200">{row.login}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => setRemoveTarget(row.login)}
                className="rounded-md border border-white/10 px-2 py-1 font-mono text-xs text-zinc-400 transition-colors hover:border-[#e53e3e]/50 hover:text-[#e53e3e] disabled:opacity-40"
              >
                Remove
              </button>
            </li>
          ))}
          {rows !== null && granted.length === 0 && (
            <li className="py-1 text-sm text-zinc-500">No runtime admins yet.</li>
          )}
          {rows === null && !error && <li className="py-1 text-sm text-zinc-500">Loading…</li>}
        </ul>
      </div>

      {removeTarget !== null && (
        <ConfirmModal
          {...adminRemoveConfirm(removeTarget, viewerLogin)}
          danger
          pending={pending}
          onConfirm={() => {
            const login = removeTarget;
            setRemoveTarget(null);
            void mutate("DELETE", login);
          }}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </section>
  );
}
