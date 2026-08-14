import "server-only";
import { cookies } from "next/headers";
import { upstashEval, upstashPipeline } from "@/lib/upstash";
import { DATA_BACKEND } from "@/lib/dynamo";
import {
  dynamoCreateTeam,
  dynamoGetUserTeamSlug,
  dynamoGetViewerTeam,
  dynamoJoinTeam,
  dynamoLeaveTeam,
  dynamoListTeams,
  mirrorTeamOp,
} from "@/lib/dynamo-team-store";

const MOCK_TEAM_COOKIE = "ctf-mock-team";

/**
 * Gate for real Upstash team writes. When TEAM_WRITES_ENABLED=true, team
 * actions write to Upstash (UPSTASH_REDIS_REST_TOKEN must be a read/write
 * token) under the v2 schema:
 *   HSET ctf:team:<slug> name <name> captain <login> createdAt <iso>
 *   SADD ctf:team:<slug>:members <login>     (capped at TEAM_MAX_MEMBERS)
 *   HSET ctf:user:<login> team <slug>
 * When unset, actions persist to a per-browser httpOnly cookie instead, so
 * join/leave stays demoable against the mock leaderboard with zero backend.
 *
 * When writes are enabled, CTF_DATA_BACKEND (see lib/dynamo.ts) picks the store:
 * "dual" (default) keeps the Upstash Lua verdict authoritative and mirrors every
 * success into DynamoDB best-effort; "dynamo" replaces both writes and reads with
 * the DynamoDB store; "upstash" is Upstash only.
 *
 * Callers (the /api/team route handlers) are responsible for authenticating
 * the session and deriving `login` server-side — nothing here trusts
 * client-supplied identity.
 */
export const TEAM_WRITES_ENABLED = process.env.TEAM_WRITES_ENABLED === "true";

export const TEAM_MAX_MEMBERS = 4;
const NAME_MAX_LENGTH = 32;

export type TeamActionResult = { ok: true; team: string | null } | { ok: false; error: string };

export type TeamInfo = {
  slug: string;
  name: string;
  members: string[];
};

const userKey = (login: string) => `ctf:user:${login}`;
const teamKey = (slug: string) => `ctf:team:${slug}`;
const membersKey = (slug: string) => `ctf:team:${slug}:members`;

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
}

// Each mutation is a single Lua EVAL so every check-and-write is atomic —
// two players racing for a team's last slot can't both get in.
const CREATE_SCRIPT = `
if redis.call('HEXISTS', KEYS[1], 'team') == 1 then return 'already-on-team' end
if redis.call('EXISTS', KEYS[2]) == 1 then return 'name-taken' end
redis.call('HSET', KEYS[2], 'name', ARGV[2], 'captain', ARGV[1], 'createdAt', ARGV[4])
redis.call('SADD', KEYS[3], ARGV[1])
redis.call('HSET', KEYS[1], 'team', ARGV[3])
return 'ok'`;

const JOIN_SCRIPT = `
if redis.call('HEXISTS', KEYS[1], 'team') == 1 then return 'already-on-team' end
if redis.call('EXISTS', KEYS[2]) == 0 then return 'not-found' end
if redis.call('SCARD', KEYS[3]) >= tonumber(ARGV[2]) then return 'full' end
redis.call('SADD', KEYS[3], ARGV[1])
redis.call('HSET', KEYS[1], 'team', ARGV[3])
return 'ok'`;

const LEAVE_SCRIPT = `
if redis.call('HGET', KEYS[1], 'team') ~= ARGV[2] then return 'stale' end
redis.call('SREM', KEYS[3], ARGV[1])
redis.call('HDEL', KEYS[1], 'team')
if redis.call('SCARD', KEYS[3]) == 0 then redis.call('DEL', KEYS[2], KEYS[3]) end
return 'ok'`;

