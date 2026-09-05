"use client";

// The sortable row list the quiz and classic admin panels share: one row per
// item with a grip, its title and a meta line, and four controls — Move up,
// Move down, Edit, Delete. Organizers drag rows to reorder; the per-row Move
// buttons are the keyboard-operable path, and not optional: dragging is a
// mouse gesture and cannot be the only way to reorder an organizer's own
// content. Both paths work out a pair of indices and hand them to the panel's
// `onMove`, which runs the shared `reorderRows` — so this component decides
// nothing about what the new order values ARE (see
// components/admin/ordered-rows.ts for why that split matters to testing).
//
// The collapsed list shows the public half only: what the meta line says is
// the panel's choice (`meta`), and the panels keep secrets — the correct
// choice, the flag — for the edit form, never for a list that might be on a
// projector.
//
// Owns exactly one piece of state, the index being dragged; everything else
// is the panel's.

import { useState, type ReactNode } from "react";

export default function SortableList<Row>({
  rows,
  keyOf,
  titleOf,
  meta,
  intro,
  emptyText,
  reorderPending,
  onMove,
  onEdit,
  onDelete,
}: {
  rows: readonly Row[];
  keyOf: (row: Row) => string;
  /** The row's title — shown truncated, and named in the move buttons'
   *  aria-labels. */
  titleOf: (row: Row) => string;
  /** The muted second line under the title. */
  meta: (row: Row) => ReactNode;
  /** The sentence above a non-empty list ("Drag a question to reorder it…"). */
  intro: string;
  /** What an empty list says ("No questions yet."). */
  emptyText: string;
  /** True while a reorder's writes are in flight — drag and the move buttons
   *  are held until it settles. */
  reorderPending: boolean;
  onMove: (from: number, to: number) => void;
  onEdit: (row: Row) => void;
  onDelete: (row: Row) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  if (rows.length === 0) return <p className="text-xs text-muted">{emptyText}</p>;

  return (
    <>
      <p className="text-xs text-muted">{intro}</p>
      <ul className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <li
            key={keyOf(row)}
            draggable={!reorderPending}
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) onMove(dragIndex, i);
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
            className="flex items-center justify-between gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="flex-none cursor-grab text-zinc-500">
                ⠿
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm text-white">{titleOf(row)}</p>
                <p className="text-xs text-muted">{meta(row)}</p>
              </div>
            </div>
            <div className="flex flex-none gap-2">
              <button
                type="button"
                aria-label={`Move "${titleOf(row)}" up`}
                disabled={reorderPending || i === 0}
                onClick={() => onMove(i, i - 1)}
                className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.04] disabled:opacity-40"
              >
                Move up
              </button>
              <button
                type="button"
                aria-label={`Move "${titleOf(row)}" down`}
                disabled={reorderPending || i === rows.length - 1}
                onClick={() => onMove(i, i + 1)}
                className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.04] disabled:opacity-40"
              >
                Move down
              </button>
              <button
                type="button"
                onClick={() => onEdit(row)}
                className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.04]"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onDelete(row)}
                className="rounded-md border border-[#e53e3e]/40 px-2 py-1 text-xs text-[#e53e3e] hover:bg-[#e53e3e]/10"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
