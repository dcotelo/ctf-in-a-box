import "server-only";
import { upstashEval, upstashPipeline } from "@/lib/upstash";
import { ADMIN_AUDIT_KEY, AUDIT_CAP } from "@/lib/admin-store";
import { LOGIN_RE } from "@/lib/admin-admins";
import { sumAttempts } from "@/lib/attempt-row";
import {
  HINTS_SPENT_KEY,
  joinCodeKey,
  membersKey,
  teamKey,
  userHintTimesKey,
  userHintsKey,
  userKey,
} from "@/lib/team-keys";
import {
  QUIZ_ANSWERED_KEY,
  QUIZ_POINTS_KEY,
  quizAnswersKey,
  quizAttemptsKey,
} from "@/lib/quiz-keys";
import {
  CLASSIC_SOLVECOUNT_KEY,
  CLASSIC_SOLVED_KEY,
  CLASSIC_POINTS_KEY,
  classicAttemptsKey,
  classicSolvesKey,
} from "@/lib/classic-keys";

/**
 * Per-contestant and per-team support operations for a LIVE event (issue #168).
 *
 * Before this, the only destructive lever an organizer had was the master
 * reset, which wipes the whole event. So the answer to "one person is wedged,
 * mid-event" was either *do nothing* or *wipe everyone*. Everything here is
 * the missing middle: act on one contestant, or one team, without touching
 * anybody else.
 *
 * Every function takes `actor` and writes an audit line naming BOTH the actor
 * and the target. Support actions are precisely the ones that have to be
 * explicable afterwards — "who deleted that team, and when" is a question that
 * gets asked after an event, not during it.
 *
 * Callers gate on `requireAdmin`. Nothing here re-checks authorization: these
 * are the privileged primitives, and giving them a second, weaker opinion
 * about who may call them is how the two checks drift apart.
 */

export class OpsValidationError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "OpsValidationError";
    this.field = field;
  }
}

/** Team slugs are produced by `slugify` in team-store: lowercase alphanumerics
 *  and single hyphens, 40 chars max. Validated here because these keys are
 *  built by interpolation, and an unvalidated slug is how a `*` reaches a
 *  pattern or a `:` invents a key namespace. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,39}$/;

function requireLogin(login: string): string {
  const normalized = login.trim().toLowerCase();
  if (!LOGIN_RE.test(normalized)) {
    throw new OpsValidationError("login", `'${login}' is not a GitHub login`);
  }
  return normalized;
}

function requireSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!SLUG_RE.test(normalized)) {
    throw new OpsValidationError("slug", `'${slug}' is not a team slug`);
  }
  return normalized;
}

async function audit(action: string, actor: string, detail: Record<string, unknown>): Promise<void> {
  const line = JSON.stringify({ at: new Date().toISOString(), by: actor, action, ...detail });
  await upstashPipeline([
    ["LPUSH", ADMIN_AUDIT_KEY, line],
    ["LTRIM", ADMIN_AUDIT_KEY, 0, AUDIT_CAP - 1],
  ]);
}

// --- read -------------------------------------------------------------------

export type UserDetail = {
  login: string;
  /** null when this login is on no team. `joinedAt` is when they joined THIS
   *  team, and is null for a record written before the field existed. */
  team: { slug: string; name: string; captain: string | null; isCaptain: boolean; joinedAt: string | null } | null;
  /** First time this login was ever on a team — the funnel's conversion moment
   *  (issue #169). Survives leaving, being removed, and their team being
   *  disbanded; null for a contestant who converted before the field existed. */
  firstTeamAt: string | null;
  quiz: { answered: number; points: number; attempts: number };
  classic: { solved: number; points: number; attempts: number };
  /** Secure Development solves, counted from `ctf:solves:<target>`. */
  secureDev: { solves: number };
  hints: { bought: number; spent: number };
  /** True when no key anywhere mentions this login — almost always a typo
   *  rather than a contestant with nothing yet, and worth saying so plainly
   *  instead of rendering a page of zeroes. */
  known: boolean;
};

