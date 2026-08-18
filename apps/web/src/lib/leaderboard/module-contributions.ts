import "server-only";
import { isModuleEnabled } from "@/lib/modules";
import { rankByStanding } from "./rank";
import type { AppProgress, LeaderboardData, LeaderboardEntry, ModuleProgress } from "./types";
import type { AppId } from "@/lib/apps";
import type { ModuleId } from "@/lib/modules";

/**
 * Builds each contestant row's per-module breakdown and re-ranks on the
 * combined result.
 *
 * The source's `points` already holds secure-development's score (it comes from
 * the scorer), so that module is ATTRIBUTED rather than added — adding it would
 * double count. Modules that score app-side (the quiz, from phase 2) add their
 * points on top.
 *
 * Runs AFTER withHintPenalties (see the pipeline comment in
 * `app/(site)/leaderboard/page.tsx`) so the attributed figure is the row's net,
 * post-penalty score — otherwise an expanded row shows a module total larger
 * than the header it sits under. This re-ranks UNCONDITIONALLY, so being last
 * in the pipeline is what makes the final order deterministic: withHintPenalties
 * returns early when hints are disabled and can't be relied on to produce it.
 *
 * Teams pass through untouched. Team rows have no per-module renderer yet, and
 * `withTeamStandings` replaces `data.teams` wholesale on the upstash path
 * anyway — a per-team breakdown lands in phase 2 together with the UI that
 * reads it.
 */
export async function withModuleContributions(data: LeaderboardData): Promise<LeaderboardData> {
  const secureDev = isModuleEnabled("secure-development") && data.capabilities.apps;

  const entries = rankByStanding(data.entries.map((entry) => attributeEntry(entry, secureDev)));

  return { ...data, entries };
}

function secureDevelopmentModule(
  points: number,
  patched: number,
  lastActivityAt: string | null,
  apps: Partial<Record<AppId, AppProgress>>,
): ModuleProgress {
  return { points, completed: patched, lastActivityAt, detail: { kind: "secure-development", apps } };
}

function attributeEntry(entry: LeaderboardEntry, secureDev: boolean): LeaderboardEntry {
  const modules: Partial<Record<ModuleId, ModuleProgress>> = {};
  if (secureDev && Object.keys(entry.apps).length > 0) {
    modules["secure-development"] = secureDevelopmentModule(
      entry.points,
      entry.patched,
      entry.lastSolveAt ?? null,
      entry.apps,
    );
  }
  return { ...entry, modules };
}
