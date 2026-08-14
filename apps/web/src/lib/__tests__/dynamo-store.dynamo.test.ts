// Integration tests: exercises the REAL conditional transactions against the
// live DynamoDB table, because that's where the one-team-per-player, 4-player
// cap, never-empty-members, and charge-once rules are actually enforced. Uses
// only run-unique throwaway keys under the webapp's partitions and deletes
// them before and after. Skips entirely when AWS credentials are not
// available (e.g. CI, or locally without `aws sso login` + AWS_PROFILE).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The SDK default chain needs an explicit pointer (profile or keys) — sniffing
// the chain itself would hang tests on machines with no AWS setup at all.
const configured = Boolean(process.env.AWS_PROFILE || process.env.AWS_ACCESS_KEY_ID);

const RUN = Date.now().toString(36);
const SLUG_A = `vt-${RUN}-alpha`;
const SLUG_B = `vt-${RUN}-beta`;
const PLAYERS = ["p1", "p2", "p3", "p4", "p5"].map((p) => `vt-${RUN}-${p}`);
const BUYER = `vt-${RUN}-buyer`;
const HINT_ID = `Challenge-${RUN}-Test`;

const LONG = 30_000;

describe.skipIf(!configured)("dynamo stores against the live table (throwaway keys)", () => {
  let teamStore: typeof import("@/lib/dynamo-team-store");
  let hintStore: typeof import("@/lib/dynamo-hint-store");
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    teamStore = await import("@/lib/dynamo-team-store");
    hintStore = await import("@/lib/dynamo-hint-store");
    const { getDynamoClient, CTF_DYNAMO_TABLE } = await import("@/lib/dynamo");
    const { DeleteItemCommand } = await import("@aws-sdk/client-dynamodb");
    const keys = [
      { pk: "TEAMS", sk: `TEAM#${SLUG_A}` },
      { pk: "TEAMS", sk: `TEAM#${SLUG_B}` },
      ...PLAYERS.map((p) => ({ pk: `USER#${p}`, sk: "PROFILE" })),
      { pk: `USER#${BUYER}`, sk: "PROFILE" },
      { pk: `USER#${BUYER}`, sk: `HINT#juice-shop#${HINT_ID}` },
      { pk: "HINTSPEND", sk: `AUTHOR#${BUYER}` },
    ];
    cleanup = async () => {
      for (const key of keys) {
        await getDynamoClient().send(
          new DeleteItemCommand({
            TableName: CTF_DYNAMO_TABLE,
            Key: { pk: { S: key.pk }, sk: { S: key.sk } },
          }),
        );
      }
    };
    await cleanup();
  }, LONG);

  afterAll(async () => {
    await cleanup();
  }, LONG);

  it("enforces one team per player and unique names atomically", { timeout: LONG }, async () => {
    const now = new Date().toISOString();
    expect(await teamStore.dynamoCreateTeam(PLAYERS[0], SLUG_A, "VT Alpha", now)).toBe("ok");
    expect(await teamStore.dynamoCreateTeam(PLAYERS[1], SLUG_A, "VT Alpha Again", now)).toBe("name-taken");
    expect(await teamStore.dynamoCreateTeam(PLAYERS[0], SLUG_B, "VT Beta", now)).toBe("already-on-team");
    expect(await teamStore.dynamoJoinTeam(PLAYERS[0], SLUG_A, 4)).toBe("already-on-team");
  });

  it("caps the team at 4 and rejects ghosts", { timeout: LONG }, async () => {
    expect(await teamStore.dynamoJoinTeam(PLAYERS[1], SLUG_A, 4)).toBe("ok");
    expect(await teamStore.dynamoJoinTeam(PLAYERS[2], SLUG_A, 4)).toBe("ok");
    expect(await teamStore.dynamoJoinTeam(PLAYERS[3], SLUG_A, 4)).toBe("ok");
    expect(await teamStore.dynamoJoinTeam(PLAYERS[4], SLUG_A, 4)).toBe("full");
    expect(await teamStore.dynamoJoinTeam(PLAYERS[4], `vt-${RUN}-ghost`, 4)).toBe("not-found");
  });

  it("reads the roster back", { timeout: LONG }, async () => {
    expect(await teamStore.dynamoGetUserTeamSlug(PLAYERS[1])).toBe(SLUG_A);
    const team = await teamStore.dynamoGetViewerTeam(PLAYERS[0]);
    expect(team?.name).toBe("VT Alpha");
    expect(team?.members).toEqual(PLAYERS.slice(0, 4).sort());
  });

  it("leaves cleanly and deletes the team with its last member", { timeout: LONG }, async () => {
    for (const player of PLAYERS.slice(0, 3)) {
      expect(await teamStore.dynamoLeaveTeam(player, SLUG_A)).toBe("ok");
    }
    // Sole member left — leaving must delete the team item entirely.
    expect(await teamStore.dynamoLeaveTeam(PLAYERS[3], SLUG_A)).toBe("ok");
    expect(await teamStore.dynamoGetViewerTeam(PLAYERS[3])).toBeNull();
    const slugs = (await teamStore.dynamoListTeams()).map((t) => t.slug);
    expect(slugs).not.toContain(SLUG_A);
  });

  it("charges a hint exactly once", { timeout: LONG }, async () => {
    expect(await hintStore.dynamoChargeHint(BUYER, "juice-shop", HINT_ID, 10)).toEqual({
      status: "charged",
      spent: 10,
    });
    expect(await hintStore.dynamoChargeHint(BUYER, "juice-shop", HINT_ID, 10)).toEqual({
      status: "owned",
      spent: 10,
    });
    expect((await hintStore.dynamoGetHintPenalties()).get(BUYER)).toBe(10);
    expect(await hintStore.dynamoGetViewerPurchases(BUYER)).toEqual({
      purchases: [{ app: "juice-shop", id: HINT_ID }],
      spent: 10,
    });
  });
});
