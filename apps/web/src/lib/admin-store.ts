import "server-only";
import { upstashEval, upstashPipeline } from "@/lib/upstash";
import { DEMO_CONTESTANTS, DEMO_TEAMS } from "@/lib/demo-fixture";

export const ADMIN_SETTINGS_KEY = "ctf:admin:settings";
export const ADMIN_AUDIT_KEY = "ctf:admin:audit";
export const SYNC_STATUS_KEY = "ctf:sync:status";
export const AUDIT_CAP = 500;
export const HINT_COST_MAX = 100000;
/** Caps for the two hint-gating knobs (see hint-store's `hintGate`). */
export const HINT_MIN_SOLVES_MAX = 1000;
export const HINT_UNLOCK_AFTER_MAX = 100000; // minutes
/** Caps for the two quiz retry-gate knobs (see quiz-store's `quizGate`). */
export const QUIZ_MAX_ATTEMPTS_MAX = 100;
export const QUIZ_RETRY_AFTER_MAX = 100000; // minutes

export type AdminSettings = {
  paused: boolean;
  hintsEnabled: boolean | null;
  hintCost: number | null;
  /** Solves a login needs ON THE TARGET before it may buy that target's
   *  hints — the anti-burner gate. Null = no override, use the default. */
  hintsMinSolves: number | null;
  /** Minutes after `scoringStartsAt` before any hint may be bought. Null =
   *  no override; 0 = no time phase. */
  hintsUnlockAfterMin: number | null;
  /** Attempts a login gets per quiz question before the retry gate refuses
   *  further submissions (see quiz-store's `quizGate`). Null = no override,
   *  use the default. 0 = unlimited attempts. */
  quizMaxAttempts: number | null;
  /** Minutes a login must wait after its last attempt before it may retry the
   *  same quiz question. Null = no override; 0 = no cooldown. */
  quizRetryAfterMin: number | null;
  teamRegistrationOpen: boolean;
  // Scheduled "auto dates" — nullable ISO instants. Absent = no bound.
  // scoring* gates the freeze (before start / after end = paused); registration*
  // gates team create/join. Enforced at READ time (no scheduler on the box):
  // see effectivePaused / effectiveRegistrationOpen, mirrored in the scorer
  // (store.js), sync poller (redis.js), and team-store.
  scoringStartsAt: string | null;
  scoringEndsAt: string | null;
  registrationStartsAt: string | null;
  registrationEndsAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

/** True when a scheduled window puts `now` outside [startsAt, endsAt].
 *  Unparseable/absent bounds are ignored (treated as no bound) so a bad
 *  value can never wedge scoring off. Kept identical in scorer/store.js and
 *  sync/redis.js — change all three together. */
export function outsideWindow(nowMs: number, startsAt: string | null, endsAt: string | null): boolean {
  const s = startsAt ? Date.parse(startsAt) : NaN;
  const e = endsAt ? Date.parse(endsAt) : NaN;
  if (Number.isFinite(s) && nowMs < s) return true;
  if (Number.isFinite(e) && nowMs > e) return true;
  return false;
}

/** Effective scoring freeze: the manual toggle OR the scheduled window. */
export function effectivePaused(s: AdminSettings, nowMs: number = Date.now()): boolean {
  return s.paused || outsideWindow(nowMs, s.scoringStartsAt, s.scoringEndsAt);
}

/** Effective registration state: the manual toggle AND inside the window. */
export function effectiveRegistrationOpen(s: AdminSettings, nowMs: number = Date.now()): boolean {
  return s.teamRegistrationOpen && !outsideWindow(nowMs, s.registrationStartsAt, s.registrationEndsAt);
}

export type SyncStatus = {
  lastPollAt: string | null;
  lastError: string | null;
  ingested: number;
  reposPolled: number;
  paused: boolean;
};

export type SettingsPatch = {
  paused?: boolean;
  hintsEnabled?: boolean;
  hintCost?: number;
  hintsMinSolves?: number;
  hintsUnlockAfterMin?: number;
  quizMaxAttempts?: number;
  quizRetryAfterMin?: number;
  teamRegistrationOpen?: boolean;
  // ISO instant to set the bound, or null/"" to clear it.
  scoringStartsAt?: string | null;
  scoringEndsAt?: string | null;
  registrationStartsAt?: string | null;
  registrationEndsAt?: string | null;
};

const SCHEDULE_FIELDS = ["scoringStartsAt", "scoringEndsAt", "registrationStartsAt", "registrationEndsAt"] as const;

export class AdminValidationError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "AdminValidationError";
    this.field = field;
  }
}