function hashLen(result: unknown): number {
  // Upstash returns a hash as a flat [field, value, field, value, ...] array.
  return Array.isArray(result) ? Math.floor(result.length / 2) : 0;
}

/** SCAN every `ctf:solves:<target>` hash and count fields belonging to
 *  `login`. Fields are `<login>:<challengeId>`; a login cannot contain `:`
 *  (LOGIN_RE), so the prefix match is exact. */
async function countSecureDevSolves(login: string): Promise<number> {
  let cursor = "0";
  let total = 0;
  const prefix = `${login}:`;
  do {
    const [scan] = await upstashPipeline([
      ["SCAN", cursor, "MATCH", "ctf:solves:*", "COUNT", 1000],
    ]);
    const [next, keys] = (scan.result as [string, string[]]) ?? ["0", []];
    cursor = next;
    if (keys.length) {
      const replies = await upstashPipeline(keys.map((k) => ["HKEYS", k]));
      for (const reply of replies) {
        const fields = Array.isArray(reply.result) ? (reply.result as string[]) : [];
        total += fields.filter((f) => f.startsWith(prefix)).length;
      }
    }
  } while (cursor !== "0");
  return total;
}

/**
 * Everything the organizer needs to see about one contestant before deciding
 * what to do to them. Read-only, and the first thing a support flow needs —
 * there was previously no way to look at a single contestant at all.
 */
export async function lookupUser(rawLogin: string): Promise<UserDetail> {
  const login = requireLogin(rawLogin);

  const [teamRes, quizAnswers, quizAttempts, quizPoints, quizAnswered, classicSolves, classicAttempts, classicPoints, classicSolved, hintsBought, hintsSpent] =
    await upstashPipeline([
      ["HMGET", userKey(login), "team", "joinedAt", "firstTeamAt"],
      ["HGETALL", quizAnswersKey(login)],
      ["HGETALL", quizAttemptsKey(login)],
      ["HGET", QUIZ_POINTS_KEY, login],
      ["HGET", QUIZ_ANSWERED_KEY, login],
      ["HGETALL", classicSolvesKey(login)],
      ["HGETALL", classicAttemptsKey(login)],
      ["HGET", CLASSIC_POINTS_KEY, login],
      ["HGET", CLASSIC_SOLVED_KEY, login],
      ["SCARD", userHintsKey(login)],
      ["HGET", HINTS_SPENT_KEY, login],
    ]);

  const [rawSlug, rawJoinedAt, rawFirstTeamAt] = Array.isArray(teamRes.result)
    ? (teamRes.result as (string | null)[])
    : [];
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const slug = str(rawSlug);
  const firstTeamAt = str(rawFirstTeamAt);
  let team: UserDetail["team"] = null;
  if (slug) {
    const [nameRes, captainRes] = await upstashPipeline([
      ["HGET", teamKey(slug), "name"],
      ["HGET", teamKey(slug), "captain"],
    ]);
    const captain = typeof captainRes.result === "string" ? captainRes.result : null;
    team = {
      slug,
      name: typeof nameRes.result === "string" && nameRes.result ? nameRes.result : slug,
      captain,
      isCaptain: captain?.toLowerCase() === login,
      joinedAt: str(rawJoinedAt),
    };
  }

  const secureDevSolves = await countSecureDevSolves(login);
  const quizAnsweredCount = hashLen(quizAnswers.result);
  const classicSolvedCount = hashLen(classicSolves.result);
  const hintsBoughtCount = Number(hintsBought.result) || 0;

  return {
    login,
    team,
    firstTeamAt,
    quiz: {
      answered: Number(quizAnswered.result) || quizAnsweredCount,
      points: Number(quizPoints.result) || 0,
      attempts: sumAttempts(quizAttempts.result),
    },
    classic: {
      solved: Number(classicSolved.result) || classicSolvedCount,
      points: Number(classicPoints.result) || 0,
      attempts: sumAttempts(classicAttempts.result),
    },
    secureDev: { solves: secureDevSolves },
    hints: { bought: hintsBoughtCount, spent: Number(hintsSpent.result) || 0 },
    known:
      slug !== null ||
      firstTeamAt !== null ||
      quizAnsweredCount > 0 ||
      classicSolvedCount > 0 ||
      secureDevSolves > 0 ||
      hintsBoughtCount > 0,
  };
}

