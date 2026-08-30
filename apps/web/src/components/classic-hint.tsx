"use client";

// The classic challenge page's paid-hint control (#190): one button that
// charges and reveals through the SAME /api/hints/reveal endpoint the
// secure-development rows use — the server is the boundary that gates,
// charges idempotently, and never sends a text that wasn't paid for.
// Already-owned hints never reach this component: the page renders their
// text server-side and this button only exists while there is something to
// buy.

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ClassicHint({ id, cost }: { id: string; cost: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);

  async function reveal() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/hints/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app: "classic", id }),
      });
      const data = (await res.json().catch(() => ({}))) as { hint?: string; error?: string };
      if (res.ok && typeof data.hint === "string") {
        setText(data.hint);
        // Resync the page's server state (spent total, owned set) — the
        // revealed text itself stays in local state so it shows instantly.
        router.refresh();
      } else {
        setError(typeof data.error === "string" ? data.error : "Couldn't reveal the hint. Try again.");
      }
    } catch {
      setError("Couldn't reveal the hint. Try again.");
    } finally {
      setPending(false);
    }
  }

  // Announced, because this text REPLACES the button that was focused: without
  // a live region the click consumed points and produced silence for a
  // screen-reader user, with focus dropped to the document body.
  if (text) {
    return (
      <p
        role="status"
        className="rounded border-l-2 border-[#d4a017]/50 bg-[#d4a017]/[0.06] px-3 py-2 text-sm leading-relaxed text-[#d4a017]/90"
      >
        <span aria-hidden="true">💡</span> <span className="sr-only">Hint: </span>
        {text}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={reveal}
        disabled={pending}
        className="w-fit rounded-md border border-[#d4a017]/40 px-3 py-1.5 text-sm text-[#d4a017] transition-colors hover:bg-[#d4a017]/10 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
      >
        {pending ? (
          "Revealing…"
        ) : (
          <>
            <span aria-hidden="true">💡</span> Reveal hint (−{cost} pts)
          </>
        )}
      </button>
      {error && (
        <p role="alert" className="text-xs text-[#e53e3e]">
          {error}
        </p>
      )}
    </div>
  );
}
