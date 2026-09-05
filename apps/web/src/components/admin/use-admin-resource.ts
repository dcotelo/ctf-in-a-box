"use client";

// The list-plus-editor state every module admin panel (quiz, classic, ai)
// runs on, once. Each panel used to hold the same dozen useStates — the rows,
// the category list, the list-error line, the loaded flag that gates the
// inventory report, the open editor with its pending/error pair, the delete
// target with its pending/error pair, the reorder flag — and the same five
// async flows over them: the mount-time GET, the upsert POST, the reorder
// write-back, the DELETE, and the refresh. What differed per module is the
// config: endpoint, error mapper, how to read a row's id and order, how to
// turn a GET body into rows, how to turn an upsert reply into the stored row,
// and how to turn an editor into its POST body.
//
// Every failure is a value, never a throw: `loadResource` and `postRow`
// resolve to a result union, so the mount effect, the Retry click and the
// import refresh all handle exactly one shape. The mount effect calls the
// loader and confines its state writes to the `.then` callback, so an
// unmount before the reply lands abandons the load without touching state
// — and so `react-hooks/set-state-in-effect` sees no setState in the effect
// body.
//
// Two things stay the panel's own on purpose: the pure model (draft types,
// validation, payload builders — those are the module's shape) and what the
// list looks like. This hook decides when a write happens and what state it
// moves; the panel decides what is written and what is shown.

import { useEffect, useState } from "react";
import { type DescribeError, parseJson, sendJson } from "@/components/admin/fetch";
import {
  type RowAccessors,
  changedOrderRows,
  nextOrder as nextOrderOf,
  reorderRows,
  sortByOrder,
  upsertRow,
} from "@/components/admin/ordered-rows";

export type LoadResult<Row> = { ok: true; rows: Row[]; categories: string[] } | { ok: false; message: string };

export type PostResult<Row> = { ok: true; row: Row } | { ok: false; message: string };

export type AdminResourceConfig<Row, Editor, Payload> = {
  /** `/api/admin/<module>` — GET lists, POST upserts, DELETE removes. */
  endpoint: string;
  describeError: DescribeError;
  rows: RowAccessors<Row>;
  /** Reads a 2xx GET body into rows (unsorted is fine) and categories (`[]`
   *  for a module without them). */
  parseList: (data: Record<string, unknown>) => { rows: Row[]; categories: string[] };
  /** What the list-error line says when the GET never got an answer. */
  loadErrorMessage: string;
  /** Reads a 2xx upsert body into the STORED row (the route echoes what it
   *  wrote, which may differ from the payload), or null when the body lacks
   *  the record — treated as a failure described with the reply's status. */
  parseUpsert: (data: Record<string, unknown>, payload: Payload) => Row | null;
  toPayload: (editor: Editor) => Payload;
  /** The POST body that re-saves an existing row unchanged apart from its
   *  order — what the reorder write-back sends. Absent for a module without
   *  reordering, whose `move` is then a no-op. */
  rowPayload?: (row: Row) => Payload;
  initialRows: readonly Row[];
  initialCategories: readonly string[];
  /** Called after every successful write to the list (upsert, reorder,
   *  delete) — the quiz and classic panels retire a stale import summary
   *  here (#127). */
  onWrite?: () => void;
};

/** One GET of the module's lists, resolved to a value. Exported for direct
 *  testing against a stubbed `fetch`. */
export async function loadResource<Row, Editor, Payload>(
  config: Pick<AdminResourceConfig<Row, Editor, Payload>, "endpoint" | "describeError" | "rows" | "parseList" | "loadErrorMessage">,
): Promise<LoadResult<Row>> {
  try {
    const res = await fetch(config.endpoint);
    const data = await parseJson<Record<string, unknown> & { error?: string }>(res);
    if (!res.ok) return { ok: false, message: config.describeError(res.status, data.error) };
    const { rows, categories } = config.parseList(data);
    return { ok: true, rows: sortByOrder(rows, config.rows), categories };
  } catch {
    return { ok: false, message: config.loadErrorMessage };
  }
}

/** One upsert POST, resolved to the stored row or a message. Exported for
 *  direct testing against a stubbed `fetch`. */
export async function postRow<Row, Editor, Payload>(
  config: Pick<AdminResourceConfig<Row, Editor, Payload>, "endpoint" | "describeError" | "parseUpsert">,
  payload: Payload,
): Promise<PostResult<Row>> {
  const result = await sendJson<Record<string, unknown> & { error?: string }>(
    config.endpoint,
    { method: "POST", body: payload },
    config.describeError,
  );
  if (!result.ok) return result;
  const row = config.parseUpsert(result.data, payload);
  if (row === null) return { ok: false, message: config.describeError(result.status, result.data.error) };
  return { ok: true, row };
}

export type ReorderOutcome<Row> = { ok: true } | { ok: false; message: string; fresh: LoadResult<Row> };

/** The reorder write-back: re-saves each changed row, in order, through the
 *  upsert route. On the FIRST failure it stops and re-reads the lists from
 *  the store — earlier rows are already stored with their new order, so the
 *  pre-move list is no longer what the store has (#283) — and returns the
 *  reorder's own message alongside that fresh read. Exported for direct
 *  testing against a stubbed `fetch`. */
export async function writeBackReorder<Row, Editor, Payload>(
  config: Pick<AdminResourceConfig<Row, Editor, Payload>, "endpoint" | "describeError" | "rows" | "parseList" | "loadErrorMessage" | "parseUpsert">,
  changed: readonly Row[],
  rowPayload: (row: Row) => Payload,
): Promise<ReorderOutcome<Row>> {
  for (const row of changed) {
    const result = await postRow(config, rowPayload(row));
    if (!result.ok) return { ok: false, message: result.message, fresh: await loadResource(config) };
  }
  return { ok: true };
}