function flatToObject(flat: unknown): Record<string, string> {
  const arr = Array.isArray(flat) ? (flat as string[]) : [];
  const obj: Record<string, string> = {};
  for (let i = 0; i < arr.length; i += 2) obj[arr[i]] = arr[i + 1];
  return obj;
}

// `paused` is two-state on the wire — "1" or absent — so false and
// never-set are the same value. `hintsEnabled` is deliberately three-state
// ("1"/"0"/absent) since absent means "no override, use the env default".
// `teamRegistrationOpen` is two-state but inverted: absent means open (the
// default), and a stored "0" means registration is closed.
function decodeSettings(h: Record<string, string>): AdminSettings {
  return {
    paused: h.paused === "1",
    hintsEnabled: h.hintsEnabled === undefined ? null : h.hintsEnabled === "1",
    hintCost: h.hintCost === undefined ? null : Number(h.hintCost),
    hintsMinSolves: h.hintsMinSolves === undefined ? null : Number(h.hintsMinSolves),
    hintsUnlockAfterMin: h.hintsUnlockAfterMin === undefined ? null : Number(h.hintsUnlockAfterMin),
    quizMaxAttempts: h.quizMaxAttempts === undefined ? null : Number(h.quizMaxAttempts),
    quizRetryAfterMin: h.quizRetryAfterMin === undefined ? null : Number(h.quizRetryAfterMin),
    teamRegistrationOpen: h.teamRegistrationOpen !== "0",
    scoringStartsAt: h.scoringStartsAt ?? null,
    scoringEndsAt: h.scoringEndsAt ?? null,
    registrationStartsAt: h.registrationStartsAt ?? null,
    registrationEndsAt: h.registrationEndsAt ?? null,
    updatedBy: h.updatedBy ?? null,
    updatedAt: h.updatedAt ?? null,
  };
}

export async function getAdminSettings(): Promise<AdminSettings> {
  const [res] = await upstashPipeline([["HGETALL", ADMIN_SETTINGS_KEY]]);
  return decodeSettings(flatToObject(res.result));
}

export async function getSyncStatus(): Promise<SyncStatus | null> {
  const [res] = await upstashPipeline([["HGETALL", SYNC_STATUS_KEY]]);
  const h = flatToObject(res.result);
  if (Object.keys(h).length === 0) return null;
  return {
    lastPollAt: h.lastPollAt ?? null,
    lastError: h.lastError ?? null,
    ingested: Number(h.ingested ?? 0),
    reposPolled: Number(h.reposPolled ?? 0),
    paused: h.paused === "1",
  };
}

// HDEL the fields being cleared, HSET the changed fields + updatedBy/updatedAt,
// LPUSH one audit line, LTRIM the list — one atomic script so a change can
// never land without its audit record.
// ARGV: [1]=updatedBy [2]=updatedAt [3]=auditLine [4]=cap-1 [5]=numDels
//       [6 .. 5+numDels]=field names to HDEL  [6+numDels ..]=field,value pairs to HSET
const UPDATE_SCRIPT = `
local numDels = tonumber(ARGV[5])
redis.call('HSET', KEYS[1], 'updatedBy', ARGV[1], 'updatedAt', ARGV[2])
for i = 1, numDels do redis.call('HDEL', KEYS[1], ARGV[5 + i]) end
for i = 6 + numDels, #ARGV, 2 do redis.call('HSET', KEYS[1], ARGV[i], ARGV[i+1]) end
redis.call('LPUSH', KEYS[2], ARGV[3])
redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[4]))
return redis.call('HGETALL', KEYS[1])`;

