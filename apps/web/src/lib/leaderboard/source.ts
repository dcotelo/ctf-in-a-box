import "server-only";
import type { LeaderboardData, UserProfile } from "./types";
import { mockSource } from "./mock";
import { lambdaSource } from "./lambda";
import { upstashSource } from "./upstash";
import { dynamoSource } from "./dynamo";

export interface LeaderboardSource {
  getLeaderboard(): Promise<LeaderboardData>;
  getUser(login: string): Promise<UserProfile | null>;
}

/**
 * `LEADERBOARD_SOURCE` switches the backend without touching any UI code:
 *  - "mock"    (default) — local fixture shaped like the proposed v2 API.
 *  - "lambda"  — the deployed Lambda's `GET /leaderboard` (live scoring;
 *                per-app solved/total, no per-challenge or point breakdown).
 *                NOTE: that endpoint reads UPSTASH, not DynamoDB.
 *  - "dynamo"  — direct read of the scorer's DynamoDB items (same per-app
 *                solved/total contract as "lambda", no Lambda round-trip).
 *  - "upstash" — direct read of the CURRENT real Upstash schema (read-only
 *                token) — aggregates only, no teams, no per-app breakdown.
 */
const VALID_MODES = ["mock", "lambda", "dynamo", "upstash"] as const;

export type LeaderboardSourceMode = (typeof VALID_MODES)[number];

function isValidMode(value: string | undefined): value is LeaderboardSourceMode {
  return (VALID_MODES as readonly string[]).includes(value ?? "");
}

/** Unrecognised values are only ever warned about once each. Unlike
 *  CTF_DATA_BACKEND, which is resolved at module load, this runs per request. */
const warnedValues = new Set<string>();

export function getLeaderboardSourceMode(): LeaderboardSourceMode {
  const mode = process.env.LEADERBOARD_SOURCE;
  if (isValidMode(mode)) return mode;
  // A typo here fails toward placeholder data rather than toward an error, so
  // say so loudly. "dynamodb" for "dynamo" is the easy one to get wrong, and
  // the only other signal is the amber banner on /leaderboard.
  if (mode && !warnedValues.has(mode)) {
    warnedValues.add(mode);
    console.warn(
      `[leaderboard] unknown LEADERBOARD_SOURCE "${mode}" — falling back to "mock", ` +
        `so the board will serve placeholder data instead of real scores. ` +
        `Valid values: ${VALID_MODES.join(", ")}.`,
    );
  }
  return "mock";
}

export function getLeaderboardSource(): LeaderboardSource {
  switch (getLeaderboardSourceMode()) {
    case "lambda":
      return lambdaSource;
    case "dynamo":
      return dynamoSource;
    case "upstash":
      return upstashSource;
    case "mock":
      return mockSource;
  }
}
