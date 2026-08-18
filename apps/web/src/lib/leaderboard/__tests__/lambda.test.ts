// Unit tests for the lambda source adapter: maps the deployed Lambda's real
// response shape (including the lastSolveAt tie-breaker) into the normalized
// LeaderboardEntry, and re-ranks instead of trusting the Lambda's rank field.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { lambdaSource } from "../lambda";

// Trimmed copy of the live response shape (two apps is enough).
const RESPONSE = {
  leaderboard: [
    {
      rank: 1,
      author: "dcotelo",
      points: 672,
      lastSolveAt: "2026-07-08T19:25:23.830Z",
      apps: {
        "juice-shop": { solved: 38, total: 38 },
        dvwa: { solved: 55, total: 55 },
      },
    },
    // Tied on points; the Lambda ordered the LATER solver first — the adapter
    // must flip them (earlier last solve wins the tie).
    {
      rank: 2,
      author: "later-solver",
      points: 145,
      lastSolveAt: "2026-07-14T20:16:12.661Z",
      apps: { "juice-shop": { solved: 38, total: 38 } },
    },
    {
      rank: 3,
      author: "earlier-solver",
      points: 145,
      lastSolveAt: "2026-07-14T19:42:27.026Z",
      apps: { "juice-shop": { solved: 38, total: 38 } },
    },
  ],
};

function stubFetch(payload: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload }) as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("lambdaSource.getLeaderboard", () => {
  it("captures lastSolveAt and uses it as the source's updatedAt", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "https://scorer.example");
    stubFetch(RESPONSE);
    const data = await lambdaSource.getLeaderboard();
    const top = data.entries[0];
    expect(top.login).toBe("dcotelo");
    expect(top.lastSolveAt).toBe("2026-07-08T19:25:23.830Z");
    // Solves are the only updates in this source, so last solve = last update.
    expect(top.updatedAt).toBe("2026-07-08T19:25:23.830Z");
  });

  it("re-ranks point ties by earlier lastSolveAt instead of trusting the Lambda's rank", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "https://scorer.example");
    stubFetch(RESPONSE);
    const data = await lambdaSource.getLeaderboard();
    expect(data.entries.map((e) => [e.login, e.rank])).toEqual([
      ["dcotelo", 1],
      ["earlier-solver", 2],
      ["later-solver", 3],
    ]);
  });

  it("tolerates entries without lastSolveAt (older Lambda payloads)", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "https://scorer.example");
    stubFetch({
      leaderboard: [{ rank: 1, author: "old", points: 10, apps: { dvwa: { solved: 1, total: 55 } } }],
    });
    const data = await lambdaSource.getLeaderboard();
    expect(data.entries[0]).toMatchObject({ login: "old", lastSolveAt: null, updatedAt: null, rank: 1 });
  });
});

describe("lambdaSource.getLeaderboard series", () => {
  it("maps the Lambda's series field through onto LeaderboardData.series", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "https://scorer.example");
    stubFetch({
      ...RESPONSE,
      series: [
        {
          login: "dcotelo",
          points: [
            { t: "2026-07-08T10:00:00.000Z", score: 100 },
            { t: "2026-07-08T19:25:23.830Z", score: 672 },
          ],
        },
      ],
    });
    const data = await lambdaSource.getLeaderboard();
    expect(data.series).toEqual([
      {
        login: "dcotelo",
        points: [
          { t: "2026-07-08T10:00:00.000Z", score: 100 },
          { t: "2026-07-08T19:25:23.830Z", score: 672 },
        ],
      },
    ]);
  });

  it("tolerates an older scorer that sends no series field at all", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "https://scorer.example");
    stubFetch(RESPONSE); // no `series` key
    const data = await lambdaSource.getLeaderboard();
    expect(data.series).toBeUndefined();
  });

  it("tolerates an empty series array (declarative-only deployment)", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "https://scorer.example");
    stubFetch({ ...RESPONSE, series: [] });
    const data = await lambdaSource.getLeaderboard();
    expect(data.series).toBeUndefined();
  });

  it("drops malformed players/points instead of throwing", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "https://scorer.example");
    stubFetch({
      ...RESPONSE,
      series: [
        { login: "ok", points: [{ t: "2026-07-08T10:00:00.000Z", score: 5 }, { t: 123, score: "nope" }] },
        { login: 42, points: [{ t: "2026-07-08T10:00:00.000Z", score: 5 }] },
        { login: "empty-after-filter", points: [{ t: 1, score: 2 }] },
        "not an object",
      ],
    });
    const data = await lambdaSource.getLeaderboard();
    expect(data.series).toEqual([{ login: "ok", points: [{ t: "2026-07-08T10:00:00.000Z", score: 5 }] }]);
  });
});