export async function updateAdminSettings(patch: SettingsPatch, actor: string): Promise<AdminSettings> {
  const keys = Object.keys(patch);
  if (keys.length === 0) throw new AdminValidationError("patch", "empty patch");
  const fields: string[] = [];
  const dels: string[] = [];
  const changed: Record<string, boolean | number> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === "paused") {
      if (typeof v !== "boolean") throw new AdminValidationError(k, `${k} must be a boolean`);
      // Two-state on the wire: "1" or absent. False must clear the field
      // (HDEL) rather than write "0" — the sync poller and scorer read this
      // key independently with a presence check, so false must equal absent.
      if (v) fields.push(k, "1");
      else dels.push(k);
      changed[k] = v;
    } else if (k === "hintsEnabled") {
      if (typeof v !== "boolean") throw new AdminValidationError(k, `${k} must be a boolean`);
      fields.push(k, v ? "1" : "0");
      changed[k] = v;
    } else if (k === "teamRegistrationOpen") {
      if (typeof v !== "boolean") throw new AdminValidationError(k, `${k} must be a boolean`);
      // Two-state, inverted from `paused`: open is the default (absent), so
      // opening HDELs the field and closing writes the string "0". The team
      // store reads this key with a presence-and-value check, so open must
      // equal absent.
      if (v) dels.push(k);
      else fields.push(k, "0");
      changed[k] = v;
    } else if (k === "hintCost") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > HINT_COST_MAX) {
        throw new AdminValidationError(k, `hintCost must be an integer in [0, ${HINT_COST_MAX}]`);
      }
      fields.push(k, String(v));
      changed[k] = v;
    } else if (k === "hintsMinSolves") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > HINT_MIN_SOLVES_MAX) {
        throw new AdminValidationError(k, `hintsMinSolves must be an integer in [0, ${HINT_MIN_SOLVES_MAX}]`);
      }
      fields.push(k, String(v));
      changed[k] = v;
    } else if (k === "hintsUnlockAfterMin") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > HINT_UNLOCK_AFTER_MAX) {
        throw new AdminValidationError(k, `hintsUnlockAfterMin must be an integer in [0, ${HINT_UNLOCK_AFTER_MAX}]`);
      }
      fields.push(k, String(v));
      changed[k] = v;
    } else if (k === "quizMaxAttempts") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > QUIZ_MAX_ATTEMPTS_MAX) {
        throw new AdminValidationError(k, `quizMaxAttempts must be an integer in [0, ${QUIZ_MAX_ATTEMPTS_MAX}]`);
      }
      fields.push(k, String(v));
      changed[k] = v;
    } else if (k === "quizRetryAfterMin") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > QUIZ_RETRY_AFTER_MAX) {
        throw new AdminValidationError(k, `quizRetryAfterMin must be an integer in [0, ${QUIZ_RETRY_AFTER_MAX}]`);
      }
      fields.push(k, String(v));
      changed[k] = v;
    } else if ((SCHEDULE_FIELDS as readonly string[]).includes(k)) {
      // Nullable ISO bound: null/"" clears it (HDEL); a value must parse as a
      // date and is stored normalised to its ISO-8601 UTC form.
      if (v === null || v === "") {
        dels.push(k);
        changed[k] = null as unknown as boolean;
      } else {
        if (typeof v !== "string") throw new AdminValidationError(k, `${k} must be an ISO date string or null`);
        const ms = Date.parse(v);
        if (!Number.isFinite(ms)) throw new AdminValidationError(k, `${k} must be a valid ISO date string`);
        const iso = new Date(ms).toISOString();
        fields.push(k, iso);
        changed[k] = iso as unknown as boolean;
      }
    } else {
      throw new AdminValidationError(k, `unknown setting: ${k}`);
    }
  }
  const at = new Date().toISOString();
  const audit = JSON.stringify({ at, by: actor, changed });
  const result = await upstashEval(
    UPDATE_SCRIPT,
    [ADMIN_SETTINGS_KEY, ADMIN_AUDIT_KEY],
    [actor, at, audit, String(AUDIT_CAP - 1), String(dels.length), ...dels, ...fields],
  );
  return decodeSettings(flatToObject(result));
}

// --- master reset ------------------------------------------------------------

// Event-data key prefixes the master reset wipes. Each label is what the audit
// record + API response reports as a cleared count. Deliberately excludes
// ctf:admin:settings (kept), ctf:admin:audit (appended, not cleared), and
// ctf:sync:status (sync owns it). ctf:user:* covers both the team-membership
// hash and ctf:user:<login>:hints; ctf:team:* covers <slug> and <slug>:members.
const RESET_PREFIXES: readonly [string, string][] = [
  ["solves", "ctf:solves:*"],
  ["teams", "ctf:team:*"],
  ["users", "ctf:user:*"],
  ["joinCodes", "ctf:joincode:*"],
  ["hints", "ctf:hints:*"],
];

// SCAN (never KEYS — non-blocking) a prefix and DEL matches in batches until the
// cursor wraps. Returns how many keys were removed.
async function scanDelByPrefix(pattern: string): Promise<number> {
  let cursor = "0";
  let total = 0;
  do {
    const [scan] = await upstashPipeline([["SCAN", cursor, "MATCH", pattern, "COUNT", 1000]]);
    const [next, keys] = Array.isArray(scan.result) ? (scan.result as [string, string[]]) : ["0", []];
    cursor = String(next);
    if (keys.length > 0) {
      await upstashPipeline([["DEL", ...keys]]);
      total += keys.length;
    }
  } while (cursor !== "0");
  return total;
}

