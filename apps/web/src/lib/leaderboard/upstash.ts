import "server-only";
import type { LeaderboardSource } from "./source";
import type { LeaderboardData, LeaderboardEntry, UserProfile } from "./types";

// Direct read of the CURRENT real Upstash schema written by the scorer's
// `pushLeaderboard()` (dc34-owasp-secure-development-ctf .github/actions/ctf-score/src/upstash.ts):
//   ZADD leaderboard <score> <login>          (one global ZSET — latest write wins)
//   HSET team:<login> score maxScore patched total sha pr updatedAt
// No per-app breakdown, no per-challenge data, no real teams exist yet in
// this schema — capabilities reflect that. This adapter never writes; the
// shared REST /pipeline client lives in @/lib/upstash.

import { upstashPipeline as pipeline } from "@/lib/upstash";

function hgetallToObject(flat: unknown): Record<string, string> {
  const arr = Array.isArray(flat) ? (flat as string[]) : [];
  const obj: Record<string, string> = {};
  for (let i = 0; i < arr.length; i += 2) obj[arr[i]] = arr[i + 1];
  return obj;
}

async function fetchEntries(limit: number): Promise<LeaderboardEntry[]> {
  const [zrange] = await pipeline([["ZRANGE", "leaderboard", "0", String(limit - 1), "REV", "WITHSCORES"]]);
  const flat = Array.isArray(zrange.result) ? (zrange.result as string[]) : [];
  const logins: string[] = [];
  const scores: number[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    logins.push(flat[i]);
    scores.push(Number(flat[i + 1]));
  }
  if (logins.length === 0) return [];

  const hashResults = await pipeline(logins.map((login) => ["HGETALL", `team:${login}`]));
  return logins.map((login, i) => {
    const hash = hgetallToObject(hashResults[i]?.result);
    const patched = Number(hash.patched ?? 0);
    const total = Number(hash.total ?? 0);
    return {
      rank: i + 1,
      login,
      team: null,
      points: scores[i],
      patched,
      failed: Math.max(0, total - patched),
      total,
      apps: {},
      updatedAt: hash.updatedAt ?? null,
      // The hash's updatedAt is stamped on scoring changes, i.e. solves.
      lastSolveAt: hash.updatedAt ?? null,
      lastSha: hash.sha ?? null,
      lastPr: hash.pr ? Number(hash.pr) : null,
    };
  });
}

export const upstashSource: LeaderboardSource = {
  async getLeaderboard(): Promise<LeaderboardData> {
    const entries = await fetchEntries(50);
    return {
      entries,
      teams: [],
      generatedAt: new Date().toISOString(),
      capabilities: { apps: false, teams: false, challenges: false },
    };
  },

  async getUser(login: string): Promise<UserProfile | null> {
    const [hashResult] = await pipeline([["HGETALL", `team:${login}`]]);
    const hash = hgetallToObject(hashResult.result);
    if (Object.keys(hash).length === 0) return null;
    const patched = Number(hash.patched ?? 0);
    const total = Number(hash.total ?? 0);
    return {
      login,
      team: null,
      teamName: null,
      points: Number(hash.score ?? 0),
      maxPoints: Number(hash.maxScore ?? 0),
      patched,
      failed: Math.max(0, total - patched),
      total,
      apps: [],
      updatedAt: hash.updatedAt ?? null,
    };
  },
};
