// Unit tests for the aggregate country counter. The two things that matter:
// the item written is a bare tally with nothing identifying on it, and a
// country code that isn't ISO-3166 alpha-2 never reaches the sort key.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn<(command: { input: Record<string, unknown> }) => Promise<unknown>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dynamo", () => ({
  CTF_DYNAMO_TABLE: "ctf-leaderboard",
  DATA_BACKEND: "dual",
  getDynamoClient: () => ({ send: mocks.send }),
}));

import { normalizeCountry, recordCountryVisit } from "@/lib/dynamo-stats";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeCountry", () => {
  it("accepts ISO-3166 alpha-2, case- and whitespace-insensitively", () => {
    expect(normalizeCountry("US")).toBe("US");
    expect(normalizeCountry("gb")).toBe("GB");
    expect(normalizeCountry("  de  ")).toBe("DE");
  });

  it("rejects everything else", () => {
    for (const bad of [null, undefined, "", "U", "USA", "12", "U$", "US;DROP", "COUNTRY#US", "*"]) {
      expect(normalizeCountry(bad)).toBeNull();
    }
  });
});

describe("recordCountryVisit", () => {
  it("increments the country tally and writes nothing else", async () => {
    mocks.send.mockResolvedValueOnce({});
    await recordCountryVisit("us");

    const input = mocks.send.mock.calls[0][0].input;
    expect(input).toMatchObject({
      TableName: "ctf-leaderboard",
      Key: { pk: { S: "STATS" }, sk: { S: "COUNTRY#US" } },
      UpdateExpression: "ADD #count :one",
      ExpressionAttributeValues: { ":one": { N: "1" } },
    });

    // The privacy page promises this item holds a count and nothing else.
    // Any new attribute here — a login, an IP, even a timestamp — makes that
    // page wrong, so the write is pinned to exactly the counter.
    expect(Object.keys(input.Key as object).sort()).toEqual(["pk", "sk"]);
    expect(input.UpdateExpression).toBe("ADD #count :one");
    expect(Object.keys(input.ExpressionAttributeValues as object)).toEqual([":one"]);
    expect(JSON.stringify(input)).not.toMatch(/login|ip|user|session|agent|time|ttl/i);
  });

  it("writes nothing at all for an unusable country code", async () => {
    await recordCountryVisit("not-a-country");
    await recordCountryVisit("");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("swallows transport errors — analytics must never break a request", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.send.mockRejectedValueOnce(new Error("dynamo down"));
    await expect(recordCountryVisit("FR")).resolves.toBeUndefined();
    // and the log line carries no personal data, only the aggregate code
    expect(consoleError.mock.calls[0][0]).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    consoleError.mockRestore();
  });
});
