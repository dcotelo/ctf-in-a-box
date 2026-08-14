import "server-only";
import { GetItemCommand, QueryCommand, type AttributeValue, type QueryCommandInput } from "@aws-sdk/client-dynamodb";
import { CTF_DYNAMO_TABLE, getDynamoClient } from "@/lib/dynamo";
import { getN, getS, type DynamoItem } from "@/lib/dynamo-shapes";
import { apps, type AppId } from "@/lib/apps";
import { getChallengeCatalog } from "@/lib/challenges";
import { rankByStanding } from "./rank";
import type { LeaderboardSource } from "./source";
import type { AppProgress, LeaderboardData, LeaderboardEntry, UserProfile } from "./types";

// Direct read of the scorer-owned items in the shared `ctf-leaderboard` table
// (the scorer repo's .github/actions/ctf-score/src/dynamo.ts):
//
//   leaderboard  pk=LEADERBOARD      sk=AUTHOR#<login>       + points, author, updatedAt
//   solve        pk=AUTHOR#<login>   sk=SOLVE#<app>#<flag>   + app, flag, solvedAt, firstPr, sha
//
// The scorer owns both shapes; this adapter is READ-ONLY (dynamo-shapes.ts
// covers only the keys the web app writes, so the scorer's key builders live
// here — the same way leaderboard/upstash.ts holds its own schema knowledge).
//
// Point totals are per-author only: the scorer prices the union of an author's
// solved flags into one `points` value and does not persist a per-app
// breakdown, so per-app `points`/`maxPoints` stay 0 exactly as in lambda.ts.
// Per-app CHALLENGE totals aren't in the table at all — they come from the live
// `/challenges` catalogue, falling back to the static counts in lib/apps.ts.

const LEADERBOARD_PK = "LEADERBOARD";
const AUTHOR_PREFIX = "AUTHOR#";
const SOLVE_PREFIX = "SOLVE#";

const authorPk = (login: string): string => `${AUTHOR_PREFIX}${login}`;
const authorSk = (login: string): string => `${AUTHOR_PREFIX}${login}`;

/** One Query per author, so a large field can't open hundreds of simultaneous
 *  connections from a single render. */
const SOLVE_QUERY_CONCURRENCY = 8;

const APP_IDS: AppId[] = apps.map((app) => app.id);
const STATIC_TOTALS = Object.fromEntries(apps.map((app) => [app.id, app.challengeCount])) as Record<AppId, number>;
const isAppId = (value: string): value is AppId => (APP_IDS as string[]).includes(value);

type Solve = { app: string; solvedAt: string | null };

/** The later of two timestamps, treating null as "no timestamp". */
export function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** Every page of a Query, concatenated. The table has no Scan permission on the
 *  `ctf-web-dynamodb` role (see lib/dynamo.ts), so both reads here are Queries. */
