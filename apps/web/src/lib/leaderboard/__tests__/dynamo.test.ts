// Unit tests for the DynamoDB leaderboard source. The client is mocked at
// getDynamoClient (same idiom as lib/__tests__/dynamo-team-store.test.ts) and
// the live challenge catalogue is mocked so totals are deterministic.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn<(command: { input: Record<string, unknown> }) => Promise<unknown>>(),
  getChallengeCatalog: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dynamo", () => ({
  CTF_DYNAMO_TABLE: "ctf-leaderboard",
  DATA_BACKEND: "dynamo",
  getDynamoClient: () => ({ send: mocks.send }),
}));
vi.mock("@/lib/challenges", () => ({ getChallengeCatalog: mocks.getChallengeCatalog }));

import { dynamoSource, laterOf } from "../dynamo";
import { apps } from "@/lib/apps";

const STATIC_TOTAL = apps.reduce((sum, app) => sum + app.challengeCount, 0);

const leaderboardRow = (author: string, points: number, updatedAt?: string) => ({
  pk: { S: "LEADERBOARD" },
  sk: { S: `AUTHOR#${author}` },
  author: { S: author },
  points: { N: String(points) },
  ...(updatedAt ? { updatedAt: { S: updatedAt } } : {}),
});

const solveRow = (app: string, solvedAt: string) => ({ app: { S: app }, solvedAt: { S: solvedAt } });

/** Inputs of every Query the source issued, in order. */
const queryInputs = () =>
  mocks.send.mock.calls.map(([cmd]) => cmd.input).filter((input) => "KeyConditionExpression" in input);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getChallengeCatalog.mockResolvedValue(null);
});

describe("laterOf", () => {
  it("returns the later timestamp and tolerates nulls", () => {
    expect(laterOf("2026-07-01T00:00:00.000Z", "2026-07-02T00:00:00.000Z")).toBe("2026-07-02T00:00:00.000Z");
    expect(laterOf("2026-07-02T00:00:00.000Z", "2026-07-01T00:00:00.000Z")).toBe("2026-07-02T00:00:00.000Z");
    expect(laterOf(null, "2026-07-01T00:00:00.000Z")).toBe("2026-07-01T00:00:00.000Z");
    expect(laterOf("2026-07-01T00:00:00.000Z", null)).toBe("2026-07-01T00:00:00.000Z");
    expect(laterOf(null, null)).toBeNull();
  });
});

