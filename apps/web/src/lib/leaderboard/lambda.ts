import "server-only";
import type { AppId } from "@/lib/apps";
import { rankByStanding } from "./rank";
import type { LeaderboardSource } from "./source";
import type { LeaderboardData, LeaderboardEntry, UserProfile } from "./types";

// Shape returned by the deployed Lambda's real scoring endpoint:
// { leaderboard: [{ rank, author, points, lastSolveAt,
//                   apps: { "juice-shop": { solved, total }, ... } }] }
// There is no per-app point/max breakdown and no team concept in this source.
type LambdaAppProgress = { solved: number; total: number };
type LambdaEntry = {
  rank: number;
  author: string;
  points: number;
  /** ISO time of the most recent solve — added for tie-breaking. */
  lastSolveAt?: string | null;
  apps: Partial<Record<AppId, LambdaAppProgress>>;
};
type LambdaResponse = { leaderboard: LambdaEntry[] };

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
    return {
      // Re-rank rather than trusting the Lambda's rank field, so the
      // lastSolveAt tie-break is applied even if the Lambda ordered ties
      // arbitrarily.
      entries: rankByStanding(data.leaderboard.map(toEntry)),
      teams: [],
      generatedAt: new Date().toISOString(),
      capabilities: { apps: true, teams: false, challenges: false },
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
