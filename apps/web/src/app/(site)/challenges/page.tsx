import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PageHeader from "@/components/page-header";
import ChallengeGrid from "@/components/challenge-grid";
import HintNotice from "@/components/hint-notice";
import { enabledApps, enabledTotalChallenges, enabledTotalMaxPoints, joinAppNames } from "@/lib/apps";
import { getChallengeCatalog } from "@/lib/challenges";
import { getLeaderboardSource } from "@/lib/leaderboard/source";
import { getHintAvailability, getHintNotice } from "@/lib/hint-store";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { isModuleLive } from "@/lib/enabled-modules";
import { getResolvedModules } from "@/lib/resolved-modules";
import { event } from "@/lib/site";

const appList = joinAppNames(enabledApps.map((a) => a.name));

/** This page's own name, with an organizer rename applied.
 *
 *  "Challenges" is the page's DEFAULT, not the module's display name (which
 *  is "Secure Development"), so this reads `titleOverride` and not `title`:
 *  renaming the module to "Round 1" retitles this page, but leaving the
 *  override unset keeps "Challenges" exactly as it has always read. Same
 *  rule the nav follows — see `buildNavLinks`. */
async function pageTitle(): Promise<string> {
  const mod = (await getResolvedModules()).find((m) => m.id === "secure-development");
  return mod?.titleOverride || "Challenges";
}

// A static `metadata` export cannot await the organizer's override out of
// Redis, so this is `generateMetadata` — the same conversion `/quiz` makes,
// and for the same reason. The read is memoized per request, so resolving it
// here and again in the component below costs one settings read, not two.
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: await pageTitle(),
    description: `${enabledApps.length} vulnerable OWASP ${enabledApps.length === 1 ? "app" : "apps"} to patch: ${appList}.`,
  };
}

export default async function ChallengesPage() {
  // Gated on the module registry rather than on auth: this route only exists
  // at all when the secure-development module is enabled (module contract
  // §5.4), so an event without it 404s here exactly like any other unknown
  // route — same gate `/quiz` runs for its own module, and for the same
  // reason: the nav entry disappearing isn't enough, the URL itself must not
  // resolve. First statement, before anything async, so a disabled module
  // never reaches the data fetches below.
  if (!(await isModuleLive("secure-development"))) notFound();

  // Both fetches are ISR-cached (revalidate 300); hint availability is public
  // (ids only, no hint text). The page itself renders dynamically regardless —
  // the root layout resolves module names per request, so every route under it
  // does (see resolved-modules.ts) — the caching just keeps these two reads
  // off Redis/GitHub on each of those renders.
  const [catalog, hintAvailability, title, hints, session] = await Promise.all([
    getChallengeCatalog(),
    getHintAvailability(),
    pageTitle(),
    // Must agree with the /admin toggle and show the organizer's configured
    // price, not the hardcoded default the grid beside it already ignores.
    getHintNotice(),
    // For the banner's sign-in clause only — the page renders dynamically
    // regardless (root layout resolves module names per request), so this
    // adds no rendering mode change, just one session read.
    auth.api.getSession({ headers: await headers() }),
  ]);
  // Does ANY challenge actually carry a hint? The banner must not promise
  // 💡 marks on a board that renders none (issue #200, 3.5).
  const anyHintMarked = Object.values(hintAvailability).some((ids) => (ids?.length ?? 0) > 0);

  // The viewer's own patched challenges, for the browser's solved state — the
  // same per-challenge results their profile shows, keyed for the grid. Only
  // when signed in and only when the source carries per-challenge data; any
  // failure degrades to "no solved marks", never to an error.
  const login = (session?.user as { login?: string } | undefined)?.login;
  let solved: Partial<Record<string, string[]>> = {};
  if (login) {
    try {
      const profile = await getLeaderboardSource().getUser(login);
      for (const app of profile?.apps ?? []) {
        const patched = (app.challenges ?? []).filter((c) => c.status === "patched").map((c) => c.key);
        if (patched.length > 0) solved[app.app] = patched;
      }
    } catch {
      solved = {};
    }
  }
  const sortedApps = [...enabledApps].sort((a, b) => a.name.localeCompare(b.name));

  const appNoun = enabledApps.length === 1 ? "app" : "apps";
  const description = catalog
    ? `${catalog.total} challenges across ${enabledApps.length} vulnerable ${appNoun}, each tagged with its OWASP Top 10 category. Points scale with difficulty. Patch the regression test tied to each challenge to score it.`
    : `${enabledTotalChallenges} challenges across ${enabledApps.length} vulnerable ${appNoun}, worth ${enabledTotalMaxPoints} points total. Points scale with difficulty. Patch the regression test tied to each challenge to score it.`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Targets" title={title} description={description} />
      <HintNotice active={hints.active} cost={hints.cost} signedIn={!!session} anyMarked={anyHintMarked} />
      {/* The scoring cadence, stated instead of silent (DESIGN.MD: "scoring
          latency — the honest version"). The app never sees a contestant's
          PR, so there is no per-run pending state to show — what it CAN say
          is when scores land and where to look when one doesn't. */}
      <p className="-mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted">
        <span aria-hidden className="mt-1 h-2 w-2 flex-none rounded-full bg-[#d4a017]" />
        <span>
          Scores land within about a minute of your pull request&rsquo;s checks finishing — your
          patched marks here and on your profile update on reload. A run that finished but scored
          nothing means the regression test still fails: open your PR&rsquo;s Checks tab on GitHub
          to see which test, fix, and push again. Your best result always stands.
        </span>
      </p>
      <ChallengeGrid apps={sortedApps} catalog={catalog?.byApp ?? null} hints={hintAvailability} solved={solved} />
    </div>
  );
}