describe("getLeaderboard", () => {
  it("returns an empty board when the LEADERBOARD partition is empty", async () => {
    mocks.send.mockResolvedValueOnce({ Items: [] });

    const data = await dynamoSource.getLeaderboard();

    expect(data.entries).toEqual([]);
    expect(data.teams).toEqual([]);
    // teams:false so withTeamStandings still overlays live team data.
    expect(data.capabilities).toEqual({ apps: true, teams: false, challenges: false });
    // No authors => no solve queries.
    expect(queryInputs()).toHaveLength(1);
  });

  it("aggregates per-app solved counts and the latest solve time", async () => {
    mocks.send
      .mockResolvedValueOnce({ Items: [leaderboardRow("cmaenner", 16, "2026-07-27T23:07:34.432Z")] })
      .mockResolvedValueOnce({
        Items: [
          solveRow("vampi", "2026-07-27T23:07:34.432Z"),
          solveRow("vampi", "2026-07-20T10:00:00.000Z"),
          solveRow("dvwa", "2026-07-25T12:00:00.000Z"),
        ],
      });

    const [entry] = (await dynamoSource.getLeaderboard()).entries;

    expect(entry.rank).toBe(1);
    expect(entry.login).toBe("cmaenner");
    expect(entry.points).toBe(16);
    expect(entry.patched).toBe(3);
    expect(entry.failed).toBe(0);
    expect(entry.total).toBe(STATIC_TOTAL);
    expect(entry.apps.vampi).toMatchObject({ app: "vampi", patched: 2, points: 0, maxPoints: 0 });
    expect(entry.apps.dvwa).toMatchObject({ patched: 1 });
    // All six apps present, zeros included — the contract lambda.ts produced.
    expect(Object.keys(entry.apps)).toHaveLength(apps.length);
    expect(entry.apps.webgoat).toMatchObject({ patched: 0 });
    expect(entry.lastSolveAt).toBe("2026-07-27T23:07:34.432Z");
    expect(entry.updatedAt).toBe("2026-07-27T23:07:34.432Z");
  });

  it("queries the scorer's keys and aliases the reserved `app` attribute", async () => {
    mocks.send
      .mockResolvedValueOnce({ Items: [leaderboardRow("cmaenner", 16)] })
      .mockResolvedValueOnce({ Items: [] });

    await dynamoSource.getLeaderboard();
    const [board, solves] = queryInputs();

    expect(board.ExpressionAttributeValues).toEqual({
      ":pk": { S: "LEADERBOARD" },
      ":prefix": { S: "AUTHOR#" },
    });
    expect(solves.ExpressionAttributeValues).toEqual({
      ":pk": { S: "AUTHOR#cmaenner" },
      ":prefix": { S: "SOLVE#" },
    });
    expect(solves.ExpressionAttributeNames).toEqual({ "#app": "app" });
    expect(solves.ProjectionExpression).toBe("#app, solvedAt");
  });

  it("ranks by challenges solved before points", async () => {
    mocks.send
      .mockResolvedValueOnce({ Items: [leaderboardRow("few-but-hard", 50), leaderboardRow("many-but-easy", 20)] })
      .mockResolvedValueOnce({ Items: [solveRow("vampi", "2026-07-01T00:00:00.000Z")] })
      .mockResolvedValueOnce({
        Items: [solveRow("dvwa", "2026-07-02T00:00:00.000Z"), solveRow("dvwa", "2026-07-03T00:00:00.000Z")],
      });

    const entries = (await dynamoSource.getLeaderboard()).entries;

    expect(entries.map((e) => [e.login, e.rank, e.patched, e.points])).toEqual([
      ["many-but-easy", 1, 2, 20],
      ["few-but-hard", 2, 1, 50],
    ]);
  });

  it("follows Query pagination on both reads", async () => {
    // Authors are queried concurrently, so key the responses on the request's
    // partition + cursor rather than on call order.
    mocks.send.mockImplementation(async (cmd) => {
      const values = cmd.input.ExpressionAttributeValues as Record<string, { S: string }>;
      const page2 = Boolean(cmd.input.ExclusiveStartKey);
      if (values[":pk"].S === "LEADERBOARD") {
        return page2
          ? { Items: [leaderboardRow("b", 2)] }
          : { Items: [leaderboardRow("a", 1)], LastEvaluatedKey: { pk: { S: "LEADERBOARD" } } };
      }
      if (values[":pk"].S === "AUTHOR#a") {
        return page2
          ? { Items: [solveRow("dvwa", "2026-07-02T00:00:00.000Z")] }
          : { Items: [solveRow("vampi", "2026-07-01T00:00:00.000Z")], LastEvaluatedKey: { sk: { S: "SOLVE#vampi#x" } } };
      }
      return { Items: [] };
    });

    const entries = (await dynamoSource.getLeaderboard()).entries;

    // Both leaderboard pages were read, and both of author a's solve pages.
    expect(entries.find((e) => e.login === "a")?.patched).toBe(2);
    expect(entries.find((e) => e.login === "b")?.patched).toBe(0);
  });

  it("falls back to the sk suffix when the row has no author attribute", async () => {
    const row = leaderboardRow("cmaenner", 16);
    delete (row as Record<string, unknown>).author;
    mocks.send.mockResolvedValueOnce({ Items: [row] }).mockResolvedValueOnce({ Items: [] });

    const [entry] = (await dynamoSource.getLeaderboard()).entries;

    expect(entry.login).toBe("cmaenner");
  });

  it("ignores solves for apps outside the catalogue", async () => {
    mocks.send
      .mockResolvedValueOnce({ Items: [leaderboardRow("cmaenner", 16)] })
      .mockResolvedValueOnce({ Items: [solveRow("vampi", "2026-07-01T00:00:00.000Z"), solveRow("retired-app", "2026-07-02T00:00:00.000Z")] });

    const [entry] = (await dynamoSource.getLeaderboard()).entries;

    expect(entry.patched).toBe(1);
    // The unknown app contributes no solve and no timestamp.
    expect(entry.lastSolveAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("prefers live catalogue totals over the static fallback", async () => {
    mocks.getChallengeCatalog.mockResolvedValue({
      byApp: { vampi: new Array(9).fill({}), dvwa: new Array(55).fill({}) },
      total: 64,
    });
    mocks.send.mockResolvedValueOnce({ Items: [leaderboardRow("cmaenner", 16)] }).mockResolvedValueOnce({ Items: [] });

    const [entry] = (await dynamoSource.getLeaderboard()).entries;

    expect(entry.apps.vampi?.total).toBe(9);
    expect(entry.apps.dvwa?.total).toBe(55);
    // Apps absent from the catalogue keep their static count rather than 0.
    const webgoat = apps.find((a) => a.id === "webgoat")!;
    expect(entry.apps.webgoat?.total).toBe(webgoat.challengeCount);
  });
});

describe("getUser", () => {
  it("returns null when the login has neither a row nor solves", async () => {
    mocks.send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Items: [] });

    expect(await dynamoSource.getUser("nobody")).toBeNull();
  });

  it("builds a profile from the row plus the author's solves", async () => {
    mocks.send
      .mockResolvedValueOnce({ Item: leaderboardRow("cmaenner", 16, "2026-07-27T23:07:34.432Z") })
      .mockResolvedValueOnce({ Items: [solveRow("vampi", "2026-07-27T23:07:34.432Z")] });

    const profile = await dynamoSource.getUser("cmaenner");

    expect(profile).toMatchObject({
      login: "cmaenner",
      points: 16,
      patched: 1,
      failed: 0,
      total: STATIC_TOTAL,
      maxPoints: 0,
      team: null,
      updatedAt: "2026-07-27T23:07:34.432Z",
    });
    expect(profile!.apps).toHaveLength(apps.length);
  });

  it("still renders an author whose solves exist but whose total is missing", async () => {
    mocks.send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: [solveRow("vampi", "2026-07-27T23:07:34.432Z")] });

    const profile = await dynamoSource.getUser("cmaenner");

    expect(profile).toMatchObject({ points: 0, patched: 1 });
    // No leaderboard row => updatedAt falls back to the latest solve.
    expect(profile!.updatedAt).toBe("2026-07-27T23:07:34.432Z");
  });
});
