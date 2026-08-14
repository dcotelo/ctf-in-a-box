// Unit tests for the challenges-gate throttle. Three things matter here: the
// lock math (5 attempts, 24h window, an expired window starts over), that the
// budget is charged through CONDITIONAL writes rather than a read-then-write,
// and that a concurrent burst cannot buy more than the budget allows. The
// client is mocked at getDynamoClient.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConditionalCheckFailedException, type AttributeValue } from "@aws-sdk/client-dynamodb";

const mocks = vi.hoisted(() => ({
  send: vi.fn<(command: { input: Record<string, unknown> }) => Promise<unknown>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dynamo", () => ({
  CTF_DYNAMO_TABLE: "ctf-leaderboard",
  DATA_BACKEND: "dual",
  getDynamoClient: () => ({ send: mocks.send }),
}));

import {
  GATE_LOCK_MS,
  GATE_MAX_FAILURES,
  GATE_TTL_MS,
  clearGateThrottle,
  consumeGateAttempt,
  gateLockRemainingSeconds,
  gateTtlSeconds,
  getGateThrottle,
} from "@/lib/dynamo-gate-store";

const NOW = 1_800_000_000_000;
// 30 days at NOW, in epoch SECONDS. Hard-coded rather than derived from the
// constants so that changing either the window or the unit fails this suite
// instead of silently agreeing with itself.
const EXPECTED_TTL = "1802592000";
const IP = "203.0.113.9";

/** The SDK's real exception type — `instanceof` is what the store branches on,
 *  so a hand-rolled Error would take the rethrow path and pass nothing. */
function conditionFailed(item?: Record<string, AttributeValue>) {
  return new ConditionalCheckFailedException({
    message: "The conditional request failed",
    $metadata: {},
    Item: item,
  });
}

function throttleItem(failures: number, lastFailAt: number) {
  return { failures: { N: String(failures) }, lastFailAt: { N: String(lastFailAt) } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getGateThrottle", () => {
  it("reads the IP's throttle item consistently", async () => {
    mocks.send.mockResolvedValueOnce({ Item: throttleItem(3, NOW) });
    expect(await getGateThrottle(IP)).toEqual({ failures: 3, lastFailAt: NOW });
    expect(mocks.send.mock.calls[0][0].input).toMatchObject({
      Key: { pk: { S: "GATE" }, sk: { S: `IP#${IP}` } },
      // An eventually-consistent read can return a stale counter, which is a
      // throttle an attacker can outrun. This is the SDK's non-default.
      ConsistentRead: true,
    });
  });

  it("returns null for an unseen IP and throws on transport errors (caller fails closed)", async () => {
    mocks.send.mockResolvedValueOnce({});
    expect(await getGateThrottle(IP)).toBeNull();
    mocks.send.mockRejectedValueOnce(new Error("dynamo down"));
    await expect(getGateThrottle(IP)).rejects.toThrow("dynamo down");
  });
});

describe("gateLockRemainingSeconds", () => {
  it("locks only at the failure cap", () => {
    expect(gateLockRemainingSeconds(null, NOW)).toBe(0);
    expect(gateLockRemainingSeconds({ failures: GATE_MAX_FAILURES - 1, lastFailAt: NOW }, NOW)).toBe(0);
    expect(gateLockRemainingSeconds({ failures: GATE_MAX_FAILURES, lastFailAt: NOW }, NOW)).toBe(GATE_LOCK_MS / 1000);
  });

  it("lifts after the 24h window passes", () => {
    const stale = { failures: GATE_MAX_FAILURES, lastFailAt: NOW - GATE_LOCK_MS };
    expect(gateLockRemainingSeconds(stale, NOW)).toBe(0);
    const nearlyOver = { failures: GATE_MAX_FAILURES, lastFailAt: NOW - GATE_LOCK_MS + 1000 };
    expect(gateLockRemainingSeconds(nearlyOver, NOW)).toBe(1);
  });
});

