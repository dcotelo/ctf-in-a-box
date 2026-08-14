import type { Metadata } from "next";
import PageHeader from "@/components/page-header";
import ChallengeGrid from "@/components/challenge-grid";
import HintNotice from "@/components/hint-notice";
import { enabledApps, enabledTotalChallenges, enabledTotalMaxPoints, joinAppNames } from "@/lib/apps";
import { getChallengeCatalog } from "@/lib/challenges";
import { getHintAvailability, HINTS_ENABLED, HINT_COST } from "@/lib/hint-store";
import { event } from "@/lib/site";

const appList = joinAppNames(enabledApps.map((a) => a.name));

export const metadata: Metadata = {
  title: "Challenges",
  description: `${enabledApps.length} vulnerable OWASP ${enabledApps.length === 1 ? "app" : "apps"} to patch: ${appList}.`,
};

export default async function ChallengesPage() {
  // Both fetches are ISR-cached (revalidate 300) so this page stays static;
  // hint availability is public (ids only, no hint text).
  const [catalog, hintAvailability] = await Promise.all([
    getChallengeCatalog(),
    getHintAvailability(),
  ]);
  const sortedApps = [...enabledApps].sort((a, b) => a.name.localeCompare(b.name));

  const appNoun = enabledApps.length === 1 ? "app" : "apps";
  const description = catalog
    ? `${catalog.total} challenges across ${enabledApps.length} vulnerable ${appNoun}, each tagged with its OWASP Top 10 category. Points scale with difficulty. Patch the regression test tied to each challenge to score it.`
    : `${enabledTotalChallenges} challenges across ${enabledApps.length} vulnerable ${appNoun}, worth ${enabledTotalMaxPoints} points total. Points scale with difficulty. Patch the regression test tied to each challenge to score it.`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Targets" title="Challenges" description={description} />
      <HintNotice active={HINTS_ENABLED} cost={HINT_COST} />
      <ChallengeGrid apps={sortedApps} catalog={catalog?.byApp ?? null} hints={hintAvailability} />
    </div>
  );
}
