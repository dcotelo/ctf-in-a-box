import "server-only";
import { isModuleEnabled } from "@/lib/modules";
import { rankByStanding } from "./rank";
import type { AppProgress, LeaderboardData, LeaderboardEntry, ModuleProgress, TeamStanding } from "./types";
import type { AppId } from "@/lib/apps";
import type { ModuleId } from "@/lib/modules";

/**
 * Builds each row's per-module breakdown and re-ranks on the combined result.
 *
 * The source's `points` already holds secure-development's score (it comes from
 * the scorer), so that module is ATTRIBUTED rather than added — adding it would
 * double count. Modules that score app-side (the quiz, from phase 2) add their
 * points on top.
 *
 * This re-ranks UNCONDITIONALLY. It is tempting to let withHintPenalties do the
 * final re-rank since it already re-ranks internally, but it returns early when
 * hints are disabled — the board would then show combined points in the
 * source's original order.
 *
 * Note: the generic-helper shape sketched for this overlay (one function over
 * `LeaderboardEntry | TeamStanding`) doesn't typecheck cleanly — `apps` is
 * required on `LeaderboardEntry` but optional on `TeamStanding`, and
 * `lastSolveAt`/`lastActivityAt` provenance differs between the two row kinds
 * (an entry has its own solve time; a team has none). Splitting into two small
 * helpers keeps both row shapes exact without an `any` or unjustified
 * non-null assertion.
 */
export async function withModuleContributions(data: LeaderboardData): Promise<LeaderboardData> {
  const secureDev = isModuleEnabled("secure-development") && data.capabilities.apps;

  const entries = rankByStanding(data.entries.map((entry) => attributeEntry(entry, secureDev)));
  const teams = data.teams.map((team) => attributeTeam(team, secureDev));

  return { ...data, entries, teams };
}

function secureDevelopmentModule(
  points: number,
  patched: number,
  lastActivityAt: string | null,
  apps: Partial<Record<AppId, AppProgress>>,
): ModuleProgress {
  return { points, completed: patched, lastActivityAt, detail: { apps } };
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

function attributeTeam(team: TeamStanding, secureDev: boolean): TeamStanding {
  const apps = team.apps ?? {};
  const modules: Partial<Record<ModuleId, ModuleProgress>> = {};
  if (secureDev && Object.keys(apps).length > 0) {
    const patched = Object.values(apps).reduce((n, a) => n + (a?.patched ?? 0), 0);
    // TeamStanding carries no lastSolveAt (no single "the team's" solve time),
    // so the team's module activity has no source field to attribute from.
    modules["secure-development"] = secureDevelopmentModule(team.points, patched, null, apps);
  }
  return { ...team, modules };
}