// --- progress reset ---------------------------------------------------------

export type ResetScope = {
  /** Fields removed, per area. */
  cleared: Record<string, number>;
  /** Things the operator must know that the operation itself cannot fix. */
  warnings: string[];
};

/** Deletes every `ctf:solves:<target>` field belonging to `login`. Returns how
 *  many went. Separate from the pipeline below because it has to SCAN first. */
async function clearSecureDevSolves(login: string): Promise<number> {
  let cursor = "0";
  let removed = 0;
  const prefix = `${login}:`;
  do {
    const [scan] = await upstashPipeline([
      ["SCAN", cursor, "MATCH", "ctf:solves:*", "COUNT", 1000],
    ]);
    const [next, keys] = (scan.result as [string, string[]]) ?? ["0", []];
    cursor = next;
    for (const key of keys) {
      const [reply] = await upstashPipeline([["HKEYS", key]]);
      const fields = (Array.isArray(reply.result) ? (reply.result as string[]) : []).filter((f) =>
        f.startsWith(prefix),
      );
      if (fields.length) {
        await upstashPipeline([["HDEL", key, ...fields]]);
        removed += fields.length;
      }
    }
  } while (cursor !== "0");
  return removed;
}

/**
 * Clears one contestant's progress, leaving the account and team membership
 * alone. The "they got into a state nobody can reproduce, put them back to
 * zero" lever.
 *
 * ABOUT SECURE DEVELOPMENT. Its solves ARE deleted here, because a reset that
 * silently skipped a third of someone's score would be worse than one that
 * warns. But they can come back: `scorer/src/store.js` writes them with
 * HSETNX specifically so replays no-op, and the sync poller re-submits from
 * the PR comments it reads. So the next time that contestant's PR is scored —
 * a push, or a re-run of the workflow — the same solves are written again.
 *
 * `resetEvent` has the same problem and solves it globally by freezing scoring
 * and bumping the `resetAt` epoch, which makes sync drop its cursor. There is
 * no per-login equivalent, so this returns a WARNING instead of pretending.
 * The organizer's move is to close the contestant's PR, or freeze scoring
 * first. Quiz and classic have no such issue: those writes originate in the
 * app, so a delete is final.
 */
