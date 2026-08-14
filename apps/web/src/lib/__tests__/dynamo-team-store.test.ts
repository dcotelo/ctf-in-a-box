// Unit tests for the DynamoDB team store — the same membership rules the Lua
// scripts enforce, but as conditional transactions: one team per player, the
// 4-player cap, name uniqueness, and the never-empty members invariant on
// leave. The client is mocked at getDynamoClient; live behavior is covered by
// the optional dynamo-store.dynamo.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
  type AttributeValue,
  type CancellationReason,
} from "@aws-sdk/client-dynamodb";

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
  dynamoCreateTeam,
  dynamoGetUserTeamSlug,
  dynamoGetViewerTeam,
  dynamoJoinTeam,
  dynamoLeaveTeam,
  dynamoListTeams,
  mirrorTeamOp,
} from "@/lib/dynamo-team-store";

function canceled(reasons: (CancellationReason | { failed: true; item?: Record<string, AttributeValue> })[]) {
  return new TransactionCanceledException({
    message: "Transaction cancelled",
    $metadata: {},
    CancellationReasons: reasons.map((r) =>
      "failed" in r ? { Code: "ConditionalCheckFailed", Item: r.item } : { Code: "None", ...r },
    ),
  });
}

const NOT_FAILED = {};

/** The most recent TransactWriteItems input sent to the client. */
function lastTransactInput(): { TransactItems: Record<string, Record<string, unknown>>[] } {
  const call = mocks.send.mock.calls.findLast(([cmd]) => "TransactItems" in cmd.input);
  return call![0].input as ReturnType<typeof lastTransactInput>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dynamoCreateTeam", () => {
  it("puts the team (with the creator as sole member) and points the profile at it", async () => {
    mocks.send.mockResolvedValueOnce({});
    expect(await dynamoCreateTeam("octocat", "red-team", "Red Team", "2026-07-20T00:00:00Z")).toBe("ok");
    const [teamEntry, userEntry] = lastTransactInput().TransactItems;
    expect(teamEntry.Put).toMatchObject({
      Item: {
        pk: { S: "TEAMS" },
        sk: { S: "TEAM#red-team" },
        name: { S: "Red Team" },
        captain: { S: "octocat" },
        members: { SS: ["octocat"] },
      },
      ConditionExpression: "attribute_not_exists(pk)",
    });
    expect(userEntry.Update).toMatchObject({
      Key: { pk: { S: "USER#octocat" }, sk: { S: "PROFILE" } },
      ConditionExpression: "attribute_not_exists(#team)",
    });
  });

  it("maps a taken slug to name-taken", async () => {
    mocks.send.mockRejectedValueOnce(canceled([{ failed: true }, NOT_FAILED]));
    expect(await dynamoCreateTeam("octocat", "red-team", "Red Team", "now")).toBe("name-taken");
  });

  it("prefers already-on-team when both guards fail (same order as the Lua script)", async () => {
    mocks.send.mockRejectedValueOnce(canceled([{ failed: true }, { failed: true }]));
    expect(await dynamoCreateTeam("octocat", "red-team", "Red Team", "now")).toBe("already-on-team");
  });

  it("returns error (not a throw) on an unexpected failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.send.mockRejectedValueOnce(new Error("dynamo down"));
    expect(await dynamoCreateTeam("octocat", "red-team", "Red Team", "now")).toBe("error");
    consoleError.mockRestore();
  });
});

describe("dynamoJoinTeam", () => {
  it("adds the member atomically, guarded by existence, the cap, and no-dup in ONE condition", async () => {
    mocks.send.mockResolvedValueOnce({});
    expect(await dynamoJoinTeam("octocat", "red-team", 4)).toBe("ok");
    const [teamEntry] = lastTransactInput().TransactItems;
    expect(teamEntry.Update).toMatchObject({
      Key: { pk: { S: "TEAMS" }, sk: { S: "TEAM#red-team" } },
      UpdateExpression: "ADD #members :member",
      ConditionExpression: "attribute_exists(pk) AND size(#members) < :max AND NOT contains(#members, :login)",
      ExpressionAttributeValues: { ":member": { SS: ["octocat"] }, ":login": { S: "octocat" }, ":max": { N: "4" } },
    });
  });

  it("classifies a missing team as not-found", async () => {
    mocks.send.mockRejectedValueOnce(canceled([{ failed: true }, NOT_FAILED]));
    expect(await dynamoJoinTeam("octocat", "ghost-team", 4)).toBe("not-found");
  });

  it("classifies a full team from the returned old item", async () => {
    mocks.send.mockRejectedValueOnce(
      canceled([{ failed: true, item: { members: { SS: ["a", "b", "c", "d"] } } }, NOT_FAILED]),
    );
    expect(await dynamoJoinTeam("octocat", "red-team", 4)).toBe("full");
  });

  it("classifies rejoining the same team as already-on-team", async () => {
    mocks.send.mockRejectedValueOnce(
      canceled([{ failed: true, item: { members: { SS: ["octocat", "zed"] } } }, NOT_FAILED]),
    );
    expect(await dynamoJoinTeam("octocat", "red-team", 4)).toBe("already-on-team");
  });

  it("rejects joining a second team via the profile guard", async () => {
    mocks.send.mockRejectedValueOnce(canceled([NOT_FAILED, { failed: true }]));
    expect(await dynamoJoinTeam("octocat", "blue-team", 4)).toBe("already-on-team");
  });
});