export type AdminResource<Row, Item, Editor> = {
  rows: Row[];
  setRows: (update: (prev: Row[]) => Row[]) => void;
  categories: string[];
  setCategories: (next: string[]) => void;
  /** The list-error line, or null. */
  listError: string | null;
  /** True once a real read has landed — gates the inventory report so the
   *  shell never hears "0 items" from the pre-hydration seed. */
  loaded: boolean;
  /** Re-reads the lists from the store. A manual Retry, or an import's
   *  refresh — never called from an effect. */
  reload: () => Promise<void>;
  /** The position a brand-new item takes. */
  nextOrder: number;

  editing: Editor | null;
  setEditing: (editor: Editor | null) => void;
  formPending: boolean;
  formError: string | null;
  /** Closes the form unless a save is in flight. */
  cancelEditor: () => void;
  submitEditor: (editor: Editor) => Promise<void>;

  deleteTarget: Item | null;
  deletePending: boolean;
  deleteError: string | null;
  /** Opens the delete confirmation for `item`. */
  requestDelete: (item: Item) => void;
  cancelDelete: () => void;
  /** The DELETE itself; on success the row leaves the list and the
   *  confirmation closes. */
  remove: (id: string) => Promise<void>;

  reorderPending: boolean;
  /** Applies a move optimistically, then writes back only the rows whose
   *  order actually changed. On a failure the list is re-read from the store
   *  (rows written before the failure keep their new order there) rather
   *  than left showing an arrangement the store doesn't have. */
  move: (from: number, to: number) => Promise<void>;
};

export function useAdminResource<Row, Item, Editor, Payload>(
  config: AdminResourceConfig<Row, Editor, Payload>,
): AdminResource<Row, Item, Editor> {
  const { rows: accessors, initialRows, initialCategories, onWrite } = config;

  const [rows, setRows] = useState<Row[]>(() => sortByOrder(initialRows, accessors));
  const [categories, setCategories] = useState<string[]>([...initialCategories]);
  const [listError, setListError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [editing, setEditing] = useState<Editor | null>(null);
  const [formPending, setFormPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [reorderPending, setReorderPending] = useState(false);

  /** Replaces local state with a fresh read of the store. Shared by the mount
   *  effect and `reload`, so an import's refresh and a Retry click land the
   *  same way the first load did. */
  function applyLoad(result: LoadResult<Row>) {
    if (!result.ok) {
      setListError(result.message);
      return;
    }
    setRows(result.rows);
    setCategories(result.categories);
    setListError(null);
    setLoaded(true);
  }

  // First-paint data comes from the seed (or, in production, is simply
  // empty); this replaces it with the live lists once mounted in the browser.
  // Never runs under `renderToStaticMarkup`.
  useEffect(() => {
    let cancelled = false;
    void loadResource(config).then((result) => {
      if (!cancelled) applyLoad(result);
    });
    return () => {
      cancelled = true;
    };
    // Mount-only by design: the endpoint and parsers are fixed for the life
    // of a panel, and re-running on every config identity would refetch on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reload(): Promise<void> {
    applyLoad(await loadResource(config));
  }

  async function submitEditor(editor: Editor): Promise<void> {
    setFormPending(true);
    setFormError(null);
    const result = await postRow(config, config.toPayload(editor));
    setFormPending(false);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    setRows((prev) => upsertRow(prev, result.row, accessors));
    onWrite?.();
    setEditing(null);
  }

  function cancelEditor() {
    if (formPending) return;
    setEditing(null);
    setFormError(null);
  }

  function requestDelete(item: Item) {
    setDeleteError(null);
    setDeleteTarget(item);
  }

  function cancelDelete() {
    setDeleteTarget(null);
    setDeleteError(null);
  }

  async function remove(id: string): Promise<void> {
    setDeletePending(true);
    setDeleteError(null);
    try {
      const result = await sendJson<{ error?: string }>(config.endpoint, { method: "DELETE", body: { id } }, config.describeError);
      if (!result.ok) {
        setDeleteError(result.message);
        return;
      }
      setRows((prev) => prev.filter((row) => accessors.id(row) !== id));
      onWrite?.();
      setDeleteTarget(null);
    } finally {
      setDeletePending(false);
    }
  }

  async function move(from: number, to: number): Promise<void> {
    const rowPayload = config.rowPayload;
    if (!rowPayload || from === to || reorderPending) return;
    const before = rows;
    const after = reorderRows(before, from, to, accessors);
    const changed = changedOrderRows(before, after, accessors);
    if (changed.length === 0) return;

    setRows(after);
    onWrite?.();
    setReorderPending(true);
    setListError(null);
    const outcome = await writeBackReorder(config, changed, rowPayload);
    if (!outcome.ok) {
      // The store, not `before`, is the source of truth for what landed:
      // rows written before the failure keep their new order there. Show
      // the store's list when it can be read, the pre-move list when it
      // cannot, and the reorder's own error either way.
      if (outcome.fresh.ok) {
        setRows(outcome.fresh.rows);
        setCategories(outcome.fresh.categories);
      } else {
        setRows(before);
      }
      setListError(outcome.message);
    }
    setReorderPending(false);
  }

  return {
    rows,
    setRows,
    categories,
    setCategories,
    listError,
    loaded,
    reload,
    nextOrder: nextOrderOf(rows, accessors),
    editing,
    setEditing,
    formPending,
    formError,
    cancelEditor,
    submitEditor,
    deleteTarget,
    deletePending,
    deleteError,
    requestDelete,
    cancelDelete,
    remove,
    reorderPending,
    move,
  };
}
