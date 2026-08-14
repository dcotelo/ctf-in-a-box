import "server-only";
import {
  ConditionalCheckFailedException,
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  TransactionCanceledException,
  UpdateItemCommand,
  type CancellationReason,
} from "@aws-sdk/client-dynamodb";
import { CTF_DYNAMO_TABLE, getDynamoClient } from "@/lib/dynamo";
import { PROFILE_SK, TEAMS_PK, getS, getSS, teamItem, teamSk, userPk, type DynamoItem } from "@/lib/dynamo-shapes";
import type { TeamInfo } from "@/lib/team-store";

/**
 * DynamoDB half of the team store. Each Lua guard from team-store.ts maps to a
 * TransactWriteItems of exactly two conditional entries, so every check-and-write
 * stays atomic — two players racing for a team's last slot still can't both get in.
 * Verdicts are classified from TransactionCanceledException.CancellationReasons
 * (index-aligned with the entries; ReturnValuesOnConditionCheckFailure gives the
 * old item so no follow-up read is needed).
 */

export type DynamoTeamVerdict = "ok" | "already-on-team" | "name-taken" | "not-found" | "full" | "stale" | "error";

const failed = (reason: CancellationReason | undefined) => reason?.Code === "ConditionalCheckFailed";

/** The shared second transaction entry: point USER#<login>/PROFILE at a team,
 *  guarded so a user already on a team can't sneak onto a second one. */
function setProfileTeam(login: string, slug: string, now: string) {
  return {
    Update: {
      TableName: CTF_DYNAMO_TABLE,
      Key: { pk: { S: userPk(login) }, sk: { S: PROFILE_SK } },
      UpdateExpression: "SET #login = :login, #team = :team, #updatedAt = :now",
      ConditionExpression: "attribute_not_exists(#team)",
      ExpressionAttributeNames: { "#login": "login", "#team": "team", "#updatedAt": "updatedAt" },
      ExpressionAttributeValues: { ":login": { S: login }, ":team": { S: slug }, ":now": { S: now } },
      ReturnValuesOnConditionCheckFailure: "ALL_OLD" as const,
    },
  };
}

export async function dynamoCreateTeam(login: string, slug: string, name: string, createdAt: string): Promise<DynamoTeamVerdict> {
  try {
    await getDynamoClient().send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Put: {
              TableName: CTF_DYNAMO_TABLE,
              Item: teamItem({ slug, name, captain: login, createdAt, members: [login] }),
              ConditionExpression: "attribute_not_exists(pk)",
              ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            },
          },
          setProfileTeam(login, slug, createdAt),
        ],
      }),
    );
    return "ok";
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      const [teamReason, userReason] = err.CancellationReasons ?? [];
      // Same guard order as the Lua script: the user's own state wins.
      if (failed(userReason)) return "already-on-team";
      if (failed(teamReason)) return "name-taken";
    }
    console.error(`[dynamo] createTeam failed: ${(err as Error).message}`);
    return "error";
  }
}

export async function dynamoJoinTeam(login: string, slug: string, maxMembers: number): Promise<DynamoTeamVerdict> {
  try {
    await getDynamoClient().send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Update: {
              TableName: CTF_DYNAMO_TABLE,
              Key: { pk: { S: TEAMS_PK }, sk: { S: teamSk(slug) } },
              UpdateExpression: "ADD #members :member",
              ConditionExpression: "attribute_exists(pk) AND size(#members) < :max AND NOT contains(#members, :login)",
              ExpressionAttributeNames: { "#members": "members" },
              ExpressionAttributeValues: {
                ":member": { SS: [login] },
                ":login": { S: login },
                ":max": { N: String(maxMembers) },
              },
              ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            },
          },
          setProfileTeam(login, slug, new Date().toISOString()),
        ],
      }),
    );
    return "ok";
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      const [teamReason, userReason] = err.CancellationReasons ?? [];
      if (failed(userReason)) return "already-on-team";
      if (failed(teamReason)) {
        // The returned old item tells apart which clause of the guard failed.
        const members = getSS(teamReason?.Item, "members");
        if (!teamReason?.Item) return "not-found";
        if (members.includes(login)) return "already-on-team";
        if (members.length >= maxMembers) return "full";
      }
    }
    console.error(`[dynamo] joinTeam failed: ${(err as Error).message}`);
    return "error";
  }
}

/** Clear the profile's team pointer, guarded against a stale slug. Standalone
 *  because "team item already gone" still needs the profile cleaned up. */
async function clearProfileTeam(login: string, slug: string): Promise<"ok" | "stale"> {
  try {
    await getDynamoClient().send(
      new UpdateItemCommand({
        TableName: CTF_DYNAMO_TABLE,
        Key: { pk: { S: userPk(login) }, sk: { S: PROFILE_SK } },
        UpdateExpression: "REMOVE #team SET #updatedAt = :now",
        ConditionExpression: "#team = :slug",
        ExpressionAttributeNames: { "#team": "team", "#updatedAt": "updatedAt" },
        ExpressionAttributeValues: { ":slug": { S: slug }, ":now": { S: new Date().toISOString() } },
      }),
    );
    return "ok";
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return "stale";
    throw err;
  }
}

/**
 * Leaving reads the team first to pick a branch, then lets conditions catch any
 * race: sole member → delete the team with the profile update (the members set
 * must never go empty — DynamoDB would drop the attribute and break the join
 * guard); otherwise remove the member, conditioned on NOT being the last one.
 * A team-entry condition failure means the membership changed under us — re-read
 * once and take the other branch.
 */
