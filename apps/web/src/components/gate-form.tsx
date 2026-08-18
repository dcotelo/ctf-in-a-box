"use client";

// Password form for the pre-event challenges gate. The password is only sent
// in the POST body; verification, throttling, and the unlock cookie all happen
// server-side in /api/gate.

import { useState, type FormEvent } from "react";

function lockedMessage(retryAfter: string | null): string {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    const hours = Math.ceil(seconds / 3600);
    return `Too many attempts. Try again in about ${hours} hour${hours === 1 ? "" : "s"}.`;
  }
  return "Too many attempts. Try again later.";
}

export default function GateForm() {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !password) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // Full document load on purpose: the router cache may hold the
        // prefetched proxy redirect for /challenges, and a hard navigation
        // bypasses it — router.push() would defeat that, so the lint rule's
        // suggestion doesn't apply here.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/challenges");
        return;
      }
      if (res.status === 429) {
        setError(lockedMessage(res.headers.get("Retry-After")));
      } else {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Something went wrong. Try again.");
      }
    } catch {
      setError("Something went wrong. Try again.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label htmlFor="gate-password" className="font-mono text-xs text-zinc-400">
        <span className="text-[#22c55e]">$</span> enter access password
      </label>
      <input
        id="gate-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="off"
        autoFocus
        className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-sm text-white placeholder:text-muted focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
        placeholder="••••••••"
      />
      <button
        type="submit"
        disabled={pending || !password}
        className="rounded-md bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1d4ed8] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
      >
        {pending ? "Checking…" : "Unlock challenges"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-[#e53e3e]">
          {error}
        </p>
      )}
      <p className="text-xs leading-relaxed text-muted">
        Five wrong attempts locks this address out for 24 hours.
      </p>
    </form>
  );
}