async function queryAll(params: QueryCommandInput): Promise<DynamoItem[]> {
  const items: DynamoItem[] = [];
  let startKey: Record<string, AttributeValue> | undefined;
  do {
    const res = await getDynamoClient().send(new QueryCommand({ ...params, ExclusiveStartKey: startKey }));
    items.push(...((res.Items ?? []) as DynamoItem[]));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items;
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Every solve for one author, across all apps — they share the author's
 *  partition, so this is a single Query rather than one per app. */
async function querySolves(login: string): Promise<Solve[]> {
  const items = await queryAll({
    TableName: CTF_DYNAMO_TABLE,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
    ExpressionAttributeValues: { ":pk": { S: authorPk(login) }, ":prefix": { S: SOLVE_PREFIX } },
    // `app` is a DynamoDB reserved word — alias it.
    ExpressionAttributeNames: { "#app": "app" },
    ProjectionExpression: "#app, solvedAt",
  });
  return items.map((item) => ({ app: getS(item, "app") ?? "", solvedAt: getS(item, "solvedAt") }));
}

/** Challenge counts per app, live catalogue first. A missing catalogue (or an
 *  app absent from it) keeps that app's static count rather than reporting 0,
 *  which would render every contestant as having solved everything. */
async function appTotals(): Promise<Record<AppId, number>> {
  const catalog = await getChallengeCatalog();
  if (!catalog) return STATIC_TOTALS;
  const totals = { ...STATIC_TOTALS };
  for (const app of APP_IDS) {
    const count = catalog.byApp[app]?.length;
    if (count) totals[app] = count;
  }
  return totals;
}

function toEntry(args: {
  login: string;
  points: number;
  updatedAt: string | null;
  solves: Solve[];
  totals: Record<AppId, number>;
}): LeaderboardEntry {
  const solvedByApp = new Map<AppId, number>();
  let lastSolveAt: string | null = null;
  for (const solve of args.solves) {
    if (!isAppId(solve.app)) continue;
    solvedByApp.set(solve.app, (solvedByApp.get(solve.app) ?? 0) + 1);
    lastSolveAt = laterOf(lastSolveAt, solve.solvedAt);
  }

  // All six apps, zeros included — the same contract lambda.ts produced, so
  // `total` is the whole catalogue and the UI's progress math is unchanged.
  const appProgress: LeaderboardEntry["apps"] = {};
  let patched = 0;
  let total = 0;
  for (const app of APP_IDS) {
    const solved = solvedByApp.get(app) ?? 0;
    patched += solved;
    total += args.totals[app];
    appProgress[app] = { app, points: 0, maxPoints: 0, patched: solved, total: args.totals[app] };
  }

  return {
    // Placeholder — rankByStanding assigns rank from the sorted position.
    rank: 0,
    login: args.login,
    team: null,
    points: args.points,
    patched,
    // Dynamo records solves only; an unsolved challenge is "remaining", not a
    // failed test run, so the UI derives remaining from total - patched.
    failed: 0,
    total,
    apps: appProgress,
    // The scorer stamps updatedAt on the leaderboard row when it recomputes a
    // total, i.e. on a solve — fall back to the solves themselves if absent.
    updatedAt: args.updatedAt ?? lastSolveAt,
    lastSolveAt,
  };
}

export const dynamoSource: LeaderboardSource = {
  async getLeaderboard(): Promise<LeaderboardData> {
    const rows = await queryAll({
      TableName: CTF_DYNAMO_TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": { S: LEADERBOARD_PK }, ":prefix": { S: AUTHOR_PREFIX } },
    });

    const authors = rows
      .map((row) => ({
        // `author` is written on the row; the sk suffix is the fallback.
        login: getS(row, "author") ?? getS(row, "sk")?.slice(AUTHOR_PREFIX.length) ?? "",
        points: getN(row, "points"),
        updatedAt: getS(row, "updatedAt"),
      }))
      .filter((author) => author.login);

    const [totals, solvesByAuthor] = await Promise.all([
      appTotals(),
      mapLimit(authors, SOLVE_QUERY_CONCURRENCY, (author) => querySolves(author.login)),
    ]);

    return {
      entries: rankByStanding(authors.map((author, i) => toEntry({ ...author, solves: solvesByAuthor[i], totals }))),
      teams: [],
      generatedAt: new Date().toISOString(),
      capabilities: { apps: true, teams: false, challenges: false },
    };
  },

  async getUser(login: string): Promise<UserProfile | null> {
    const [row, solves, totals] = await Promise.all([
      getDynamoClient()
        .send(
          new GetItemCommand({
            TableName: CTF_DYNAMO_TABLE,
            Key: { pk: { S: LEADERBOARD_PK }, sk: { S: authorSk(login) } },
          }),
        )
        .then((res) => res.Item as DynamoItem | undefined),
      querySolves(login),
      appTotals(),
    ]);

    // No leaderboard row AND no solves = not a contestant. A row with no solves
    // (or solves not yet totalled) still renders, at 0.
    if (!row && solves.length === 0) return null;

    const entry = toEntry({
      login,
      points: getN(row, "points"),
      updatedAt: getS(row, "updatedAt"),
      solves,
      totals,
    });

    return {
      login,
      team: null,
      teamName: null,
      points: entry.points,
      // Per-app pricing isn't persisted, so there is no max to report.
      maxPoints: 0,
      patched: entry.patched,
      failed: entry.failed,
      total: entry.total,
      apps: Object.values(entry.apps).filter(Boolean) as AppProgress[],
      updatedAt: entry.updatedAt,
    };
  },
};