async function setMockTeam(slug: string): Promise<TeamActionResult> {
  const store = await cookies();
  store.set(MOCK_TEAM_COOKIE, slug, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return { ok: true, team: slug };
}

async function getUserTeamSlug(login: string): Promise<string | null> {
  if (DATA_BACKEND === "dynamo") return dynamoGetUserTeamSlug(login);
  const [current] = await upstashPipeline([["HGET", userKey(login), "team"]]);
  return typeof current.result === "string" && current.result ? current.result : null;
}

export async function createTeam(login: string, name: string): Promise<TeamActionResult> {
  const trimmed = name.trim();
  const slug = slugify(trimmed);
  if (!slug) return { ok: false, error: "Team name is required" };
  if (trimmed.length > NAME_MAX_LENGTH) {
    return { ok: false, error: `Team name must be ${NAME_MAX_LENGTH} characters or fewer` };
  }
  if (!TEAM_WRITES_ENABLED) return setMockTeam(slug);
  const createdAt = new Date().toISOString();

  if (DATA_BACKEND === "dynamo") {
    const verdict = await dynamoCreateTeam(login, slug, trimmed, createdAt);
    if (verdict === "already-on-team") return { ok: false, error: "Leave your current team before creating one" };
    if (verdict === "name-taken") return { ok: false, error: `Team "${slug}" already exists. Join it instead` };
    if (verdict !== "ok") return { ok: false, error: "Team update failed. Try again" };
    return { ok: true, team: slug };
  }

  const verdict = await upstashEval(
    CREATE_SCRIPT,
    [userKey(login), teamKey(slug), membersKey(slug)],
    [login, trimmed, slug, createdAt],
  );
  if (verdict === "already-on-team") return { ok: false, error: "Leave your current team before creating one" };
  if (verdict === "name-taken") return { ok: false, error: `Team "${slug}" already exists. Join it instead` };
  if (DATA_BACKEND === "dual") await mirrorTeamOp("team:create", () => dynamoCreateTeam(login, slug, trimmed, createdAt));
  return { ok: true, team: slug };
}

export async function joinTeam(login: string, slugInput: string): Promise<TeamActionResult> {
  const slug = slugify(slugInput);
  if (!slug) return { ok: false, error: "Team is required" };
  if (!TEAM_WRITES_ENABLED) return setMockTeam(slug);

  const verdict =
    DATA_BACKEND === "dynamo"
      ? await dynamoJoinTeam(login, slug, TEAM_MAX_MEMBERS)
      : await upstashEval(
          JOIN_SCRIPT,
          [userKey(login), teamKey(slug), membersKey(slug)],
          [login, TEAM_MAX_MEMBERS, slug],
        );
  if (verdict === "already-on-team") return { ok: false, error: "Leave your current team before joining another" };
  if (verdict === "not-found") return { ok: false, error: `No team "${slug}". Check the slug or create it` };
  if (verdict === "full") return { ok: false, error: `Team "${slug}" is full (${TEAM_MAX_MEMBERS} players max)` };
  if (verdict !== "ok") return { ok: false, error: "Team update failed. Try again" };
  if (DATA_BACKEND === "dual") await mirrorTeamOp("team:join", () => dynamoJoinTeam(login, slug, TEAM_MAX_MEMBERS));
  return { ok: true, team: slug };
}

export async function leaveTeam(login: string): Promise<TeamActionResult> {
  if (!TEAM_WRITES_ENABLED) {
    const store = await cookies();
    store.delete(MOCK_TEAM_COOKIE);
    return { ok: true, team: null };
  }

  const slug = await getUserTeamSlug(login);
  if (!slug) return { ok: true, team: null };

  if (DATA_BACKEND === "dynamo") {
    const verdict = await dynamoLeaveTeam(login, slug);
    if (verdict === "error") return { ok: false, error: "Team update failed. Try again" };
    // 'stale' means the membership changed under us — already left, idempotent.
    return { ok: true, team: null };
  }

  // A 'stale' verdict means the membership changed between the read and the
  // script — leaving is idempotent, so treat it as already left.
  await upstashEval(LEAVE_SCRIPT, [userKey(login), teamKey(slug), membersKey(slug)], [login, slug]);
  if (DATA_BACKEND === "dual") await mirrorTeamOp("team:leave", () => dynamoLeaveTeam(login, slug));
  return { ok: true, team: null };
}

/** Every team with its members, for the public standings. Live mode only —
 *  the cookie mock is per-browser and has no cross-player view, so this
 *  returns [] when writes are disabled. */
export async function listTeams(): Promise<TeamInfo[]> {
  if (!TEAM_WRITES_ENABLED) return [];
  if (DATA_BACKEND === "dynamo") return dynamoListTeams();

  const prefix = "ctf:team:";
  const suffix = ":members";
  const slugs: string[] = [];
  let cursor = "0";
  do {
    const [scan] = await upstashPipeline([["SCAN", cursor, "MATCH", `${prefix}*${suffix}`, "COUNT", "1000"]]);
    const [next, keys] = Array.isArray(scan.result) ? (scan.result as [string, string[]]) : ["0", []];
    cursor = next;
    for (const key of keys) slugs.push(key.slice(prefix.length, -suffix.length));
  } while (cursor !== "0");
  if (slugs.length === 0) return [];

  const results = await upstashPipeline(
    slugs.flatMap((slug) => [
      ["HGET", teamKey(slug), "name"],
      ["SMEMBERS", membersKey(slug)],
    ]),
  );
  return slugs.map((slug, i) => {
    const nameRes = results[i * 2]?.result;
    const membersRes = results[i * 2 + 1]?.result;
    return {
      slug,
      name: typeof nameRes === "string" && nameRes ? nameRes : slug,
      members: Array.isArray(membersRes) ? [...(membersRes as string[])].sort() : [],
    };
  });
}

/** The viewer's team as shown on the profile: live Upstash membership when
 *  writes are enabled, otherwise the per-browser mock cookie. */
export async function getViewerTeam(login: string): Promise<TeamInfo | null> {
  if (!TEAM_WRITES_ENABLED) {
    const store = await cookies();
    const slug = store.get(MOCK_TEAM_COOKIE)?.value ?? null;
    return slug ? { slug, name: slug, members: [login] } : null;
  }
  if (DATA_BACKEND === "dynamo") return dynamoGetViewerTeam(login);

  const slug = await getUserTeamSlug(login);
  if (!slug) return null;
  const [nameRes, membersRes] = await upstashPipeline([
    ["HGET", teamKey(slug), "name"],
    ["SMEMBERS", membersKey(slug)],
  ]);
  const name = typeof nameRes.result === "string" && nameRes.result ? nameRes.result : slug;
  const members = Array.isArray(membersRes.result) ? ([...(membersRes.result as string[])].sort()) : [];
  return { slug, name, members };
}