describe("lambdaSource.getLeaderboard teams", () => {
  it("maps the Lambda's teams + teamSeries fields and flips on the teams capability", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "https://scorer.example");
    stubFetch({
      ...RESPONSE,
      teams: [
        {
          rank: 1,
          slug: "red-team",
          name: "Red Team",
          captain: "dcotelo",
          members: ["dcotelo", "later-solver"],
          points: 817,
          lastSolveAt: "2026-07-14T20:16:12.661Z",
          apps: { "juice-shop": { solved: 38, total: 38 } },
        },
      ],
      teamSeries: [
        {
          slug: "red-team",
          name: "Red Team",
          points: [
            { t: "2026-07-08T10:00:00.000Z", score: 100 },
            { t: "2026-07-14T20:16:12.661Z", score: 817 },
          ],
        },
      ],
    });
    const data = await lambdaSource.getLeaderboard();
    expect(data.teams).toEqual([
      { rank: 1, slug: "red-team", name: "Red Team", captain: "dcotelo", members: ["dcotelo", "later-solver"], points: 817 },
    ]);
    expect(data.teamSeries).toEqual([
      {
        slug: "red-team",
        name: "Red Team",
        points: [
          { t: "2026-07-08T10:00:00.000Z", score: 100 },
          { t: "2026-07-14T20:16:12.661Z", score: 817 },
        ],
      },
    ]);
    expect(data.capabilities.teams).toBe(true);
  });

  it("tolerates a scorer with no teams field at all", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "https://scorer.example");
    stubFetch(RESPONSE); // no `teams`/`teamSeries` keys
    const data = await lambdaSource.getLeaderboard();
    expect(data.teams).toEqual([]);
    expect(data.teamSeries).toBeUndefined();
    expect(data.capabilities.teams).toBe(false);
  });

  it("tolerates an empty teams array", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "https://scorer.example");
    stubFetch({ ...RESPONSE, teams: [] });
    const data = await lambdaSource.getLeaderboard();
    expect(data.teams).toEqual([]);
    expect(data.capabilities.teams).toBe(false);
  });

  it("drops malformed team entries instead of throwing", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "https://scorer.example");
    stubFetch({
      ...RESPONSE,
      teams: [
        { rank: 1, slug: "ok-team", name: "Ok Team", captain: "dcotelo", members: ["dcotelo", 42], points: 100 },
        { rank: 2, slug: "missing-captain", name: "No Captain", members: ["x"], points: 50 },
        { rank: "3", slug: "bad-rank", name: "Bad Rank", captain: "x", members: [], points: 10 },
        { slug: "no-members", name: "No Members", captain: "x", points: 5, members: "nope" },
        "not an object",
        null,
      ],
    });
    const data = await lambdaSource.getLeaderboard();
    // Malformed entries dropped; the string member "42" is filtered out but
    // the valid entry still gets in with a non-empty members array.
    expect(data.teams).toEqual([
      { rank: 1, slug: "ok-team", name: "Ok Team", captain: "dcotelo", members: ["dcotelo"], points: 100 },
    ]);
    expect(data.capabilities.teams).toBe(true);
  });
});

describe("lambdaSource.getLeaderboard catalog (per-challenge)", () => {
  // A response carrying the newer `catalog` + `solvedIds` fields.
  const WITH_CATALOG = {
    leaderboard: [
      {
        rank: 1,
        author: "neo",
        points: 15,
        lastSolveAt: "2026-08-14T11:00:00.000Z",
        apps: { "juice-shop": { solved: 1, total: 2, solvedIds: ["xss"] } },
      },
    ],
    teams: [
      {
        rank: 1,
        slug: "zero-cool",
        name: "Zero Cool",
        captain: "neo",
        members: ["neo", "trin"],
        points: 15,
        apps: { "juice-shop": { solved: 2, total: 2, solvedIds: ["xss", "sqli"] } },
      },
    ],
    catalog: {
      "juice-shop": [
        { id: "xss", name: "Reflected XSS", points: 10, owasp: "A03" },
        { id: "sqli", name: "SQL injection", points: 5, owasp: null },
      ],
    },
  };

  it("joins catalog + solvedIds into per-challenge results and flips the challenges capability", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "https://scorer.example");
    stubFetch(WITH_CATALOG);
    const data = await lambdaSource.getLeaderboard();
    expect(data.capabilities.challenges).toBe(true);
    const app = data.entries[0].apps["juice-shop"]!;
    expect(app.challenges).toEqual([
      { key: "xss", name: "Reflected XSS", points: 10, owasp: "A03", status: "patched" },
      { key: "sqli", name: "SQL injection", points: 5, owasp: null, status: "open" },
    ]);
    // Points/max are derived from the catalogue for the solved subset.
    expect(app.points).toBe(10);
    expect(app.maxPoints).toBe(15);
  });

  it("builds the team's union of solved flags from its apps.solvedIds", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "https://scorer.example");
    stubFetch(WITH_CATALOG);
    const data = await lambdaSource.getLeaderboard();
    const teamApp = data.teams[0].apps?.["juice-shop"];
    expect(teamApp?.challenges?.every((c) => c.status === "patched")).toBe(true);
    expect(teamApp?.challenges?.map((c) => c.key)).toEqual(["xss", "sqli"]);
  });

  it("leaves the challenges capability off and attaches no challenges when there is no catalog", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "https://scorer.example");
    stubFetch(RESPONSE); // no catalog field
    const data = await lambdaSource.getLeaderboard();
    expect(data.capabilities.challenges).toBe(false);
    expect(data.entries[0].apps["juice-shop"]?.challenges).toBeUndefined();
    expect(data.teams[0]?.apps).toBeUndefined();
  });

  it("tolerates a malformed catalog rather than throwing", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "https://scorer.example");
    stubFetch({
      ...WITH_CATALOG,
      catalog: {
        "juice-shop": [
          { id: "ok", name: "Fine", points: 3, owasp: null },
          { id: 42, name: "bad id", points: 1 }, // dropped
          { name: "no id", points: 1 }, // dropped
          "nope", // dropped
        ],
        "bad-app": "not an array", // ignored
      },
    });
    const data = await lambdaSource.getLeaderboard();
    expect(data.capabilities.challenges).toBe(true);
    expect(data.entries[0].apps["juice-shop"]?.challenges?.map((c) => c.key)).toEqual(["ok"]);
  });
});
