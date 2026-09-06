"use client";

// One module's Content screen (admin-redesign.md § Content screens): the
// sticky header — the module's own title and its enabled switch — the setup
// status line that opens into the checklist, the identity editor, and then
// the module's own controls (`children`: the quiz, classic, ai or
// secure-development panel). Extracted from admin-controls.tsx so the shell
// stays a shell; driven by the modules list and the `setups` map, so a fifth
// module gets this screen with no per-module branch.
//
// The enabled switch is the SAME control as the row on Event's Modules
// section — same status key (`module:<id>`), same lock rule and confirmation
// (module-toggle.ts) — so a flip made here reports "Saved" there too.
// Switching the module off keeps this panel mounted (the shell's tab list is
// the enabled set as of page load); the organizer sees the switch go off and
// the nav drop the module on their next load, exactly as Event's row says.
//
// Presentational: state and writes are the shell's, passed in.

import type { ReactNode } from "react";
import type { AdminSettings } from "@/lib/admin-store";
import type { ModuleSetupContent, ResolvedModule } from "@/lib/modules";
import AdminModuleSetup, { type ModuleInventory } from "@/components/admin-module-setup";
import AdminSwitch from "@/components/admin-switch";
import type { FieldStatus } from "@/components/admin-number-field";
import AdminModuleIdentity from "./admin-module-identity";
import { moduleToggleConfirm, moduleToggleState, type ModuleToggleChoice } from "./module-toggle";
import type { ConfirmState } from "./types";

export default function AdminModulePanel({
  mod,
  choice,
  liveModuleIds,
  liveCount,
  setup,
  inventory,
  defaults,
  settings,
  pending,
  apply,
  applyField,
  statusOf,
  setConfirm,
  children,
}: {
  mod: ResolvedModule;
  /** The registry's row for this module (label, whether it can be toggled). */
  choice: ModuleToggleChoice;
  /** The ids live right now: the runtime set, or the baked one when no
   *  override is stored. */
  liveModuleIds: readonly string[];
  /** Every live module the registry knows, toggleable or not — see
   *  module-toggle.ts for why the count is not "the toggleable ones". */
  liveCount: number;
  setup?: ModuleSetupContent;
  inventory?: ModuleInventory;
  /** Registry defaults for the identity editor's placeholders. */
  defaults: { title: string; blurb: string };
  settings: AdminSettings;
  pending: boolean;
  apply: (patch: Record<string, unknown>) => Promise<boolean>;
  applyField: (key: string, patch: Record<string, unknown>, label: string) => Promise<boolean>;
  statusOf: (key: string) => FieldStatus;
  setConfirm: (c: ConfirmState) => void;
  children: ReactNode;
}) {
  const live = new Set(liveModuleIds);
  const toggle = moduleToggleState(choice, live, liveCount);

  return (
    <section className="flex flex-col gap-4">
      {/* Sticky so the module's name and its switch stay in view while the
          organizer scrolls a long board. Opaque over the page background
          (globals.css --background) so rows never show through the text. */}
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 bg-[#1a1a2e]/95 px-1 py-2 backdrop-blur">
        <h2 className="text-base font-semibold text-white">{mod.title}</h2>
        <div className="w-56 max-w-full">
          <AdminSwitch
            id={`module-panel-${mod.id}`}
            label="Enabled"
            help={toggle.help}
            checked={toggle.on}
            disabled={pending || toggle.disabled}
            status={statusOf(`module:${mod.id}`)}
            onChange={(next) => {
              const c = moduleToggleConfirm(choice, next, live);
              setConfirm({
                title: c.title,
                body: c.body,
                confirmLabel: c.confirmLabel,
                onConfirm: () => applyField(`module:${mod.id}`, { enabledModules: c.ids }, choice.label),
              });
            }}
          />
        </div>
      </div>

      {setup && <AdminModuleSetup title={mod.title} setup={setup} inventory={inventory} />}

      <AdminModuleIdentity
        moduleId={mod.id}
        defaults={defaults}
        override={settings.moduleOverrides[mod.id as keyof AdminSettings["moduleOverrides"]]}
        pending={pending}
        apply={apply}
      />

      {children}
    </section>
  );
}