export async function resetUserProgress(rawLogin: string, actor: string): Promise<ResetScope> {
  const login = requireLogin(rawLogin);
  const secureDev = await clearSecureDevSolves(login);

  // MIND WHAT EACH AGGREGATE IS KEYED BY — they are not alike, and treating
  // them alike is a silent corruption.
  //
  //   ctf:quiz:points      HINCRBY <login>       per LOGIN
  //   ctf:quiz:answered    HINCRBY <login>       per LOGIN
  //   ctf:classic:points   HINCRBY <login>       per LOGIN
  //   ctf:classic:solved   HINCRBY <login>       per LOGIN
  //   ctf:classic:solvecount HINCRBY <challengeId>  per CHALLENGE  <-- !
  //
  // `solvecount` answers "how many people solved challenge X", so there is no
  // field for this login to delete. HDELing it by login would remove nothing
  // and leave every challenge still counting a contestant whose solves are
  // gone — the per-challenge stats would drift up, permanently, once per
  // reset. It has to be DECREMENTED, once per challenge this login had
  // solved, which means reading the solve rows before deleting them.
  const [solvedRes] = await upstashPipeline([["HKEYS", classicSolvesKey(login)]]);
  const solvedIds = Array.isArray(solvedRes.result) ? (solvedRes.result as string[]) : [];

  const replies = await upstashPipeline([
    ["DEL", quizAnswersKey(login)],
    ["DEL", quizAttemptsKey(login)],
    ["HDEL", QUIZ_POINTS_KEY, login],
    ["HDEL", QUIZ_ANSWERED_KEY, login],
    ["DEL", classicSolvesKey(login)],
    ["DEL", classicAttemptsKey(login)],
    ["HDEL", CLASSIC_POINTS_KEY, login],
    ["HDEL", CLASSIC_SOLVED_KEY, login],
    ["DEL", userHintsKey(login)],
    ["DEL", userHintTimesKey(login)],
    ["HDEL", HINTS_SPENT_KEY, login],
    ...solvedIds.map((id) => ["HINCRBY", CLASSIC_SOLVECOUNT_KEY, id, -1]),
  ]);
  const n = (i: number) => Number(replies[i]?.result) || 0;

  const cleared = {
    quizAnswers: n(0),
    quizAttempts: n(1),
    quizAggregates: n(2) + n(3),
    classicSolves: n(4),
    classicAttempts: n(5),
    classicAggregates: n(6) + n(7),
    classicSolveCountsDecremented: solvedIds.length,
    hints: n(8) + n(9) + n(10),
    secureDevSolves: secureDev,
  };

  const warnings: string[] = [];
  if (secureDev > 0) {
    warnings.push(
      "Secure Development solves are re-ingested from PR comments: the scorer writes them with HSETNX and the poller re-submits, so these return if this contestant's PR is scored again. Close the PR or freeze scoring to make it stick.",
    );
  }

  await audit("ops:user-reset", actor, { login, cleared });
  return { cleared, warnings };
}

// --- delete -----------------------------------------------------------------

/**
 * Removes a contestant entirely: their progress, their hints, their team
 * membership and their account record. For a "delete my data" request as much
 * as for support.
 *
 * Leaving the team is done through the SAME atomic script shape team-store
 * uses, not a bare SREM, because a member set and the `ctf:user:<login>` hash
 * that points at it must not be able to disagree. A captain is a deliberate
 * refusal here — see `forceTransferCaptain`.
 */
export async function deleteUser(
  rawLogin: string,
  actor: string,
): Promise<{ cleared: Record<string, number>; warnings: string[]; leftTeam: string | null }> {
  const login = requireLogin(rawLogin);

  const detail = await lookupUser(login);
  if (detail.team?.isCaptain) {
    throw new OpsValidationError(
      "login",
      `${login} is captain of "${detail.team.name}". Transfer the captaincy or disband the team first.`,
    );
  }

  const reset = await resetUserProgress(login, actor);

  const leftTeam = detail.team?.slug ?? null;
  const cmds: (string | number)[][] = [];
  if (leftTeam) cmds.push(["SREM", membersKey(leftTeam), login]);
  cmds.push(["DEL", userKey(login)]);
  await upstashPipeline(cmds);

  await audit("ops:user-delete", actor, { login, leftTeam });
  return { cleared: reset.cleared, warnings: reset.warnings, leftTeam };
}

// --- team operations --------------------------------------------------------

// Captain-guarded actions in team-store check `HGET captain == caller` INSIDE
// the script. The admin overrides deliberately do NOT take a caller into the
// guard — an organizer is allowed to act on a team they are not on. What the
// scripts still do is check the team EXISTS and that the target is a member,
// in the same atomic step as the write, so an admin override cannot be the one
// path that races with a contestant clicking Leave.

