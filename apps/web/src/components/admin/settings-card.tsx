"use client";

// The compact settings card at the top of every module's Content screen
// (admin-redesign.md § Content screens): title · blurb · the module's own
// knobs (cooldown, retry gate) · a link to the Hints screen. Before this the
// identity editor was its own bordered block with a four-line help text and
// the knobs floated bare under it, on every module tab (redesign § Why 6).
//
// Presentational and module-agnostic. The shell hands each module panel the
// identity editor already built (it is driven by the modules list, not by
// any module's code) and the panel places its knobs as `children`; the link
// to Hints is offered only by modules that sell hints — the quiz does not.

import type { ReactNode } from "react";

/** What the shell hands a module's controls so they can render the card:
 *  the identity editor and, for a module that sells hints, the way to the
 *  Hints screen. Optional on every module panel — absent (the tests, a
 *  standalone render) the knobs render bare, exactly as before. */
export type ModuleSettingsSlot = { identity: ReactNode; onHints?: () => void };

export default function AdminSettingsCard({
  identity,
  onHints,
  children,
}: {
  /** The title/blurb editor for this module (admin-module-identity.tsx). */
  identity: ReactNode;
  /** Switches the shell to the Hints screen. Omit for a module with no
   *  hints to price. */
  onHints?: () => void;
  /** The module's own knobs, in the order its panel wants them. */
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-md border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Settings</h3>
        {onHints && (
          <button type="button" onClick={onHints} className="text-sm text-zinc-400 transition-colors hover:text-white">
            Hint pricing is on the Hints screen →
          </button>
        )}
      </div>
      {identity}
      {children}
    </section>
  );
}
