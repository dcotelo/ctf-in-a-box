"use client";

// The challenge browser — a queue, not a card gallery (apps/web/DESIGN.md).
//
// 321 challenges across six targets is an information-density problem the old
// card-per-app-with-expansion layout hid rather than solved: 110 rows in a
// scroll box, no solved state, no way to scan for "what's worth attempting
// next". This is one flat list under sticky per-target headers, filtered four
// ways — target, OWASP category, solved state, text — with every row a check
// atom: green filled for patched, hollow for open.
//
// Solved state arrives as a server prop (the viewer's own patched challenge
// keys, read from their profile by the page); the hint layer keeps its split —
// which challenges HAVE hints is public and server-provided, the viewer's own
// purchases load client-side from GET /api/hints after mount so per-user data
// never lands in the shared static render.
//
// Without a live catalogue (no scorer reachable) the browser falls back to
// one summary card per target from the static counts — filters would have
// nothing to filter.

import { useEffect, useMemo, useState } from "react";
import HintButton from "@/components/hint-button";
import OwaspBadge from "@/components/owasp-badge";
import type { AppId, AppMeta } from "@/lib/apps";
import type { CatalogChallenge, ChallengeCatalog } from "@/lib/challenges";
import { authClient } from "@/lib/auth-client";

type PurchasedHints = Partial<Record<AppId, Record<string, string>>>;

type StateFilter = "all" | "open" | "solved";

function matchChallenge(c: CatalogChallenge, q: string): boolean {
  return (
    c.description.toLowerCase().includes(q) ||
    (c.owasp?.code.toLowerCase().includes(q) ?? false) ||
    (c.owasp?.label.toLowerCase().includes(q) ?? false)
  );
}

const SELECT =
  "rounded-md border border-white/10 bg-[#12121e] px-2.5 py-2 text-sm text-white focus-visible:border-[#d4a017]/70 focus-visible:outline-none";