// KEYS: [1]=team [2]=members [3]=user  ARGV: [1]=login [2]=slug
const FORCE_REMOVE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 'no-team' end
if redis.call('HGET', KEYS[1], 'captain') == ARGV[1] then return 'is-captain' end
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 0 then return 'not-member' end
redis.call('SREM', KEYS[2], ARGV[1])
if redis.call('HGET', KEYS[3], 'team') == ARGV[2] then redis.call('HDEL', KEYS[3], 'team', 'joinedAt') end
return 'ok'`;

/** Removes a member from a team without needing the captain to do it — the
 *  captain-only path is blocked exactly when the captain is unreachable, which
 *  is when support is needed. Refuses the captain: removing them would leave a
 *  team nobody can administer. */
export async function forceRemoveFromTeam(
  rawSlug: string,
  rawLogin: string,
  actor: string,
): Promise<{ ok: true } | never> {
  const slug = requireSlug(rawSlug);
  const login = requireLogin(rawLogin);
  const verdict = await upstashEval(
    FORCE_REMOVE_SCRIPT,
    [teamKey(slug), membersKey(slug), userKey(login)],
    [login, slug],
  );
  if (verdict === "no-team") throw new OpsValidationError("slug", `No team "${slug}"`);
  if (verdict === "is-captain") {
    throw new OpsValidationError("login", `${login} is the captain — transfer the captaincy first`);
  }
  if (verdict === "not-member") {
    throw new OpsValidationError("login", `${login} is not on "${slug}"`);
  }
  await audit("ops:team-remove-member", actor, { slug, login });
  return { ok: true };
}

// KEYS: [1]=team [2]=members  ARGV: [1]=newCaptain
const FORCE_TRANSFER_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 'no-team' end
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 0 then return 'not-member' end
redis.call('HSET', KEYS[1], 'captain', ARGV[1])
return 'ok'`;

/**
 * Hands a team to a new captain without the old one's consent.
 *
 * The most likely live-event ticket, because a captainless team is stuck
 * completely: it cannot rename, remove a member, regenerate its code, or
 * disband — every one of those paths is captain-only. The new captain must
 * already be a member, so this cannot conjure a team for an outsider.
 */
export async function forceTransferCaptain(
  rawSlug: string,
  rawLogin: string,
  actor: string,
): Promise<{ ok: true } | never> {
  const slug = requireSlug(rawSlug);
  const login = requireLogin(rawLogin);
  const verdict = await upstashEval(
    FORCE_TRANSFER_SCRIPT,
    [teamKey(slug), membersKey(slug)],
    [login],
  );
  if (verdict === "no-team") throw new OpsValidationError("slug", `No team "${slug}"`);
  if (verdict === "not-member") {
    throw new OpsValidationError("login", `${login} is not on "${slug}" — add them first`);
  }
  await audit("ops:team-transfer-captain", actor, { slug, login });
  return { ok: true };
}

/**
 * Disbands a team: clears every member's `team` pointer, drops the member set,
 * the team hash and its join code.
 *
 * Progress is NOT touched — solves and answers are per login, so a disbanded
 * team's players keep everything they earned and can regroup. Deleting their
 * work because their team was wrong would turn an admin convenience into a
 * scoring incident.
 */
export async function forceDisbandTeam(
  rawSlug: string,
  actor: string,
): Promise<{ ok: true; members: number } | never> {
  const slug = requireSlug(rawSlug);
  const [existsRes, membersRes, codeRes] = await upstashPipeline([
    ["EXISTS", teamKey(slug)],
    ["SMEMBERS", membersKey(slug)],
    ["HGET", teamKey(slug), "joinCode"],
  ]);
  if (Number(existsRes.result) !== 1) throw new OpsValidationError("slug", `No team "${slug}"`);

  const members = Array.isArray(membersRes.result) ? (membersRes.result as string[]) : [];
  const code = typeof codeRes.result === "string" && codeRes.result ? codeRes.result : null;

  // `joinedAt` describes the CURRENT membership, so it goes with it.
  // `firstTeamAt` deliberately survives — it records that this contestant
  // once converted, which stays true after their team is disbanded.
  const cmds: (string | number)[][] = members.map((m) => ["HDEL", userKey(m), "team", "joinedAt"]);
  cmds.push(["DEL", membersKey(slug)]);
  cmds.push(["DEL", teamKey(slug)]);
  // The reverse index must go too, or the code keeps resolving to a team that
  // no longer exists and `/join/<code>` shows a card for a ghost.
  if (code) cmds.push(["DEL", joinCodeKey(code.toLowerCase())]);
  await upstashPipeline(cmds);

  await audit("ops:team-disband", actor, { slug, members: members.length });
  return { ok: true, members: members.length };
}
