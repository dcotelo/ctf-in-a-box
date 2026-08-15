import "server-only";
import type { AppId } from "@/lib/apps";
import { rankByStanding } from "./rank";
import type { LeaderboardSource } from "./source";
import type { LeaderboardData, LeaderboardEntry, PlayerSeries, TeamSeries, TeamStanding, UserProfile } from "./types";

// Shape returned by the deployed Lambda's real scoring endpoint:
// { leaderboard: [{ rank, author, points, lastSolveAt,
//                   apps: { "juice-shop": { solved, total }, ... } }],
//   series: [{ login, points: [{ t, score }, ...] }, ...],
//   teams: [{ rank, slug, name, captain, members, points, lastSolveAt, apps }, ...],
//   teamSeries: [{ slug, name, points: [{ t, score }, ...] }, ...] }
// There is no per-app point/max breakdown in this source. `series`/`teams`/
// `teamSeries` are all additive — read defensively since an older scorer
// deployment may not send any of them at all.
type LambdaAppProgress = { solved: number; total: number };
type LambdaEntry = {
  rank: number;
  author: string;
  points: number;
  /** ISO time of the most recent solve — added for tie-breaking. */
  lastSolveAt?: string | null;
  apps: Partial<Record<AppId, LambdaAppProgress>>;
};
// Loosely typed on purpose — this is unvalidated network input, tolerated
// (not assumed) to match the documented `series`/`teams`/`teamSeries` shapes.
type RawSeriesPoint = { t?: unknown; score?: unknown };
type RawPlayerSeries = { login?: unknown; points?: unknown };
type RawTeam = {
  rank?: unknown;
  slug?: unknown;
  name?: unknown;
  captain?: unknown;
  members?: unknown;
  points?: unknown;
};
type RawTeamSeries = { slug?: unknown; name?: unknown; points?: unknown };
type LambdaResponse = { leaderboard: LambdaEntry[]; series?: unknown; teams?: unknown; teamSeries?: unknown };

/** Defensively maps the Lambda's `series` field, tolerating it being absent,
 *  empty, or shaped unexpectedly (an older scorer deployment). Malformed
 *  points/players are dropped rather than throwing — a bad `series` should
 *  never take down the leaderboard, it should just fail to chart. */
function toSeries(raw: unknown): PlayerSeries[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const series: PlayerSeries[] = [];
  for (const item of raw as RawPlayerSeries[]) {
    if (!item || typeof item !== "object") continue;
    const { login, points } = item;
    if (typeof login !== "string" || !Array.isArray(points)) continue;
    const validPoints = (points as RawSeriesPoint[]).filter(
      (p): p is { t: string; score: number } =>
        !!p && typeof p === "object" && typeof p.t === "string" && typeof p.score === "number" && Number.isFinite(p.score),
    );
    if (validPoints.length > 0) series.push({ login, points: validPoints });
  }
  return series.length > 0 ? series : undefined;
}

/** Defensively maps the Lambda's `teams` field, tolerating it being absent
 *  or shaped unexpectedly (an older scorer deployment). Malformed team
 *  entries are dropped rather than throwing — a bad `teams` entry should
 *  never take down the leaderboard, it should just be excluded from
 *  standings. Always returns an array (never undefined) so callers can
 *  check `.length` to decide the `teams` capability. */
function toTeams(raw: unknown): TeamStanding[] {
  if (!Array.isArray(raw)) return [];
  const teams: TeamStanding[] = [];
  for (const item of raw as RawTeam[]) {
    if (!item || typeof item !== "object") continue;
    const { rank, slug, name, captain, members, points } = item;
    if (
      typeof rank !== "number" ||
      !Number.isFinite(rank) ||
      typeof slug !== "string" ||
      typeof name !== "string" ||
      typeof captain !== "string" ||
      typeof points !== "number" ||
      !Number.isFinite(points) ||
      !Array.isArray(members)
    ) {
      continue;
    }
    const validMembers = members.filter((m): m is string => typeof m === "string");
    teams.push({ rank, slug, name, captain, members: validMembers, points });
  }
  return teams;
}

/** Defensively maps the Lambda's `teamSeries` field, mirroring `toSeries`
 *  but keyed by team instead of player. */
function toTeamSeries(raw: unknown): TeamSeries[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const series: TeamSeries[] = [];
  for (const item of raw as RawTeamSeries[]) {
    if (!item || typeof item !== "object") continue;
    const { slug, name, points } = item;
    if (typeof slug !== "string" || typeof name !== "string" || !Array.isArray(points)) continue;
    const validPoints = (points as RawSeriesPoint[]).filter(
      (p): p is { t: string; score: number } =>
        !!p && typeof p === "object" && typeof p.t === "string" && typeof p.score === "number" && Number.isFinite(p.score),
    );
    if (validPoints.length > 0) series.push({ slug, name, points: validPoints });
  }
  return series.length > 0 ? series : undefined;
}

function toEntry(raw: LambdaEntry): LeaderboardEntry {
  const apps: LeaderboardEntry["apps"] = {};
  let patched = 0;
  let total = 0;
  for (const [app, progress] of Object.entries(raw.apps) as [AppId, LambdaAppProgress][]) {
    patched += progress.solved;
    total += progress.total;
    apps[app] = { app, points: 0, maxPoints: 0, patched: progress.solved, total: progress.total };
  }
  return {
    rank: raw.rank,
    login: raw.author,
    team: null,
    points: raw.points,
    patched,
    // The Lambda only reports solved/total — unsolved challenges are
    // "remaining", not "failed" (there is no failing-test-run data in this
    // source), so failed is always 0 and the UI derives remaining instead.
    failed: 0,
    total,
    apps,
    // A solve is the only thing that updates this source, so the last solve
    // is also the last update.
    updatedAt: raw.lastSolveAt ?? null,
    lastSolveAt: raw.lastSolveAt ?? null,
  };
}

export const lambdaSource: LeaderboardSource = {
  async getLeaderboard(): Promise<LeaderboardData> {
    const base = process.env.LEADERBOARD_API_URL;
    if (!base) throw new Error("LEADERBOARD_API_URL is not set");
    const res = await fetch(`${base.replace(/\/$/, "")}/leaderboard`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) throw new Error(`Lambda leaderboard fetch failed: HTTP ${res.status}`);
    const data = (await res.json()) as LambdaResponse;
    const teams = toTeams(data.teams);
    return {
      // Re-rank rather than trusting the Lambda's rank field, so the
      // lastSolveAt tie-break is applied even if the Lambda ordered ties
      // arbitrarily.
      entries: rankByStanding(data.leaderboard.map(toEntry)),
      teams,
      generatedAt: new Date().toISOString(),
      capabilities: { apps: true, teams: teams.length > 0, challenges: false },
      series: toSeries(data.series),
      teamSeries: toTeamSeries(data.teamSeries),
    };
  },

  async getUser(login: string): Promise<UserProfile | null> {
    const data = await this.getLeaderboard();
    const entry = data.entries.find((e) => e.login === login);
    if (!entry) return null;
    return {
      login: entry.login,
      team: null,
      teamName: null,
      points: entry.points,
      maxPoints: 0,
      patched: entry.patched,
      failed: entry.failed,
      total: entry.total,
      apps: Object.values(entry.apps).filter(Boolean) as UserProfile["apps"],
      updatedAt: entry.updatedAt,
    };
  },
};