describe("gateTtlSeconds", () => {
  it("is 30 days out, in epoch seconds", () => {
    expect(gateTtlSeconds(NOW)).toBe(Number(EXPECTED_TTL));
    // Guards the unit: an epoch-millis TTL would be ~1000x larger and DynamoDB
    // would treat the item as expired ~57000 years hence, i.e. never reaped.
    expect(gateTtlSeconds(NOW)).toBeLessThan(NOW);
    expect(GATE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("is strictly longer than the lock window, so a lock can never outlive its item", () => {
    expect(GATE_TTL_MS).toBeGreaterThan(GATE_LOCK_MS);
  });
});

describe("consumeGateAttempt", () => {
  it("starts a fresh counter for an unseen IP, guarded and retention-bounded", async () => {
    mocks.send.mockResolvedValueOnce({});
    expect(await consumeGateAttempt(IP, NOW)).toEqual({ allowed: true });

    const input = mocks.send.mock.calls[0][0].input;
    expect(input).toMatchObject({
      Item: {
        pk: { S: "GATE" },
        sk: { S: `IP#${IP}` },
        failures: { N: "1" },
        lastFailAt: { N: String(NOW) },
        ttl: { N: EXPECTED_TTL },
      },
      ConditionExpression: "attribute_not_exists(pk) OR #lastFailAt <= :windowStart",
      ExpressionAttributeValues: { ":windowStart": { N: String(NOW - GATE_LOCK_MS) } },
    });
    // An unconditional Put is the original defect: a concurrent burst would
    // each write a literal failures:1 and collapse the counter to 1 no matter
    // how wide the burst.
    expect(input.ConditionExpression).toBeTruthy();
  });

  it("puts the restart boundary exactly one lock window behind now", async () => {
    // Whether an expired item restarts is DynamoDB's decision, not ours — it
    // turns on this one number. Asserting it against a literal rather than
    // against `NOW - GATE_LOCK_MS` means an off-by-one or a unit slip in the
    // boundary fails here instead of agreeing with the implementation.
    mocks.send.mockResolvedValueOnce({});
    await consumeGateAttempt(IP, NOW);
    const input = mocks.send.mock.calls[0][0].input as {
      ConditionExpression: string;
      ExpressionAttributeValues: Record<string, { N: string }>;
    };
    expect(input.ExpressionAttributeValues[":windowStart"].N).toBe("1799913600000");
    expect(Number(input.ExpressionAttributeValues[":windowStart"].N)).toBe(NOW - GATE_LOCK_MS);
    // `<=`, not `<`: an item at exactly the boundary is expired.
    expect(input.ConditionExpression).toContain("#lastFailAt <= :windowStart");
  });

  it("increments inside a live window, guarded by the cap", async () => {
    mocks.send
      .mockRejectedValueOnce(conditionFailed(throttleItem(2, NOW - 60_000))) // Put: window is live
      .mockResolvedValueOnce({}); // Update: budget remained

    expect(await consumeGateAttempt(IP, NOW)).toEqual({ allowed: true });

    const input = mocks.send.mock.calls[1][0].input;
    expect(input).toMatchObject({
      Key: { pk: { S: "GATE" }, sk: { S: `IP#${IP}` } },
      UpdateExpression: "ADD #failures :one SET #lastFailAt = :now, #ttl = :ttl",
      ConditionExpression: "attribute_not_exists(#failures) OR #failures < :max",
      ExpressionAttributeValues: {
        ":one": { N: "1" },
        ":now": { N: String(NOW) },
        ":ttl": { N: EXPECTED_TTL },
        ":max": { N: String(GATE_MAX_FAILURES) },
      },
    });
    // `ttl` is a DynamoDB reserved word, so it must go through an expression
    // attribute name — a literal `ttl` in the UpdateExpression is a 400.
    expect(input.ExpressionAttributeNames).toMatchObject({ "#ttl": "ttl" });
    // `#ttl` (name) and `:ttl` (value) are fine; a bare `ttl` is not.
    expect(input.UpdateExpression).not.toMatch(/(?<![#:])\bttl\b/);
  });

  it("refuses without a second write when the returned item already shows the cap", async () => {
    mocks.send.mockRejectedValueOnce(conditionFailed(throttleItem(GATE_MAX_FAILURES, NOW)));
    expect(await consumeGateAttempt(IP, NOW)).toEqual({
      allowed: false,
      retryAfterSeconds: GATE_LOCK_MS / 1000,
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("refuses when the cap guard trips, and never reports Retry-After: 0", async () => {
    // Both writes rejected: the window is live and the budget is gone. The
    // second failure carries an item whose lock has, per the clock, just
    // lapsed — the clamp must still produce a positive Retry-After.
    mocks.send
      .mockRejectedValueOnce(conditionFailed(throttleItem(GATE_MAX_FAILURES - 1, NOW - 60_000)))
      .mockRejectedValueOnce(conditionFailed(throttleItem(GATE_MAX_FAILURES, NOW - GATE_LOCK_MS)));

    const verdict = await consumeGateAttempt(IP, NOW);
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("falls back to a consistent read when the condition failure carries no item", async () => {
    mocks.send
      .mockRejectedValueOnce(conditionFailed()) // Put failed, no ALL_OLD payload
      .mockResolvedValueOnce({ Item: throttleItem(GATE_MAX_FAILURES, NOW) }); // the fallback Get

    expect(await consumeGateAttempt(IP, NOW)).toEqual({
      allowed: false,
      retryAfterSeconds: GATE_LOCK_MS / 1000,
    });
    expect(mocks.send.mock.calls[1][0].input).toMatchObject({ ConsistentRead: true });
  });

  it("repairs an item with lastFailAt but no failures instead of wedging on it", async () => {
    // Without `attribute_not_exists(#failures)` in the guard, the comparison
    // against a missing attribute is false forever and this IP 500s for good.
    mocks.send
      .mockRejectedValueOnce(conditionFailed({ lastFailAt: { N: String(NOW - 60_000) } }))
      .mockResolvedValueOnce({});
    expect(await consumeGateAttempt(IP, NOW)).toEqual({ allowed: true });
    expect(mocks.send.mock.calls[1][0].input.ConditionExpression).toContain(
      "attribute_not_exists(#failures)",
    );
  });

  it("rethrows transport errors so the caller fails closed", async () => {
    mocks.send.mockRejectedValueOnce(new Error("dynamo down"));
    await expect(consumeGateAttempt(IP, NOW)).rejects.toThrow("dynamo down");
  });

  // The finding this whole redesign exists for. A stateful fake enforces
  // DynamoDB's per-item conditional semantics; the assertion is on how many
  // callers were cleared to reach the password compare.
  it("caps a concurrent burst at the budget instead of letting all of it through", async () => {
    let item: { failures: number; lastFailAt: number } | null = null;

    mocks.send.mockImplementation(async (command) => {
      const input = command.input as Record<string, never>;
      const live = item !== null && item.lastFailAt > NOW - GATE_LOCK_MS;

      if ("Item" in input) {
        if (live) throw conditionFailed(item ? throttleItem(item.failures, item.lastFailAt) : undefined);
        item = { failures: 1, lastFailAt: NOW };
        return {};
      }
      if (item !== null && item.failures >= GATE_MAX_FAILURES) {
        throw conditionFailed(throttleItem(item.failures, item.lastFailAt));
      }
      item = { failures: (item?.failures ?? 0) + 1, lastFailAt: NOW };
      return {};
    });

    const verdicts = await Promise.all(
      Array.from({ length: 50 }, () => consumeGateAttempt(IP, NOW)),
    );

    const allowed = verdicts.filter((v) => v.allowed).length;
    expect(allowed).toBe(GATE_MAX_FAILURES);
    expect(verdicts).toHaveLength(50);
    expect(item).toEqual({ failures: GATE_MAX_FAILURES, lastFailAt: NOW });
  });
});

describe("clearGateThrottle", () => {
  it("deletes the throttle item", async () => {
    mocks.send.mockResolvedValueOnce({});
    expect(await clearGateThrottle(IP)).toBe(true);
    expect(mocks.send.mock.calls[0][0].input).toMatchObject({
      Key: { pk: { S: "GATE" }, sk: { S: `IP#${IP}` } },
    });
  });

  it("retries once, because a lost refund strands a caller at the cap", async () => {
    mocks.send.mockRejectedValueOnce(new Error("throttled")).mockResolvedValueOnce({});
    expect(await clearGateThrottle(IP)).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it("reports failure without throwing, so the unlock cookie still ships", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.send.mockRejectedValue(new Error("boom"));
    await expect(clearGateThrottle(IP)).resolves.toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});
