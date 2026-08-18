// Normalized leaderboard shapes consumed by the UI. Every data source
// (mock, lambda, upstash) maps into these; `capabilities` tells the UI which
// slices a source can actually provide so it can degrade gracefully.

import type { AppId } from "@/lib/apps";
import type { ModuleId } from "@/lib/modules";

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

/** secure-development's detail block: today's per-target progress map. */
export type SecureDevelopmentDetail = { kind: "secure-development"; apps: Partial<Record<AppId, AppProgress>> };
/** quiz's detail block (populated in phase 2). */
export type QuizDetail = { kind: "quiz"; answered: number; total: number; points: number };
/** Discriminated on `kind` — narrow on it rather than casting; each module
 *  contributes its own detail shape and a new module means a new branch, not
 *  a wider inferred type. */
export type ModuleDetail = SecureDevelopmentDetail | QuizDetail;

export type ModuleProgress = {
  /** This module's contribution to the row's total points. */
  points: number;
  /** Items completed in this module — solved flags, answered questions, … .
   *  Summed across modules to rank on breadth. */
  completed: number;
  /** ISO time of the most recent scoring activity in this module. */
  lastActivityAt: string | null;
  detail: ModuleDetail;
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
  /** Per-module breakdown. Empty for sources with no module data (upstash);
   *  ranking falls back to `patched`/`lastSolveAt` in that case. */
  modules?: Partial<Record<ModuleId, ModuleProgress>>;
};

export type TeamStanding = {
  rank: number;
  slug: string;
  name: string;
  /** GitHub login of the team's captain. */
  captain: string;
  points: number;
  members: string[];
  /** Points deducted for hints its members revealed (see leaderboard/
   *  hint-penalties.ts). `points` is net — this is a transparency marker,
   *  mirroring `LeaderboardEntry.hintPenalty`. */
  hintPenalty?: number;
  /** Per-app progress for the team — the UNION of members' solves, with
   *  each app's `challenges` marking which flags the team has collectively
   *  solved. Only populated when the source carries a challenge catalogue
   *  (the `challenges` capability); otherwise undefined and the teams view
   *  shows members only. */
  apps?: Partial<Record<AppId, AppProgress>>;
  // No per-module breakdown here yet: nothing renders one for a team, and
  // withTeamStandings replaces `data.teams` wholesale on the upstash path.
  // Phase 2 adds the field back together with the renderer that reads it.
};

/** A single team's cumulative-score history, ascending by time — mirrors
 *  `PlayerSeries` but keyed by team instead of player. */
export type TeamSeries = { slug: string; name: string; points: SeriesPoint[] };

export type SourceCapabilities = {
  /** Per-app breakdown available on list entries. */
  apps: boolean;
  /** Team standings + membership available. */
  teams: boolean;
  /** Per-challenge results available on profiles. */
  challenges: boolean;
};

/** One cumulative-score reading for a player at a point in time. */
export type SeriesPoint = { t: string; score: number };

/** A single player's cumulative-score history, ascending by time — the last
 *  point's score equals that player's current leaderboard score. */
export type PlayerSeries = { login: string; points: SeriesPoint[] };

export type LeaderboardData = {
  entries: LeaderboardEntry[];
  teams: TeamStanding[];
  generatedAt: string;
  capabilities: SourceCapabilities;
  /** Top-10 players' cumulative score over time, for the leaderboard line
   *  chart. Undefined/empty when the source can't build it (upstash) or the
   *  scorer has no rubric to derive history from — the chart hides itself. */
  series?: PlayerSeries[];
  /** Per-team cumulative score over time, mirroring `series`. Undefined when
   *  the source can't build it (no team concept, or the scorer predates
   *  team series support) — the team chart hides itself. */
  teamSeries?: TeamSeries[];
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
