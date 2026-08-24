"use client";

// The admin activity log (issue #212): who signed in, who solved what, and
// team changes, newest first, from GET /api/admin/activity.
//
// Loaded on demand rather than on mount, like Insights: an organizer opening
// the tab strip to reach Support shouldn't pay a Redis read for a panel they
// aren't looking at. The load button doubles as refresh.
//
// Filters (type chips + login text) are CLIENT-SIDE over the pages loaded so
// far — the route serves raw offset pages by design (see its header comment).
// The count line says so when a filter is active, so "3 of 200 loaded" is
// never mistaken for "3 in total".

import { useMemo, useState } from "react";
import { ACTIVITY_TYPES } from "@/lib/activity-keys";

export type ActivityEntry = { at: string; type: string; login: string; detail?: string };

const PAGE_SIZE = 200;

/** Human labels for the known types. Unknown types (an entry written by a
 *  newer or older build than this one) render their raw type string rather
 *  than being dropped — the log must never silently hide events. */
const TYPE_LABELS: Record<string, string> = {
  login: "signed in",
  "quiz-solve": "quiz solve",
  "classic-solve": "flag solve",
  "team-create": "created team",
  "team-join": "joined team",
  "team-leave": "left team",
  "team-rename": "renamed team",
};

/** Compact UTC timestamp, "08-24 18:03". Sliced from the stored ISO string —
 *  never a live clock read, so the server render and hydration agree, and
 *  every row on the panel is in one timezone. The full instant stays on
 *  hover via `title`. */
export function formatWhen(iso: string): string {
  return iso.slice(5, 16).replace("T", " ");
}

/** The client-side filter the panel applies to its loaded pages. Exported for
 *  direct testing — filter logic behind a useState toggle is invisible to a
 *  static render. Login matching is a case-insensitive substring: an
 *  organizer chasing "did dcote… do anything" types fragments, not exact
 *  logins. */
export function filterEntries(entries: ActivityEntry[], type: string | null, login: string): ActivityEntry[] {
  const needle = login.trim().toLowerCase();
  return entries.filter((e) => {
    if (type && e.type !== type) return false;
    if (needle && !e.login.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export default function AdminActivityTab() {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [loginFilter, setLoginFilter] = useState("");

  /** `fresh` reloads from the top (the newest events — also the refresh
   *  semantics); otherwise appends the next page after what's loaded. */
  async function load(fresh: boolean) {
    setPending(true);
    setError(null);
    try {
      const offset = fresh ? 0 : (entries?.length ?? 0);
      const res = await fetch(`/api/admin/activity?offset=${offset}&limit=${PAGE_SIZE}`);
      const data = (await res.json().catch(() => ({}))) as {
        entries?: ActivityEntry[];
        total?: number;
        error?: string;
      };
      if (!res.ok || !Array.isArray(data.entries)) {
        setError(data.error ?? "Could not load the activity log");
        return;
      }
      setEntries(fresh ? data.entries : [...(entries ?? []), ...data.entries]);
      setTotal(data.total ?? 0);
    } catch {
      setError("Could not load the activity log");
    } finally {
      setPending(false);
    }
  }

  const visible = useMemo(
    () => (entries ? filterEntries(entries, typeFilter, loginFilter) : []),
    [entries, typeFilter, loginFilter],
  );
  const filtered = typeFilter !== null || loginFilter.trim() !== "";
  const loaded = entries?.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => void load(true)}
          className="flex-none rounded-md bg-[#2563eb] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#1d4ed8] disabled:opacity-50"
        >
          {pending ? "Loading…" : entries ? "Refresh" : "Load activity"}
        </button>
        {entries && (
          <span className="text-[10px] text-muted">
            {filtered
              ? `${visible.length} matching, of ${loaded} loaded (${total} total)`
              : `${loaded} of ${total} loaded, newest first`}
          </span>
        )}
      </div>

      {!entries && !error && (
        <p className="text-xs text-muted">
          Sign-ins, solves, and team changes, newest first. Entries name the challenge or team
          involved — never a flag or an answer.
        </p>
      )}

      {error && <p className="text-xs text-[#e53e3e]">{error}</p>}

      {entries && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTypeFilter(null)}
              aria-pressed={typeFilter === null}
              className={
                typeFilter === null
                  ? "rounded-full border border-[#2563eb]/70 px-2.5 py-1 text-[11px] text-white"
                  : "rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
              }
            >
              all
            </button>
            {ACTIVITY_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(typeFilter === t ? null : t)}
                aria-pressed={typeFilter === t}
                className={
                  typeFilter === t
                    ? "rounded-full border border-[#2563eb]/70 px-2.5 py-1 text-[11px] text-white"
                    : "rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                }
              >
                {TYPE_LABELS[t] ?? t}
              </button>
            ))}
            <input
              type="text"
              aria-label="Filter by login"
              value={loginFilter}
              onChange={(e) => setLoginFilter(e.target.value)}
              placeholder="filter by login"
              className="ml-auto w-40 rounded-md border border-white/10 bg-[#12121e] px-2.5 py-1 text-[11px] text-white placeholder:text-zinc-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017]"
            />
          </div>

          {visible.length === 0 ? (
            <p className="text-xs text-muted">
              {filtered ? "Nothing loaded matches these filters." : "Nothing recorded yet."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-xs">
                <thead className="text-muted">
                  <tr className="border-b border-white/[0.06] text-left">
                    <th className="py-1 pr-3 font-medium">When (UTC)</th>
                    <th className="py-1 pr-3 font-medium">Event</th>
                    <th className="py-1 pr-3 font-medium">Who</th>
                    <th className="py-1 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-300">
                  {visible.map((e, i) => (
                    <tr key={`${e.at}-${e.type}-${e.login}-${i}`} className="border-b border-white/[0.03]">
                      <td className="py-1 pr-3 font-mono tabular-nums text-muted" title={e.at}>
                        {formatWhen(e.at)}
                      </td>
                      <td className="py-1 pr-3">{TYPE_LABELS[e.type] ?? e.type}</td>
                      <td className="py-1 pr-3 font-mono text-white">{e.login}</td>
                      <td className="py-1 font-mono text-muted">{e.detail ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {loaded < total && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void load(false)}
              className="self-start rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-[#2563eb]/60 hover:text-white disabled:opacity-50"
            >
              Load {Math.min(PAGE_SIZE, total - loaded)} more
            </button>
          )}
        </>
      )}
    </div>
  );
}