export default function ChallengeGrid({
  apps,
  catalog,
  hints,
  solved = {},
}: {
  apps: AppMeta[];
  catalog: ChallengeCatalog["byApp"] | null;
  /** Challenge ids that have a hint, per app ({} when hints are unavailable). */
  hints: Partial<Record<AppId, string[]>>;
  /** The viewer's own patched challenge keys, per app — {} signed out or when
   *  the source carries no per-challenge results. */
  solved?: Partial<Record<AppId, string[]>>;
}) {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<"all" | AppId>("all");
  const [category, setCategory] = useState("all");
  const [state, setState] = useState<StateFilter>("all");
  const q = query.trim().toLowerCase();

  const hintsActive = Object.keys(hints).length > 0;
  const { data: session, isPending } = authClient.useSession();
  const signedIn = hintsActive && !isPending && !!session;
  const [purchased, setPurchased] = useState<PurchasedHints>({});
  const [hintCost, setHintCost] = useState(10);
  const [spent, setSpent] = useState(0);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetch("/api/hints")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.enabled) return;
        setPurchased(data.purchased ?? {});
        setHintCost(Number(data.cost) || 10);
        setSpent(Number(data.spent) || 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const onPurchased = (app: AppId, id: string, text: string, spentNow: number) => {
    setPurchased((prev) => ({ ...prev, [app]: { ...(prev[app] ?? {}), [id]: text } }));
    setSpent(spentNow);
  };

  const solvedSets = useMemo(() => {
    const out = new Map<AppId, Set<string>>();
    for (const [app, ids] of Object.entries(solved)) out.set(app as AppId, new Set(ids));
    return out;
  }, [solved]);
  const anySolvedData = solvedSets.size > 0;

  // Every OWASP code present in the live catalogue, for the category filter.
  const categories = useMemo(() => {
    if (!catalog) return [];
    const codes = new Set<string>();
    for (const list of Object.values(catalog)) for (const c of list ?? []) if (c.owasp) codes.add(c.owasp.code);
    return [...codes].sort();
  }, [catalog]);

  // ── No live catalogue: summary cards, no filters to offer. ──
  if (!catalog) {
    return (
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {apps.map((app) => (
          <li key={app.id}>
            <article className="ds-card flex h-full flex-col gap-2 rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-base font-bold text-white">{app.name}</h2>
                <span className="font-mono text-xs tabular-nums text-muted">{app.challengeCount}</span>
              </div>
              <p className="flex-1 text-sm leading-relaxed text-zinc-400">{app.blurb}</p>
              <p className="font-mono text-xs tabular-nums text-muted">
                {app.stars[0]}–{app.stars[1]} pts per challenge
              </p>
              <a
                href={app.repo}
                target="_blank"
                rel="noopener noreferrer"
                className="ds-link w-fit font-mono text-xs"
              >
                {app.repo.replace("https://github.com/", "")}
              </a>
            </article>
          </li>
        ))}
      </ul>
    );
  }

  // ── The queue. ──
  const sections = apps
    .map((app) => {
      const all = catalog[app.id] ?? [];
      const solvedHere = solvedSets.get(app.id) ?? new Set<string>();
      const rows = all.filter((c) => {
        if (target !== "all" && app.id !== target) return false;
        if (category !== "all" && c.owasp?.code !== category) return false;
        const isSolved = solvedHere.has(c.id);
        if (state === "open" && isSolved) return false;
        if (state === "solved" && !isSolved) return false;
        if (q !== "" && !matchChallenge(c, q) && !app.name.toLowerCase().includes(q)) return false;
        return true;
      });
      return { app, rows, total: all.length, solvedCount: all.filter((c) => solvedHere.has(c.id)).length };
    })
    .filter((s) => s.rows.length > 0);

  const shown = sections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <input
            type="search"
            id="challenge-search"
            name="challenge-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search challenges or OWASP codes"
            aria-label="Search challenges"
            className="w-full rounded-md border border-white/10 bg-white/[0.03] py-2 pl-9 pr-3 text-sm text-white placeholder:text-muted focus-visible:border-[#d4a017]/70 focus-visible:outline-none"
          />
        </div>
        <label className="sr-only" htmlFor="filter-target">Target</label>
        <select id="filter-target" value={target} onChange={(e) => setTarget(e.target.value as "all" | AppId)} className={SELECT}>
          <option value="all">All targets</option>
          {apps.map((app) => (
            <option key={app.id} value={app.id}>{app.name}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="filter-owasp">OWASP category</label>
        <select id="filter-owasp" value={category} onChange={(e) => setCategory(e.target.value)} className={SELECT}>
          <option value="all">All categories</option>
          {categories.map((code) => (
            <option key={code} value={code}>{code}</option>
          ))}
        </select>
        {anySolvedData && (
          <div role="group" aria-label="Solved state" className="flex overflow-hidden rounded-md border border-white/10">
            {(["all", "open", "solved"] as StateFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setState(s)}
                aria-pressed={state === s}
                className={`px-3 py-2 text-xs font-medium capitalize transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#d4a017] ${
                  state === s ? "bg-white/[0.1] text-white" : "text-zinc-400 hover:text-white"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <span className="ml-auto font-mono text-xs tabular-nums text-muted">{shown} shown</span>
      </div>

      {spent > 0 && (
        <p className="-mt-2 font-mono text-xs tabular-nums text-[#d4a017]/80">
          💡 −{spent} pts spent on hints
        </p>
      )}

      {sections.length === 0 ? (
        <div className="rounded-lg border border-white/[0.06] bg-[#16162a] px-4 py-10 text-center">
          <p className="text-sm text-zinc-400">Nothing matches those filters.</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setTarget("all");
              setCategory("all");
              setState("all");
            }}
            className="ds-link mt-2 text-sm"
          >
            Clear the filters
          </button>
        </div>
      ) : (
        <div className="flex flex-col">
          {sections.map(({ app, rows, total, solvedCount }) => (
            <section key={app.id} className="mb-6">
              {/* Sticky under the site header (h-14 = 56px). */}
              <div className="sticky top-14 z-10 -mx-1 flex items-baseline gap-3 border-b border-white/[0.09] bg-[#1a1a2e]/95 px-1 py-2 backdrop-blur">
                <h2 className="text-base font-bold text-white">{app.name}</h2>
                {anySolvedData && (
                  <span className="font-mono text-xs tabular-nums text-[#22c55e]">
                    {solvedCount}/{total} patched
                  </span>
                )}
                <a
                  href={app.repo}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto hidden font-mono text-xs text-zinc-500 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a017] sm:inline"
                >
                  {app.repo.replace("https://github.com/", "")}
                </a>
              </div>
              <ul>
                {rows.map((c) => {
                  const isSolved = solvedSets.get(app.id)?.has(c.id) ?? false;
                  const ownedText = purchased[app.id]?.[c.id];
                  const hasHint = hints[app.id]?.includes(c.id) ?? false;
                  return (
                    <li key={c.id} className="flex flex-col gap-1 border-b border-white/[0.04] py-2">
                      <div className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className={`h-2 w-2 flex-none rounded-full ${
                            isSolved ? "bg-[#22c55e]" : "border border-[#8f8f9b]/50"
                          }`}
                        />
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${
                            isSolved ? "text-zinc-500" : "text-zinc-300"
                          }`}
                          title={c.description}
                        >
                          {c.description}
                          {isSolved && <span className="sr-only"> (patched)</span>}
                        </span>
                        <span className="flex-none font-mono text-xs tabular-nums text-muted">
                          {c.points} {c.points === 1 ? "pt" : "pts"}
                        </span>
                        {hasHint && !ownedText && (
                          <HintButton app={app.id} id={c.id} cost={hintCost} signedIn={signedIn} onPurchased={onPurchased} />
                        )}
                        {c.owasp && <OwaspBadge code={c.owasp.code} />}
                      </div>
                      {ownedText && (
                        <p className="ml-[18px] rounded border-l-2 border-[#d4a017]/50 bg-[#d4a017]/[0.06] px-2 py-1 text-[11px] leading-relaxed text-[#d4a017]/90">
                          💡 {ownedText}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
