import type { Metadata } from "next";
import PageHeader from "@/components/page-header";
import ChallengeGrid from "@/components/challenge-grid";
import HintNotice from "@/components/hint-notice";
import { enabledApps, enabledTotalChallenges, enabledTotalMaxPoints, joinAppNames } from "@/lib/apps";
import { getChallengeCatalog } from "@/lib/challenges";
import { getHintAvailability, HINTS_ENABLED, HINT_COST } from "@/lib/hint-store";
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
  // Both fetches are ISR-cached (revalidate 300); hint availability is public
  // (ids only, no hint text). The page itself renders dynamically regardless —
  // the root layout resolves module names per request, so every route under it
  // does (see resolved-modules.ts) — the caching just keeps these two reads
  // off Redis/GitHub on each of those renders.
  const [catalog, hintAvailability, title] = await Promise.all([
    getChallengeCatalog(),
    getHintAvailability(),
    pageTitle(),
  ]);
  const sortedApps = [...enabledApps].sort((a, b) => a.name.localeCompare(b.name));

  const appNoun = enabledApps.length === 1 ? "app" : "apps";
  const description = catalog
    ? `${catalog.total} challenges across ${enabledApps.length} vulnerable ${appNoun}, each tagged with its OWASP Top 10 category. Points scale with difficulty. Patch the regression test tied to each challenge to score it.`
    : `${enabledTotalChallenges} challenges across ${enabledApps.length} vulnerable ${appNoun}, worth ${enabledTotalMaxPoints} points total. Points scale with difficulty. Patch the regression test tied to each challenge to score it.`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Targets" title={title} description={description} />
      <HintNotice active={HINTS_ENABLED} cost={HINT_COST} />
      <ChallengeGrid apps={sortedApps} catalog={catalog?.byApp ?? null} hints={hintAvailability} />
    </div>
  );
}
