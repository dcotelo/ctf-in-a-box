import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PageHeader from "@/components/page-header";
import ChallengeGrid from "@/components/challenge-grid";
import HintNotice from "@/components/hint-notice";
import { enabledApps, enabledTotalChallenges, enabledTotalMaxPoints, joinAppNames } from "@/lib/apps";
import { getChallengeCatalog } from "@/lib/challenges";
import { getHintAvailability, resolveHintConfig } from "@/lib/hint-store";
import { isModuleEnabled } from "@/lib/modules";
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
  if (!isModuleEnabled("secure-development")) notFound();

  // Both fetches are ISR-cached (revalidate 300); hint availability is public
  // (ids only, no hint text). The page itself renders dynamically regardless —
  // the root layout resolves module names per request, so every route under it
  // does (see resolved-modules.ts) — the caching just keeps these two reads
  // off Redis/GitHub on each of those renders.
  const [catalog, hintAvailability, title, hints] = await Promise.all([
    getChallengeCatalog(),
    getHintAvailability(),
    pageTitle(),
    // The banner must agree with the /admin toggle and show the organizer's
    // configured price, not the hardcoded default the grid already ignores.
    resolveHintConfig(),
  ]);
  const sortedApps = [...enabledApps].sort((a, b) => a.name.localeCompare(b.name));

  const appNoun = enabledApps.length === 1 ? "app" : "apps";
  const description = catalog
    ? `${catalog.total} challenges across ${enabledApps.length} vulnerable ${appNoun}, each tagged with its OWASP Top 10 category. Points scale with difficulty. Patch the regression test tied to each challenge to score it.`
    : `${enabledTotalChallenges} challenges across ${enabledApps.length} vulnerable ${appNoun}, worth ${enabledTotalMaxPoints} points total. Points scale with difficulty. Patch the regression test tied to each challenge to score it.`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Targets" title={title} description={description} />
      <HintNotice active={hints.enabled} cost={hints.cost} />
      <ChallengeGrid apps={sortedApps} catalog={catalog?.byApp ?? null} hints={hintAvailability} />
    </div>
  );
}
