"use client";

// Grid of the enabled vulnerable-app targets. A Client Component for the search
// filter and per-card expand/collapse. When the live catalogue is available
// each card lists its challenges with OWASP category links; without it the
// cards fall back to the static counts/points from lib/apps.
//
// Hints layer: which challenges HAVE hints comes in as a server prop (public,
// safe to bake into the static page); the viewer's own state (session, bought
// hints) is loaded client-side from GET /api/hints after mount so per-user
// data never ends up in the shared static render.

import { useEffect, useState } from "react";
import HintButton from "@/components/hint-button";
import type { AppId, AppMeta } from "@/lib/apps";
import type { CatalogChallenge, ChallengeCatalog } from "@/lib/challenges";
import { authClient } from "@/lib/auth-client";

type PurchasedHints = Partial<Record<AppId, Record<string, string>>>;

type VisibleApp = {
  app: AppMeta;
  count: number;
  /** Challenge rows to render (filtered when searching); null = no live data. */
  challenges: CatalogChallenge[] | null;
  /** Auto-expand when the query matched individual challenges. */
  forceOpen: boolean;
};

function matchChallenge(c: CatalogChallenge, q: string): boolean {
  return (
    c.description.toLowerCase().includes(q) ||
    c.owasp.code.toLowerCase().includes(q) ||
    c.owasp.label.toLowerCase().includes(q)
  );
}

export default function ChallengeGrid({
  apps,
  catalog,
  hints,
}: {
  apps: AppMeta[];
  catalog: ChallengeCatalog["byApp"] | null;
  /** Challenge ids that have a hint, per app ({} when hints are unavailable). */
  hints: Partial<Record<AppId, string[]>>;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const hintsActive = Object.keys(hints).length > 0;
  // isPending renders the same signed-out teaser the static HTML has, so the
  // signed-in upgrade happens after hydration with no markup mismatch.
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

  const visible = apps
    .map((app): VisibleApp | null => {
      const all = catalog?.[app.id] ?? null;
      const count = all?.length ?? app.challengeCount;
      if (q === "") return { app, count, challenges: all, forceOpen: false };
      if (app.name.toLowerCase().includes(q)) {
        return { app, count, challenges: all, forceOpen: false };
      }
      const matched = all?.filter((c) => matchChallenge(c, q)) ?? [];
      if (matched.length === 0) return null;
      return { app, count, challenges: matched, forceOpen: true };
    })
    .filter((v): v is VisibleApp => v !== null);

  return (
    <div className="flex flex-col gap-6">
      <div className="relative w-full sm:max-w-xs">
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
          placeholder={catalog ? "Search challenges, apps, or OWASP codes…" : "Search targets…"}
          aria-label="Search challenges"
          className="w-full rounded-md border border-white/10 bg-white/[0.03] py-2 pl-9 pr-3 text-sm text-white placeholder:text-muted focus-visible:border-[#2563eb]/60 focus-visible:outline-none"
        />
      </div>

      {spent > 0 && (
        <p className="-mt-3 font-mono text-xs tabular-nums text-[#d4a017]/80">
          💡 −{spent} pts spent on hints
        </p>
      )}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map(({ app, count, challenges, forceOpen }) => (
          <li key={app.id}>
            <article
              className="ds-card group flex h-full flex-col gap-3 rounded-lg border border-white/[0.06] bg-[#16162a] p-5 transition-all hover:-translate-y-0.5"
              style={{ ["--accent" as string]: app.accent }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-full border-2 transition-shadow"
                  style={{ color: app.accent, borderColor: app.accent }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d={app.icon} />
                  </svg>
                </span>
                <span className="font-mono text-xs tabular-nums text-muted">
                  {count} challenges
                </span>
              </div>

              {/* h2, not h3: these sit directly under the page h1, and skipping
                  a level breaks the heading outline for screen readers. */}
              <h2 className="text-lg font-semibold text-white">{app.name}</h2>
              <p className="flex-1 text-sm leading-relaxed text-zinc-400">{app.blurb}</p>

              <a
                href={app.repo}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-fit items-center gap-1.5 font-mono text-xs text-zinc-400 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                </svg>
                {app.repo.replace("https://github.com/", "")}
              </a>

              {challenges ? (
                <div className="border-t border-white/[0.06] pt-3">
                  <CatalogList
                    challenges={challenges}
                    forceOpen={forceOpen}
                    app={app.id}
                    hintIds={hints[app.id] ? new Set(hints[app.id]) : null}
                    signedIn={signedIn}
                    cost={hintCost}
                    owned={purchased[app.id]}
                    onPurchased={onPurchased}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between border-t border-white/[0.06] pt-3 text-xs">
                  <span className="font-mono tabular-nums text-muted">
                    {app.stars[0]}–{app.stars[1]} pts / challenge
                  </span>
                  <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                    {app.maxPoints} max
                  </span>
                </div>
              )}
            </article>
          </li>
        ))}
      </ul>

      {visible.length === 0 && (
        <p className="text-sm text-muted">No challenges match “{query.trim()}”.</p>
      )}
    </div>
  );
}

function CatalogList({
  challenges,
  forceOpen,
  app,
  hintIds,
  signedIn,
  cost,
  owned,
  onPurchased,
}: {
  challenges: CatalogChallenge[];
  forceOpen: boolean;
  app: AppId;
  /** Ids with a hint available; null = no hints for this app. */
  hintIds: Set<string> | null;
  signedIn: boolean;
  cost: number;
  /** The viewer's bought hints for this app (id → text). */
  owned: Record<string, string> | undefined;
  onPurchased: (app: AppId, id: string, text: string, spent: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const expanded = forceOpen || open;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb]"
      >
        <svg
          className={`transition-transform ${expanded ? "rotate-90" : ""}`}
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
        {forceOpen
          ? `${challenges.length} matching`
          : `${open ? "Hide" : "Show"} ${challenges.length} challenges`}
      </button>

      {expanded && (
        <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto border-l border-white/[0.06] pl-3">
          {challenges.map((c) => {
            const ownedText = owned?.[c.id];
            return (
              <li key={c.id} className="flex flex-col gap-1 py-0.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-zinc-300" title={c.description}>
                    {c.description}
                  </span>
                  {hintIds?.has(c.id) && !ownedText && (
                    <HintButton app={app} id={c.id} cost={cost} signedIn={signedIn} onPurchased={onPurchased} />
                  )}
                  <a
                    href={c.owasp.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={c.owasp.label}
                    className="ds-tap-24 flex-none rounded border border-white/10 px-1 text-[10px] text-muted transition-colors hover:border-[#2563eb]/60 hover:text-white"
                  >
                    {c.owasp.code}
                  </a>
                </div>
                {ownedText && (
                  <p className="rounded border-l-2 border-[#d4a017]/50 bg-[#d4a017]/[0.06] px-2 py-1 text-[11px] leading-relaxed text-[#d4a017]/90">
                    💡 {ownedText}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
