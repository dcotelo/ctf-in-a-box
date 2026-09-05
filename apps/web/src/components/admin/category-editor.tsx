"use client";

// The category manager the classic and ai admin panels render above their
// challenge list: the current list with keyboard-operable Move up / Move down
// and Remove per row, and a New-category input with its Add button. The two
// panels' JSX for this was byte-identical; this is that JSX, once.
//
// Presentational. State and writes live in `useCategoryEditor`; the panel
// wires the two together.

import { INPUT_CLASS } from "@/components/admin/editor-fields";

export default function CategoryEditor({
  categories,
  input,
  error,
  pending,
  onInput,
  onAdd,
  onRemove,
  onMove,
}: {
  categories: readonly string[];
  input: string;
  error: string | null;
  pending: boolean;
  onInput: (value: string) => void;
  onAdd: () => void;
  onRemove: (name: string) => void;
  onMove: (from: number, to: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-white">Categories</span>
      </div>
      {error && <p className="text-xs text-[#e53e3e]">{error}</p>}
      {categories.length === 0 ? (
        <p className="text-xs text-muted">No categories yet — add one before authoring a challenge.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {categories.map((name, i) => (
            <li
              key={name}
              className="flex items-center justify-between gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
            >
              <span className="truncate text-sm text-white">{name}</span>
              <div className="flex flex-none gap-2">
                <button
                  type="button"
                  aria-label={`Move "${name}" up`}
                  disabled={pending || i === 0}
                  onClick={() => onMove(i, i - 1)}
                  className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.04] disabled:opacity-40"
                >
                  Move up
                </button>
                <button
                  type="button"
                  aria-label={`Move "${name}" down`}
                  disabled={pending || i === categories.length - 1}
                  onClick={() => onMove(i, i + 1)}
                  className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/[0.04] disabled:opacity-40"
                >
                  Move down
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onRemove(name)}
                  className="rounded-md border border-[#e53e3e]/40 px-2 py-1 text-xs text-[#e53e3e] hover:bg-[#e53e3e]/10 disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={input}
          placeholder="New category"
          disabled={pending}
          onChange={(e) => onInput(e.target.value)}
          className={`flex-1 ${INPUT_CLASS}`}
        />
        <button
          type="button"
          disabled={pending || input.trim().length === 0}
          onClick={onAdd}
          className="rounded-md border border-[#2563eb]/45 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/[0.06] disabled:opacity-50"
        >
          Add category
        </button>
      </div>
    </div>
  );
}