describe("dynamoLeaveTeam", () => {
  it("deletes the team with the profile update when the last member leaves", async () => {
    mocks.send
      .mockResolvedValueOnce({ Item: { members: { SS: ["octocat"] } } }) // GetItem
      .mockResolvedValueOnce({}); // Transact
    expect(await dynamoLeaveTeam("octocat", "red-team")).toBe("ok");
    const [teamEntry, userEntry] = lastTransactInput().TransactItems;
    expect(teamEntry.Delete).toMatchObject({
      Key: { pk: { S: "TEAMS" }, sk: { S: "TEAM#red-team" } },
      ConditionExpression: "#members = :only",
    });
    expect(userEntry.Update).toMatchObject({ ConditionExpression: "#team = :slug" });
  });

  it("removes the member (never emptying the set) when others remain", async () => {
    mocks.send.mockResolvedValueOnce({ Item: { members: { SS: ["octocat", "zed"] } } }).mockResolvedValueOnce({});
    expect(await dynamoLeaveTeam("octocat", "red-team")).toBe("ok");
    const [teamEntry] = lastTransactInput().TransactItems;
    expect(teamEntry.Update).toMatchObject({
      UpdateExpression: "DELETE #members :member",
      ConditionExpression: "attribute_exists(pk) AND contains(#members, :login) AND size(#members) > :one",
    });
  });

  it("re-reads and retries once when the membership changed under it", async () => {
    mocks.send
      .mockResolvedValueOnce({ Item: { members: { SS: ["octocat", "zed"] } } }) // read: two members
      .mockRejectedValueOnce(canceled([{ failed: true }, NOT_FAILED])) // zed left mid-flight
      .mockResolvedValueOnce({ Item: { members: { SS: ["octocat"] } } }) // re-read: now sole
      .mockResolvedValueOnce({}); // sole-member delete succeeds
    expect(await dynamoLeaveTeam("octocat", "red-team")).toBe("ok");
    expect(mocks.send).toHaveBeenCalledTimes(4);
  });

  it("treats a stale profile slug as already left", async () => {
    mocks.send
      .mockResolvedValueOnce({ Item: { members: { SS: ["octocat", "zed"] } } })
      .mockRejectedValueOnce(canceled([NOT_FAILED, { failed: true }]));
    expect(await dynamoLeaveTeam("octocat", "red-team")).toBe("stale");
  });

  it("cleans up the profile when the team item is already gone", async () => {
    mocks.send
      .mockResolvedValueOnce({}) // GetItem: no team item
      .mockResolvedValueOnce({}); // standalone profile clear
    expect(await dynamoLeaveTeam("octocat", "red-team")).toBe("ok");
    const [, [clearCmd]] = mocks.send.mock.calls;
    expect(clearCmd.input).toMatchObject({
      Key: { pk: { S: "USER#octocat" }, sk: { S: "PROFILE" } },
      ConditionExpression: "#team = :slug",
    });
  });

  it("maps a stale standalone profile clear to stale", async () => {
    mocks.send
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new ConditionalCheckFailedException({ message: "no", $metadata: {} }));
    expect(await dynamoLeaveTeam("octocat", "red-team")).toBe("stale");
  });
});

describe("reads", () => {
  it("getUserTeamSlug reads the profile's team pointer", async () => {
    mocks.send.mockResolvedValueOnce({ Item: { team: { S: "red-team" } } });
    expect(await dynamoGetUserTeamSlug("octocat")).toBe("red-team");
    mocks.send.mockResolvedValueOnce({});
    expect(await dynamoGetUserTeamSlug("octocat")).toBeNull();
  });

  it("getViewerTeam resolves slug, display name, and sorted members", async () => {
    mocks.send
      .mockResolvedValueOnce({ Item: { team: { S: "red-team" } } })
      .mockResolvedValueOnce({ Item: { name: { S: "Red Team" }, members: { SS: ["zed", "abe"] } } });
    expect(await dynamoGetViewerTeam("octocat")).toEqual({
      slug: "red-team",
      name: "Red Team",
      members: ["abe", "zed"],
    });
  });

  it("listTeams walks Query pages of the single TEAMS partition (no Scan)", async () => {
    mocks.send
      .mockResolvedValueOnce({
        Items: [{ slug: { S: "red" }, name: { S: "Red Team" }, members: { SS: ["zed", "abe"] } }],
        LastEvaluatedKey: { pk: { S: "TEAMS" }, sk: { S: "TEAM#red" } },
      })
      .mockResolvedValueOnce({
        Items: [{ sk: { S: "TEAM#blue" }, members: { SS: ["solo"] } }],
      });
    expect(await dynamoListTeams()).toEqual([
      { slug: "red", name: "Red Team", members: ["abe", "zed"] },
      { slug: "blue", name: "blue", members: ["solo"] }, // slug + name fall back
    ]);
    const [[first], [second]] = mocks.send.mock.calls;
    expect(first.input).toMatchObject({ KeyConditionExpression: "pk = :pk" });
    expect(second.input).toMatchObject({ ExclusiveStartKey: { sk: { S: "TEAM#red" } } });
  });
});

describe("mirrorTeamOp", () => {
  it("never throws — a rejected mirror is logged, not surfaced", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(mirrorTeamOp("team:create", () => Promise.reject(new Error("boom")))).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("logs a drift warning when DynamoDB disagrees with the Upstash verdict", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await mirrorTeamOp("team:join", () => Promise.resolve("full" as const));
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining("upstash=ok dynamo=full"));
    consoleWarn.mockRestore();
  });
});
