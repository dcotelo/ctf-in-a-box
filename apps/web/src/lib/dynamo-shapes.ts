// Key builders + raw AttributeValue helpers for the web app's items in the shared
// `ctf-leaderboard` table. The scorer owns pk=LEADERBOARD and pk=AUTHOR#<login>;
// the web app writes only under TEAMS / USER# / HINTSPEND so the two can never
// collide. Deliberately NOT "server-only": scripts/backfill-dynamo.ts reuses it.
//
//   pk=TEAMS            sk=TEAM#<slug>          team meta + members (String Set —
//                                               never empty; the team is deleted
//                                               with its last member)
//   pk=USER#<login>     sk=PROFILE              login, team (absent = no team)
//   pk=USER#<login>     sk=HINT#<app>#<id>      one item per hint purchase
//   pk=HINTSPEND        sk=AUTHOR#<login>       running penalty total (spent N) —
//                                               one Query serves the leaderboard,
//                                               like HGETALL ctf:hints:spent
//   pk=HINTS            sk=HINT#<app>#<id>      hint text, copied from the
//                                               scorer-seeded hints:<app> hashes
//                                               by the backfill (Upstash stays
//                                               the authority — re-backfill
//                                               after any re-seeding)
//   pk=STATS            sk=COUNTRY#<iso2>       aggregate reach counter (count N).
//                                               Deliberately a bare tally: no
//                                               login, no IP, no timestamp, and
//                                               nothing that could be joined back
//                                               to a person. Do not add fields
//                                               here without re-reading /privacy.
//   pk=GATE             sk=IP#<ip>              challenges-gate brute-force
//                                               throttle (failures N, lastFailAt
//                                               N epoch-ms, ttl N epoch-SECONDS).
//                                               ttl is a 30-day retention bound on
//                                               the IP, reaped by DynamoDB; the 24h
//                                               lock itself is still enforced on
//                                               read, since TTL deletion is only
//                                               best-effort. Requires TTL enabled
//                                               on the table with AttributeName
//                                               "ttl" — see README.

import type { AttributeValue } from "@aws-sdk/client-dynamodb";

export type DynamoItem = Record<string, AttributeValue>;

export const STATS_PK = "STATS";
export const TEAMS_PK = "TEAMS";
export const HINTSPEND_PK = "HINTSPEND";
export const HINTS_PK = "HINTS";
export const GATE_PK = "GATE";
export const PROFILE_SK = "PROFILE";
export const HINT_SK_PREFIX = "HINT#";

export const teamSk = (slug: string) => `TEAM#${slug}`;
export const userPk = (login: string) => `USER#${login}`;
export const hintSk = (app: string, id: string) => `${HINT_SK_PREFIX}${app}#${id}`;
export const spendSk = (login: string) => `AUTHOR#${login}`;
export const gateSk = (ip: string) => `IP#${ip}`;
export const countrySk = (code: string) => `COUNTRY#${code}`;

export const getS = (item: DynamoItem | undefined, name: string): string | null => {
  const value = item?.[name]?.S;
  return typeof value === "string" && value ? value : null;
};

export const getN = (item: DynamoItem | undefined, name: string): number => {
  const value = Number(item?.[name]?.N);
  return Number.isFinite(value) ? value : 0;
};

export const getSS = (item: DynamoItem | undefined, name: string): string[] => {
  const value = item?.[name]?.SS;
  return Array.isArray(value) ? [...value] : [];
};

export function teamItem(args: { slug: string; name: string; captain: string; createdAt: string; members: string[] }): DynamoItem {
  return {
    pk: { S: TEAMS_PK },
    sk: { S: teamSk(args.slug) },
    slug: { S: args.slug },
    name: { S: args.name },
    captain: { S: args.captain },
    createdAt: { S: args.createdAt },
    members: { SS: args.members },
  };
}

export function profileItem(login: string, team: string, updatedAt: string): DynamoItem {
  return {
    pk: { S: userPk(login) },
    sk: { S: PROFILE_SK },
    login: { S: login },
    team: { S: team },
    updatedAt: { S: updatedAt },
  };
}

export function hintPurchaseItem(args: { login: string; app: string; id: string; cost: number; purchasedAt: string }): DynamoItem {
  return {
    pk: { S: userPk(args.login) },
    sk: { S: hintSk(args.app, args.id) },
    login: { S: args.login },
    app: { S: args.app },
    challengeId: { S: args.id },
    cost: { N: String(args.cost) },
    purchasedAt: { S: args.purchasedAt },
  };
}

export function hintTextItem(args: { app: string; id: string; text: string; updatedAt: string }): DynamoItem {
  return {
    pk: { S: HINTS_PK },
    sk: { S: hintSk(args.app, args.id) },
    app: { S: args.app },
    challengeId: { S: args.id },
    text: { S: args.text },
    updatedAt: { S: args.updatedAt },
  };
}

export function spendItem(login: string, spent: number, updatedAt: string): DynamoItem {
  return {
    pk: { S: HINTSPEND_PK },
    sk: { S: spendSk(login) },
    login: { S: login },
    spent: { N: String(spent) },
    updatedAt: { S: updatedAt },
  };
}