// Freeze scoring, bump the reset epoch (sync reads `resetAt` and clears its
// cursor when it advances — the poll-mode re-ingest fix), and append the audit
// record. One atomic script so a reset can never land without its audit line.
// ARGV: [1]=actor [2]=at [3]=resetAt [4]=auditLine [5]=cap-1
const RESET_SCRIPT = `
redis.call('HSET', KEYS[1], 'paused', '1', 'resetAt', ARGV[3], 'updatedBy', ARGV[1], 'updatedAt', ARGV[2])
redis.call('LPUSH', KEYS[2], ARGV[4])
redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[5]))`;

/**
 * Master reset: wipe all event data (solves, teams, users, join codes, hints),
 * freeze scoring, bump the sync reset epoch, and audit it. Keeps admin
 * settings. Server-only — callers gate on requireAdmin.
 *
 * Poll-mode note: freezing + the `resetAt` epoch (honoured by sync, which drops
 * its cursor) is what makes the wipe stick; a later unfreeze re-ingests from
 * live PR comments, so a post-event wipe also needs those comments gone.
 */
export async function resetEvent(actor: string): Promise<{ cleared: Record<string, number>; resetAt: string }> {
  const cleared: Record<string, number> = {};
  for (const [label, pattern] of RESET_PREFIXES) {
    cleared[label] = await scanDelByPrefix(pattern);
  }
  const at = new Date().toISOString();
  const resetAt = String(Date.now());
  const audit = JSON.stringify({ at, by: actor, action: "reset", cleared });
  await upstashEval(
    RESET_SCRIPT,
    [ADMIN_SETTINGS_KEY, ADMIN_AUDIT_KEY],
    [actor, at, resetAt, audit, String(AUDIT_CAP - 1)],
  );
  return { cleared, resetAt };
}

// --- demo seed (DEMO_MODE only) ----------------------------------------------

/**
 * Populate a demo leaderboard from the bundled fixture: real challenge-id solves
 * (so the scorer awards points), spread over the last ~6h for a rising
 * score-over-time graph, plus a few teams. Additive — does not clear first.
 * Gated by the route on DEMO_MODE + requireAdmin; never a production path.
 */
export async function seedDemoData(actor: string): Promise<{ contestants: number; teams: number; solves: number }> {
  const now = Date.now();
  const windowMs = 6 * 60 * 60 * 1000;
  let total = 0;
  for (const c of DEMO_CONTESTANTS) for (const ids of Object.values(c.solves)) total += ids.length;

  const cmds: (string | number)[][] = [];
  const base = now - windowMs;
  const n = DEMO_CONTESTANTS.length;
  // Spread EACH contestant's solves across the whole window (not a per-contestant
  // block), so every line rises throughout and they interleave. A per-contestant
  // sub-slot phase ((ci+0.5)/n) staggers otherwise-identical tick times so lines
  // don't land exactly on top of each other.
  DEMO_CONTESTANTS.forEach((c, ci) => {
    const kc = Object.values(c.solves).reduce((m, ids) => m + ids.length, 0);
    let j = 0;
    for (const [target, ids] of Object.entries(c.solves)) {
      for (const id of ids) {
        const frac = kc > 0 ? (j + (ci + 0.5) / n) / kc : 0.5;
        const ts = new Date(base + Math.min(0.999, frac) * windowMs).toISOString();
        cmds.push(["HSET", `ctf:solves:${target}`, `${c.login}:${id}`, ts]);
        j++;
      }
    }
  });
  const createdAt = new Date(now - windowMs).toISOString();
  for (const t of DEMO_TEAMS) {
    cmds.push(["HSET", `ctf:team:${t.slug}`, "name", t.name, "captain", t.captain, "createdAt", createdAt, "joinCode", t.slug.slice(0, 6)]);
    if (t.members.length > 0) cmds.push(["SADD", `ctf:team:${t.slug}:members`, ...t.members]);
    for (const m of t.members) cmds.push(["HSET", `ctf:user:${m}`, "team", t.slug]);
  }
  const audit = JSON.stringify({
    at: new Date(now).toISOString(),
    by: actor,
    action: "seed",
    contestants: DEMO_CONTESTANTS.length,
    teams: DEMO_TEAMS.length,
    solves: total,
  });
  cmds.push(["LPUSH", ADMIN_AUDIT_KEY, audit]);
  cmds.push(["LTRIM", ADMIN_AUDIT_KEY, 0, AUDIT_CAP - 1]);

  await upstashPipeline(cmds);
  return { contestants: DEMO_CONTESTANTS.length, teams: DEMO_TEAMS.length, solves: total };
}
