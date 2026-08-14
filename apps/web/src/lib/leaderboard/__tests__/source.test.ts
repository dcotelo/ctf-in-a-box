// LEADERBOARD_SOURCE resolution.
//
// The failure this guards against is a typo that costs nothing at boot and
// everything at the event: an unrecognised value falls back to "mock", so the
// board serves placeholder standings to real contestants.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The source modules reach for network clients at import time; none of that
// is exercised here, only which one gets picked.
vi.mock("@/lib/leaderboard/mock", () => ({ mockSource: { id: "mock" } }));
vi.mock("@/lib/leaderboard/lambda", () => ({ lambdaSource: { id: "lambda" } }));
vi.mock("@/lib/leaderboard/upstash", () => ({ upstashSource: { id: "upstash" } }));

/** Fresh module each time, so the warn-once Set does not leak between tests. */
async function loadWith(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) delete process.env.LEADERBOARD_SOURCE;
  else process.env.LEADERBOARD_SOURCE = value;
  return import("@/lib/leaderboard/source");
}

const original = process.env.LEADERBOARD_SOURCE;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  if (original === undefined) delete process.env.LEADERBOARD_SOURCE;
  else process.env.LEADERBOARD_SOURCE = original;
});

describe("getLeaderboardSourceMode", () => {
  it.each(["mock", "lambda", "upstash"])("passes %s through silently", async (value) => {
    const { getLeaderboardSourceMode } = await loadWith(value);
    expect(getLeaderboardSourceMode()).toBe(value);
    expect(warn).not.toHaveBeenCalled();
  });

  it("defaults to mock when unset, without warning", async () => {
    const { getLeaderboardSourceMode } = await loadWith(undefined);
    expect(getLeaderboardSourceMode()).toBe("mock");
    // Unset is the documented default, not a mistake — warning on it would
    // train people to ignore the message that matters.
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns and falls back to mock for an unrecognised value", async () => {
    const { getLeaderboardSourceMode } = await loadWith("dynamo");
    expect(getLeaderboardSourceMode()).toBe("mock");
    expect(warn).toHaveBeenCalledTimes(1);

    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain("dynamo");
    // The message has to carry the consequence and the remedy, or it is just
    // noise in a log nobody reads during an event.
    expect(message).toContain("placeholder data");
    expect(message).toContain("mock");
  });

  it.each(["DYNAMO", " dynamo", "postgres", "true"])(
    "warns for other unrecognised value %s",
    async (value) => {
      const { getLeaderboardSourceMode } = await loadWith(value);
      expect(getLeaderboardSourceMode()).toBe("mock");
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );

  it("warns once, not once per request", async () => {
    const { getLeaderboardSourceMode } = await loadWith("dynamodb");
    // Called on every leaderboard render; an un-deduped warn would flood logs.
    for (let i = 0; i < 25; i++) getLeaderboardSourceMode();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("getLeaderboardSource", () => {
  it.each([
    ["lambda", "lambda"],
    ["upstash", "upstash"],
    ["mock", "mock"],
    ["dynamo", "mock"],
  ])("resolves %s to the %s source", async (value, expected) => {
    const { getLeaderboardSource } = await loadWith(value);
    expect((getLeaderboardSource() as unknown as { id: string }).id).toBe(expected);
  });
});
