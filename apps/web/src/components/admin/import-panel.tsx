"use client";

// The bulk import/export panel the quiz and classic admin panels render under
// their item list. Collapsed by default: an organizer authoring one item at a
// time shouldn't have to scroll past a bulk panel to reach the list. Note the
// `<details>` rather than a `{open && ...}` toggle — `<details>` renders its
// children into the markup regardless of whether it is open (the collapse is
// native browser behavior, not conditional React rendering), so this stays
// collapsible for an organizer AND fully present for a `renderToStaticMarkup`
// test.
//
// Presentational. State and the POST live in `useBundleImport`; the three
// sentences that differ between modules (what export downloads, the export
// button's label, the never-deletes notice) are props.

import type { ChangeEvent, ReactNode } from "react";
import type { ImportError } from "@/components/admin/use-bundle-import";

function ErrorList({ errors }: { errors: ImportError[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm text-[#e53e3e]">
      {errors.map((err, i) => (
        <li key={i}>
          {err.where}: {err.message}
        </li>
      ))}
    </ul>
  );
}

export default function ImportPanel({
  exportDescription,
  exportLabel,
  exportDisabled,
  onExport,
  notice,
  text,
  pending,
  clientErrors,
  serverErrors,
  summary,
  canImport,
  onText,
  onFile,
  onSubmit,
}: {
  exportDescription: string;
  exportLabel: string;
  exportDisabled: boolean;
  onExport: () => void;
  /** THE notice a shorter file could otherwise be misread against — the
   *  client-side statement of the store's "import never deletes" guarantee. */
  notice: ReactNode;
  text: string;
  pending: boolean;
  clientErrors: ImportError[] | null;
  serverErrors: ImportError[] | null;
  /** The formatted after-import line, or null. */
  summary: string | null;
  canImport: boolean;
  onText: (value: string) => void;
  onFile: (e: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
}) {
  return (
    <details className="flex flex-col gap-3 border-t border-white/[0.06] pt-4">
      <summary className="cursor-pointer text-sm font-medium text-white">Bulk import / export</summary>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted">{exportDescription}</span>
          <button
            type="button"
            disabled={exportDisabled}
            onClick={onExport}
            className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/[0.04] disabled:opacity-40"
          >
            {exportLabel}
          </button>
        </div>

        <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3">
          <span className="text-sm text-white">Import a bundle</span>
          <p className="text-sm text-muted">{notice}</p>

          <textarea
            value={text}
            disabled={pending}
            onChange={(e) => onText(e.target.value)}
            rows={6}
            placeholder="Paste a bundle's JSON here, or choose a file below."
            className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-xs text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
          />

          <input type="file" accept=".json" disabled={pending} onChange={onFile} className="text-sm text-zinc-300" />

          {clientErrors && clientErrors.length > 0 && <ErrorList errors={clientErrors} />}

          {serverErrors && serverErrors.length > 0 && <ErrorList errors={serverErrors} />}

          {summary && <p className="text-sm text-white">{summary}</p>}

          <button
            type="button"
            disabled={pending || !canImport}
            onClick={onSubmit}
            className="self-start rounded-md bg-[#2563eb] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "Importing…" : "Import bundle"}
          </button>
        </div>
      </div>
    </details>
  );
}
