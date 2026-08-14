// Normalized leaderboard shapes consumed by the UI. Every data source
// (mock, lambda, upstash) maps into these; `capabilities` tells the UI which
// slices a source can actually provide so it can degrade gracefully.

import type { AppId } from "@/lib/apps";

/** Scorer semantics: patched = regression test passed (challenge fixed),
 *  open = test ran and the vulnerability is still present (failed),
 *  missing = the PR didn't include a runnable test for the challenge. */
export type ChallengeStatus = "patched" | "open" | "missing";

export type ChallengeResult = {
  /** Stable catalogue key, e.g. "loginAdminChallenge" or "brute-low". */
  key: string;
  name: string;
  /** Difficulty stars = points awarded when patched. */
  points: number;
  status: ChallengeStatus;
  /** OWASP code ("A01", "API3") or null when unmapped. */
  owasp: string | null;
};

export type AppProgress = {
  app: AppId;
  points: number;
  maxPoints: number;
  patched: number;
  total: number;
  /** Per-challenge detail — only populated on profile views, never in lists. */
  challenges?: ChallengeResult[];
};

export type LeaderboardEntry = {
  rank: number;
  /** GitHub login — the row key (the scorer records the PR author's login). */
  login: string;
  /** Team slug, or null for solo contestants. */
  team: string | null;
  points: number;
  patched: number;
  /** Challenges whose tests ran in the best-scoring runs and did not pass. */
  failed: number;
  total: number;
  apps: Partial<Record<AppId, AppProgress>>;
  updatedAt: string | null;
  /** ISO time of the contestant's most recent solve — the point-tie breaker:
   *  whoever reached the score first (earlier last solve) ranks higher. */
  lastSolveAt?: string | null;
  /** Points already deducted for revealed hints (see leaderboard/
   *  hint-penalties.ts). `points` is net — this is a transparency marker. */
  hintPenalty?: number;
  /** Pre-formatted relative time ("4m ago"), filled in on the server so the
   *  client renders identical markup (no Date() hydration drift). */
  updatedAgo?: string;
  /** Legacy-schema extras shown when per-app data is unavailable. */
  lastSha?: string | null;
  lastPr?: number | null;
};

export type TeamStanding = {
  rank: number;
  slug: string;
  name: string;
  points: number;
  members: string[];
};

export type SourceCapabilities = {
  /** Per-app breakdown available on list entries. */
  apps: boolean;
  /** Team standings + membership available. */
  teams: boolean;
  /** Per-challenge results available on profiles. */
  challenges: boolean;
};

export type LeaderboardData = {
  entries: LeaderboardEntry[];
  teams: TeamStanding[];
  generatedAt: string;
  capabilities: SourceCapabilities;
};

export type UserProfile = {
  login: string;
  team: string | null;
  teamName: string | null;
  points: number;
  maxPoints: number;
  patched: number;
  failed: number;
  total: number;
  apps: AppProgress[];
  updatedAt: string | null;
};
