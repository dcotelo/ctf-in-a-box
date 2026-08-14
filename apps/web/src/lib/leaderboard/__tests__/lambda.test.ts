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
