"use client";

// The setup checklist that opens every module's admin tab — the rendering of
// `ModuleDef.setup` (see `ModuleSetupContent` in `@/lib/modules`). One
// component for all four modules, and for the next one: the content is
// registry data, this is the only renderer, so a new module gets its panel by
// filling in a registry block and nothing else.
//
// Purely presentational. The content arrives already resolved (the registry
// block is a function of live event facts and is CALLED server-side, in
// /admin's page — see `getModuleSetup`), and the live counts arrive as
// `inventory`, reported up to the shell by the module's own list panel once
// its mount-time fetch has settled. Until that happens `inventory` is
// undefined and a checkable step says "Checking…": on first paint the panel
// does not yet know whether questions exist, and saying "None yet" there
// would be a lie for the second it takes the list to load.
//
// A `<details open>` rather than a plain block: an organizer who has set the
// module up can fold it out of the way for the rest of the event, and the
// native disclosure keeps the whole checklist in the static markup — the
// same reasoning the bulk import/export panels give for `<details>`.

import type { ModuleSetupContent, SetupStep } from "@/lib/modules";
import ModuleCopy from "@/components/module-copy";

/** The counts a module's list panel knows about itself. Every key optional:
 *  the quiz has no categories, and a panel that has not loaded yet has
 *  neither. */
export type ModuleInventory = { items?: number; categories?: number };

export type SetupStepStatus = "done" | "todo" | "unknown";

/** What the panel can honestly say about one step. `null` for a step that
 *  declares no `check` — nothing to say, so nothing is shown. `"unknown"`
 *  while the count it depends on has not been reported; never a tick or a
 *  cross the panel cannot back. Exported for direct testing. */
export function setupStepStatus(step: SetupStep, inventory: ModuleInventory | undefined): SetupStepStatus | null {
  if (!step.check) return null;
  const n = inventory?.[step.check.count];
  if (typeof n !== "number") return "unknown";
  return n > 0 ? "done" : "todo";
}

/** The count line beside a checkable step: "Checking…", "None yet", or
 *  "3 questions" / "1 question". Exported for direct testing. */
export function setupCountLabel(step: SetupStep, inventory: ModuleInventory | undefined): string | null {
  const status = setupStepStatus(step, inventory);
  if (status === null || !step.check) return null;
  if (status === "unknown") return "Checking…";
  if (status === "todo") return "None yet";
  const n = inventory?.[step.check.count] ?? 0;
  const noun = n === 1 ? (step.check.one ?? step.check.noun.replace(/s$/, "")) : step.check.noun;
  return `${n} ${noun}`;
}

const STATUS_CLASS: Record<SetupStepStatus, string> = {
  done: "text-[#22c55e]",
  todo: "text-[#d4a017]",
  unknown: "text-muted",
};

export default function AdminModuleSetup({
  title,
  setup,
  inventory,
}: {
  /** The module's resolved title — the tab's own label. */
  title: string;
  setup: ModuleSetupContent;
  inventory?: ModuleInventory;
}) {
  return (
    <details open className="border-b border-white/[0.06] pb-4">
      <summary className="cursor-pointer text-sm font-medium text-white">Setting up {title}</summary>
      <p className="mt-2 text-xs text-muted">{setup.experience}</p>

      <ol className="mt-3 flex flex-col gap-2">
        {setup.steps.map((step, i) => {
          const status = setupStepStatus(step, inventory);
          const label = setupCountLabel(step, inventory);
          return (
            <li key={step.title} className="flex items-start gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs">
              <span aria-hidden="true" className="w-4 flex-none font-mono text-muted">
                {i + 1}.
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-white">{step.title}</p>
                {step.body && (
                  <p className="mt-0.5 text-muted">
                    <ModuleCopy copy={step.body} />
                  </p>
                )}
              </div>
              <div className="flex flex-none flex-col items-end gap-1">
                {/* Where the step is done — the one fact an organizer hunting
                    in the wrong place needs. */}
                <span className="rounded border border-white/10 px-1.5 py-0.5 text-xs text-muted">
                  {step.where === "panel" ? "In this panel" : "Outside this panel"}
                </span>
                {status && label && <span className={`text-xs ${STATUS_CLASS[status]}`}>{label}</span>}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs text-white">Safe to change mid-event</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-xs text-muted">
            {setup.midEvent.safe.map((line, i) => (
              <li key={i}>
                <ModuleCopy copy={line} />
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs text-white">Not safe mid-event</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-xs text-muted">
            {setup.midEvent.unsafe.map((line, i) => (
              <li key={i}>
                <ModuleCopy copy={line} />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-3 text-xs">
        <a href={setup.docs.href} target="_blank" rel="noopener noreferrer" className="ds-link">
          {setup.docs.label}
        </a>
      </p>
    </details>
  );
}
