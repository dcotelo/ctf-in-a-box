"use client";

// Compact in-row hint control for one challenge. Owns the purchase flow
// (idle → confirm → pending → error); the revealed text itself is rendered by
// the parent list from its purchased map, so a hint bought here and a hint
// loaded from GET /api/hints display identically. Signed-out visitors get a
// disabled lock teaser — the actual gate is the authenticated API route.

import { useState } from "react";
import type { AppId } from "@/lib/apps";

// ds-tap-24 grows the pointer target to the WCAG 2.5.8 minimum without
// changing the chip's visual box — the rows stack up to 110 deep, so the
// visible size has to stay small. See globals.css.
const CHIP =
  "ds-tap-24 flex-none rounded border px-1 text-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d29922]";

export default function HintButton({
  app,
  id,
  cost,
  signedIn,
  onPurchased,
}: {
  app: AppId;
  id: string;
  cost: number;
  signedIn: boolean;
  /** Called with the hint text and the viewer's new penalty total. */
  onPurchased: (app: AppId, id: string, text: string, spent: number) => void;
}) {
  const [state, setState] = useState<"idle" | "confirm" | "pending" | "error">("idle");
  const [error, setError] = useState("");

  if (!signedIn) {
    return (
      <button
        type="button"
        disabled
        title={`Sign in with GitHub to unlock hints (−${cost} pts each)`}
        aria-label="Sign in with GitHub to unlock hints"
        className={`${CHIP} cursor-not-allowed border-white/10 text-zinc-600`}
      >
        🔒
      </button>
    );
  }

  async function reveal() {
    setState("pending");
    try {
      const res = await fetch("/api/hints/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app, id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.hint !== "string") {
        throw new Error(typeof data.error === "string" ? data.error : "Hint reveal failed. Try again");
      }
      onPurchased(app, id, data.hint, Number(data.spent) || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hint reveal failed. Try again");
      setState("error");
    }
  }

  if (state === "confirm" || state === "pending") {
    return (
      <span className="flex flex-none items-center gap-1">
        <button
          type="button"
          onClick={reveal}
          disabled={state === "pending"}
          className={`${CHIP} border-[#d29922]/60 text-[#d29922] hover:bg-[#d29922]/10 disabled:opacity-50`}
        >
          {state === "pending" ? "…" : `−${cost} pts ✓`}
        </button>
        <button
          type="button"
          onClick={() => setState("idle")}
          disabled={state === "pending"}
          aria-label="Cancel"
          className={`${CHIP} border-white/10 text-muted hover:text-white disabled:opacity-50`}
        >
          ✕
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setState("confirm")}
      title={state === "error" ? `${error} (click to retry)` : `Reveal hint for ${cost} points`}
      className={`${CHIP} ${
        state === "error"
          ? "border-[#f85149]/60 text-[#f85149] hover:bg-[#f85149]/10"
          : "border-white/10 text-muted hover:border-[#d29922]/60 hover:text-[#d29922]"
      }`}
    >
      {state === "error" ? "⚠ retry" : `💡 −${cost}`}
    </button>
  );
}
