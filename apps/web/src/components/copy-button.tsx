"use client";

// Copy-to-clipboard for values a contestant would otherwise retype by hand.
// The source text stays selectable on the page, and a clipboard failure says
// so on the button itself, so the reader is never left guessing whether the
// page is broken or just blocked.

import { useEffect, useState } from "react";

type Status = "idle" | "copied" | "failed";

export default function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");

  // Reset to idle on a timer, cancelled on unmount so React is never asked to
  // update a component that has gone.
  useEffect(() => {
    if (status === "idle") return;
    const timer = setTimeout(() => setStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [status]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      // Clipboard blocked — denied permission, or an insecure context. The
      // value is selectable right next to this button, so the failure state
      // below points at that instead of leaving the button looking inert.
      setStatus("failed");
    }
  }

  const visibleText =
    status === "copied" ? "Copied" : status === "failed" ? "Select it" : label;

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className="flex-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-xs text-zinc-300 transition-colors hover:border-white/20 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
    >
      {/* Purely visual: the accessible name is the stable aria-label above,
          so this swapping text must not also be a live region — otherwise
          the 2s revert to "Copy" reads to a screen reader as a bare, second,
          unprompted announcement with no user action behind it. */}
      <span aria-hidden="true">{visibleText}</span>
      {/* Separate polite region, set once on copy and then cleared. Clearing
          a live region doesn't announce, so this fires exactly once per
          copy instead of the double-announce a text-swapping accessible
          name would otherwise produce. */}
      <span className="sr-only" aria-live="polite">
        {status === "copied" ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}