export async function dynamoLeaveTeam(login: string, slug: string, attempt = 0): Promise<DynamoTeamVerdict> {
  try {
    const team = await getDynamoClient().send(
      new GetItemCommand({ TableName: CTF_DYNAMO_TABLE, Key: { pk: { S: TEAMS_PK }, sk: { S: teamSk(slug) } } }),
    );
    const members = getSS(team.Item, "members");

    if (!team.Item || !members.includes(login)) {
      // Team gone or membership drifted — just clean up the profile pointer.
      return clearProfileTeam(login, slug);
    }

    const profileEntry = {
      Update: {
        TableName: CTF_DYNAMO_TABLE,
        Key: { pk: { S: userPk(login) }, sk: { S: PROFILE_SK } },
        UpdateExpression: "REMOVE #team SET #updatedAt = :now",
        ConditionExpression: "#team = :slug",
        ExpressionAttributeNames: { "#team": "team", "#updatedAt": "updatedAt" },
        ExpressionAttributeValues: { ":slug": { S: slug }, ":now": { S: new Date().toISOString() } },
      },
    };

    const teamEntry =
      members.length === 1
        ? {
            Delete: {
              TableName: CTF_DYNAMO_TABLE,
              Key: { pk: { S: TEAMS_PK }, sk: { S: teamSk(slug) } },
              // Someone joined since the read → cancel and retry as a removal.
              ConditionExpression: "#members = :only",
              ExpressionAttributeNames: { "#members": "members" },
              ExpressionAttributeValues: { ":only": { SS: [login] } },
            },
          }
        : {
            Update: {
              TableName: CTF_DYNAMO_TABLE,
              Key: { pk: { S: TEAMS_PK }, sk: { S: teamSk(slug) } },
              UpdateExpression: "DELETE #members :member",
              // size > 1 keeps the never-empty invariant: if everyone else left
              // since the read, cancel and retry as a sole-member delete.
              ConditionExpression: "attribute_exists(pk) AND contains(#members, :login) AND size(#members) > :one",
              ExpressionAttributeNames: { "#members": "members" },
              ExpressionAttributeValues: { ":member": { SS: [login] }, ":login": { S: login }, ":one": { N: "1" } },
            },
          };

    await getDynamoClient().send(new TransactWriteItemsCommand({ TransactItems: [teamEntry, profileEntry] }));
    return "ok";
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      const [teamReason, userReason] = err.CancellationReasons ?? [];
      if (failed(userReason)) return "stale";
      if (failed(teamReason) && attempt === 0) return dynamoLeaveTeam(login, slug, 1);
    }
    console.error(`[dynamo] leaveTeam failed: ${(err as Error).message}`);
    return "error";
  }
}

export async function dynamoGetUserTeamSlug(login: string): Promise<string | null> {
  const res = await getDynamoClient().send(
    new GetItemCommand({
      TableName: CTF_DYNAMO_TABLE,
      Key: { pk: { S: userPk(login) }, sk: { S: PROFILE_SK } },
      ProjectionExpression: "#team",
      ExpressionAttributeNames: { "#team": "team" },
    }),
  );
  return getS(res.Item, "team");
}

export async function dynamoGetViewerTeam(login: string): Promise<TeamInfo | null> {
  const slug = await dynamoGetUserTeamSlug(login);
  if (!slug) return null;
  const res = await getDynamoClient().send(
    new GetItemCommand({ TableName: CTF_DYNAMO_TABLE, Key: { pk: { S: TEAMS_PK }, sk: { S: teamSk(slug) } } }),
  );
  if (!res.Item) return null;
  return toTeamInfo(slug, res.Item);
}

/** Every team with its members — a single-partition Query, no Scan (the IAM
 *  policy doesn't grant it, and one partition is all the webapp owns). */
export async function dynamoListTeams(): Promise<TeamInfo[]> {
  const teams: TeamInfo[] = [];
  let cursor: DynamoItem | undefined;
  do {
    const page = await getDynamoClient().send(
      new QueryCommand({
        TableName: CTF_DYNAMO_TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": { S: TEAMS_PK } },
        ExclusiveStartKey: cursor,
      }),
    );
    for (const item of page.Items ?? []) {
      const slug = getS(item, "slug") ?? getS(item, "sk")?.replace(/^TEAM#/, "");
      if (slug) teams.push(toTeamInfo(slug, item));
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return teams;
}

function toTeamInfo(slug: string, item: DynamoItem): TeamInfo {
  return {
    slug,
    name: getS(item, "name") ?? slug,
    members: getSS(item, "members").sort(),
  };
}

/**
 * Dual-mode wrapper: runs the same conditional mutation the dynamo backend uses,
 * after Upstash (the authority) already said "ok". Best-effort by contract — it
 * never throws and never blocks the response; anything but an "ok" verdict is a
 * drift signal to investigate before cutting CTF_DATA_BACKEND over to "dynamo".
 */
export async function mirrorTeamOp(op: string, run: () => Promise<DynamoTeamVerdict>): Promise<void> {
  try {
    const verdict = await run();
    if (verdict === "ok") console.log(`[dynamo-mirror] ${op} ok`);
    else console.warn(`[dynamo-mirror] ${op} verdict mismatch: upstash=ok dynamo=${verdict}`);
  } catch (err) {
    console.error(`[dynamo-mirror] ${op} failed: ${(err as Error).message}`);
  }
}
