import "server-only";
import { upstashEval, upstashPipeline } from "@/lib/upstash";
import { ADMIN_ADMINS_KEY, LOGIN_RE } from "@/lib/admin-admins";
import { TEAM_MAX_MEMBERS_MAX } from "@/lib/team-limits";
import {
  enabledModules,
  isModuleEnabled,
  MODULE_TITLE_MAX,
  MODULE_BLURB_MAX,
  type ModuleId,
  type ModuleOverrides,
} from "@/lib/modules";
import {
  DEMO_CONTESTANTS,
  DEMO_TEAMS,
  DEMO_QUESTIONS,
  DEMO_QUIZ_ANSWERS,
  DEMO_CHALLENGES,
  DEMO_CLASSIC_CATEGORIES,
  DEMO_CLASSIC_SOLVES,
} from "@/lib/demo-fixture";
import {
  QUIZ_QUESTIONS_KEY,
  QUIZ_KEY_KEY,
  QUIZ_POINTS_KEY,
  QUIZ_ANSWERED_KEY,
  QUIZ_ANSWERS_PREFIX,
  QUIZ_ATTEMPTS_PREFIX,
  quizAnswersKey,
  canonicalizeChoices,
} from "@/lib/quiz-keys";
import {
  CLASSIC_CHALLENGES_KEY,
  CLASSIC_FLAG_KEY,
  CLASSIC_FLAGNORM_KEY,
  CLASSIC_CATEGORIES_KEY,
  CLASSIC_POINTS_KEY,
  CLASSIC_SOLVED_KEY,
  CLASSIC_SOLVECOUNT_KEY,
  CLASSIC_SOLVES_PREFIX,
  CLASSIC_ATTEMPTS_PREFIX,
  classicSolvesKey,
  normalizeFlag,
} from "@/lib/classic-keys";

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
/** Cap for the classic-module submission cooldown (see below). */
export const CLASSIC_COOLDOWN_SEC_MAX = 3600;

// Defined in team-limits.ts (no `server-only`) because the admin panel is a
// Client Component and needs it for the field's `max`. Re-exported so server
// callers keep one import.
export { TEAM_MAX_MEMBERS_MAX } from "@/lib/team-limits";
// MODULE_TITLE_MAX / MODULE_BLURB_MAX (used below for validation) are
// defined in @/lib/modules — client-safe, unlike this file — so the admin
// panel's identity form can read them too. Not re-exported here: nothing in
// the repo imports them from this file, and a second import path to the same
// two constants is exactly the kind of dead surface a later change could
// silently drift out of sync with.
const MODULE_FIELD_RE = /^module(Title|Blurb):(.+)$/;
// Organizer-authored text rendered on pages every contestant loads. Plain text
// only — reject C0 control characters (so nothing can smuggle a terminal
// escape or a line break into a heading) and Unicode bidi override/isolate
// characters (U+202A-U+202E, U+2066-U+2069), which reorder rendered glyphs
// and could visually scramble a heading. This is rendered-text integrity, not
// injection protection — there is no HTML to sanitise because none is ever
// interpreted.
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/;

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
  /** Seconds a login must wait between flag submissions on the SAME classic
   *  challenge. null = use the module default. Seconds, not minutes: its job
   *  is blocking scripted brute force, not rationing tries. */
  classicCooldownSec: number | null;
  /** Players allowed on one team. Null = no override, use the default in
   *  team-store. Enforced on JOIN only: lowering it never evicts anyone from a
   *  team that is already over the new cap. */
  teamMaxMembers: number | null;
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
  /** Organizer-authored title/blurb overrides, keyed by module id. Unknown or
   *  disabled module ids are dropped on read (see decodeSettings). */
  moduleOverrides: ModuleOverrides;
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
  /** Score comments the poller consumed and could not turn into points — a
   *  scorer 4xx, or a `ctf-score:` marker it cannot read. Cumulative, and
   *  never self-clearing: each one is a score sitting on a PR that the
   *  leaderboard will never show until somebody intervenes. `lastDrop` says
   *  which repo and why. */
  dropped: number;
  lastDrop: string | null;
  reposPolled: number;
  paused: boolean;
};

// Dynamic per-module naming fields: moduleTitle:<id> / moduleBlurb:<id>. A
// template literal type (not a bare index signature) so TypeScript still
// catches a typo in any of the fixed field names above.
type ModuleFieldKey = `moduleTitle:${string}` | `moduleBlurb:${string}`;

export type SettingsPatch = {
  paused?: boolean;
  hintsEnabled?: boolean;
  hintCost?: number;
  hintsMinSolves?: number;
  hintsUnlockAfterMin?: number;
  quizMaxAttempts?: number;
  quizRetryAfterMin?: number;
  classicCooldownSec?: number;
  teamMaxMembers?: number;
  teamRegistrationOpen?: boolean;
  // ISO instant to set the bound, or null/"" to clear it.
  scoringStartsAt?: string | null;
  scoringEndsAt?: string | null;
  registrationStartsAt?: string | null;
  registrationEndsAt?: string | null;
} & Partial<Record<ModuleFieldKey, string>>;

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
  // Dynamic fields: moduleTitle:<id> / moduleBlurb:<id>. Unknown ids are
  // dropped on read as well as rejected on write — a stale override left by a
  // module that has since been disabled must not resurface if it is
  // re-enabled under a different name.
  const moduleOverrides: ModuleOverrides = {};
  const enabledIds = new Set(enabledModules.map((m) => m.id as string));
  for (const [field, value] of Object.entries(h)) {
    const m = MODULE_FIELD_RE.exec(field);
    if (!m) continue;
    const [, which, id] = m;
    if (!enabledIds.has(id)) continue;
    const slot = (moduleOverrides[id as ModuleId] ??= {});
    if (which === "Title") slot.title = value;
    else slot.blurb = value;
  }

  return {
    paused: h.paused === "1",
    hintsEnabled: h.hintsEnabled === undefined ? null : h.hintsEnabled === "1",
    hintCost: h.hintCost === undefined ? null : Number(h.hintCost),
    hintsMinSolves: h.hintsMinSolves === undefined ? null : Number(h.hintsMinSolves),
    hintsUnlockAfterMin: h.hintsUnlockAfterMin === undefined ? null : Number(h.hintsUnlockAfterMin),
    quizMaxAttempts: h.quizMaxAttempts === undefined ? null : Number(h.quizMaxAttempts),
    quizRetryAfterMin: h.quizRetryAfterMin === undefined ? null : Number(h.quizRetryAfterMin),
    classicCooldownSec: h.classicCooldownSec === undefined ? null : Number(h.classicCooldownSec),
    teamMaxMembers: h.teamMaxMembers === undefined ? null : Number(h.teamMaxMembers),
    teamRegistrationOpen: h.teamRegistrationOpen !== "0",
    scoringStartsAt: h.scoringStartsAt ?? null,
    scoringEndsAt: h.scoringEndsAt ?? null,
    registrationStartsAt: h.registrationStartsAt ?? null,
    registrationEndsAt: h.registrationEndsAt ?? null,
    updatedBy: h.updatedBy ?? null,
    updatedAt: h.updatedAt ?? null,
    moduleOverrides,
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
    dropped: Number(h.dropped ?? 0),
    lastDrop: h.lastDrop ?? null,
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
    } else if (k === "classicCooldownSec") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > CLASSIC_COOLDOWN_SEC_MAX) {
        throw new AdminValidationError(k, `classicCooldownSec must be an integer in [0, ${CLASSIC_COOLDOWN_SEC_MAX}]`);
      }
      fields.push(k, String(v));
      changed[k] = v;
    } else if (k === "teamMaxMembers") {
      // Floor of 1, not 0. Zero would store a cap no team can satisfy — every
      // join refused, including the captain's own team, with the UI cheerfully
      // advertising "0 players max". Rejecting it here is the difference
      // between a validation error and an event nobody can form a team in.
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > TEAM_MAX_MEMBERS_MAX) {
        throw new AdminValidationError(k, `teamMaxMembers must be an integer in [1, ${TEAM_MAX_MEMBERS_MAX}]`);
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
    } else if (MODULE_FIELD_RE.test(k)) {
      const [, which, id] = MODULE_FIELD_RE.exec(k)!;
      // Fail closed: an id that isn't an enabled module is a typo or a probe,
      // never something to store quietly.
      if (!enabledModules.some((m) => m.id === id)) {
        throw new AdminValidationError(k, `unknown module: ${id}`);
      }
      if (typeof v !== "string") throw new AdminValidationError(k, `${k} must be a string`);
      const max = which === "Title" ? MODULE_TITLE_MAX : MODULE_BLURB_MAX;
      const text = v.trim();
      if (text.length > max) throw new AdminValidationError(k, `${k} must be at most ${max} characters`);
      if (CONTROL_CHARS_RE.test(text)) throw new AdminValidationError(k, `${k} must not contain control characters`);
      // Empty clears the override (HDEL) so the registry default comes back —
      // storing "" would render a blank heading instead.
      if (text === "") dels.push(k);
      else fields.push(k, text);
      changed[k] = text as unknown as boolean;
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
//
// Quiz scope (spec Q1): wipes contestant PROGRESS (per-login answers/attempts,
// plus the two running-total aggregate hashes) and deliberately KEEPS
// `ctf:quiz:questions` / `ctf:quiz:key` — those are organizer CONTENT, like
// `ctf:admin:settings`, not something a reset should ever destroy. The
// aggregates (`ctf:quiz:points`/`ctf:quiz:answered`) MUST still be cleared:
// leaving them would show contestants stale quiz points on a freshly reset
// board with no answers behind them. `ctf:quiz:points`/`ctf:quiz:answered`
// are exact key names, not globs, but `scanDelByPrefix`'s SCAN MATCH works
// the same either way.
//
// Classic scope mirrors quiz's exactly, for the same reason (see
// deleteChallenge's doc comment in classic-store.ts for the same contract
// stated from the single-challenge-delete side): wipes contestant PROGRESS —
// per-login solves/attempts, plus the three aggregate hashes
// (`ctf:classic:points`/`ctf:classic:solved`/`ctf:classic:solvecount`) the
// leaderboard reads — and deliberately KEEPS `ctf:classic:challenges` /
// `ctf:classic:flag` / `ctf:classic:flagnorm` / `ctf:classic:categories`,
// which are organizer CONTENT, not something a reset should ever destroy.
const RESET_PREFIXES: readonly [string, string][] = [
  ["solves", "ctf:solves:*"],
  ["teams", "ctf:team:*"],
  ["users", "ctf:user:*"],
  ["joinCodes", "ctf:joincode:*"],
  ["hints", "ctf:hints:*"],
  ["quizAnswers", `${QUIZ_ANSWERS_PREFIX}*`],
  ["quizAttempts", `${QUIZ_ATTEMPTS_PREFIX}*`],
  ["quizPoints", QUIZ_POINTS_KEY],
  ["quizAnswered", QUIZ_ANSWERED_KEY],
  ["classicSolves", `${CLASSIC_SOLVES_PREFIX}*`],
  ["classicAttempts", `${CLASSIC_ATTEMPTS_PREFIX}*`],
  ["classicPoints", CLASSIC_POINTS_KEY],
  ["classicSolved", CLASSIC_SOLVED_KEY],
  ["classicSolveCount", CLASSIC_SOLVECOUNT_KEY],
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
 * score-over-time graph, plus a few teams. When the quiz module is enabled,
 * also seeds a small demo question bank and a spread of correct answers
 * across the same contestants (timestamped inside the same ~6h window) so
 * DEMO_MODE shows a genuinely combined two-module leaderboard. Additive —
 * does not clear first. Gated by the route on DEMO_MODE + requireAdmin;
 * never a production path.
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

  // Quiz demo data — only when the module is enabled, so a disabled quiz
  // module leaves the seed byte-for-byte identical to pre-quiz behavior.
  const quizEnabled = isModuleEnabled("quiz");
  let quizAnswersSeeded = 0;
  if (quizEnabled) {
    // Write the public question + its correct-answer key with the SAME
    // shared `canonicalizeChoices` recipe quiz-store's upsertQuestion uses
    // (dedupe then sort into a JSON array) — GRADE_SCRIPT string-compares a
    // submission's canonicalized array against this key byte-for-byte, so
    // any other shape here would silently make every demo question
    // ungradeable.
    for (const { correct, ...question } of DEMO_QUESTIONS) {
      cmds.push(["HSET", QUIZ_QUESTIONS_KEY, question.id, JSON.stringify(question)]);
      cmds.push(["HSET", QUIZ_KEY_KEY, question.id, JSON.stringify(canonicalizeChoices(correct))]);
    }

    const questionsById = new Map(DEMO_QUESTIONS.map((q) => [q.id, q]));
    const aggregates = new Map<string, { points: number; answered: number }>();
    const nAnswers = DEMO_QUIZ_ANSWERS.length;
    DEMO_QUIZ_ANSWERS.forEach(({ login, questionId }, i) => {
      const q = questionsById.get(questionId);
      if (!q) return; // fixture-consistency guard; should never trigger
      const frac = nAnswers > 0 ? (i + 0.5) / nAnswers : 0.5;
      const at = new Date(base + Math.min(0.999, frac) * windowMs).toISOString();
      // Same shared recipe as the key above: a demo answer's banked
      // `choices` is always the question's full correct set (it's recorded
      // as correct), stored the same way GRADE_SCRIPT stores a live one.
      const choices = canonicalizeChoices(q.correct);
      cmds.push(["HSET", quizAnswersKey(login), questionId, JSON.stringify({ choices, points: q.points, at })]);

      const agg = aggregates.get(login) ?? { points: 0, answered: 0 };
      agg.points += q.points;
      agg.answered += 1;
      aggregates.set(login, agg);
      quizAnswersSeeded++;
    });
    // Aggregates are written as the final absolute total (not HINCRBY'd),
    // unlike GRADE_SCRIPT's live increments — the fixture already knows each
    // login's final total, and an absolute HSET keeps re-running the seed
    // idempotent instead of doubling the totals on a second seed.
    for (const [login, agg] of aggregates) {
      cmds.push(["HSET", QUIZ_POINTS_KEY, login, agg.points]);
      cmds.push(["HSET", QUIZ_ANSWERED_KEY, login, agg.answered]);
    }
  }

  // Classic demo data — only when the module is enabled, so a disabled
  // classic module leaves the seed byte-for-byte identical to pre-classic
  // behavior (same reasoning as the quiz gate above).
  const classicEnabled = isModuleEnabled("classic");
  let classicSolvesSeeded = 0;
  if (classicEnabled) {
    // Public challenge record ONLY — built field by field from `Challenge`'s
    // own shape, never by spreading the fixture object, so the flag (which
    // lives alongside it on the fixture) has no path into
    // ctf:classic:challenges. The authored flag and its normalized form are
    // written into their own separate hashes in the SAME pipeline, exactly
    // as upsertChallenge does — normalizeFlag is the ONLY thing allowed to
    // produce ctf:classic:flagnorm's value; a hand-rolled lowercase here
    // would silently desync from what submitFlag compares against.
    for (const dc of DEMO_CHALLENGES) {
      const challenge = {
        id: dc.id,
        title: dc.title,
        category: dc.category,
        description: dc.description,
        points: dc.points,
        order: dc.order,
      };
      cmds.push(["HSET", CLASSIC_CHALLENGES_KEY, dc.id, JSON.stringify(challenge)]);
      cmds.push(["HSET", CLASSIC_FLAG_KEY, dc.id, dc.flag]);
      cmds.push(["HSET", CLASSIC_FLAGNORM_KEY, dc.id, normalizeFlag(dc.flag)]);
    }
    cmds.push(["SET", CLASSIC_CATEGORIES_KEY, JSON.stringify(DEMO_CLASSIC_CATEGORIES)]);

    const challengesById = new Map(DEMO_CHALLENGES.map((c) => [c.id, c]));
    const classicAggregates = new Map<string, { points: number; solved: number }>();
    const solveCounts = new Map<string, number>();
    const nSolves = DEMO_CLASSIC_SOLVES.length;
    DEMO_CLASSIC_SOLVES.forEach(({ login, challengeId }, i) => {
      const challenge = challengesById.get(challengeId);
      if (!challenge) return; // fixture-consistency guard; should never trigger
      const frac = nSolves > 0 ? (i + 0.5) / nSolves : 0.5;
      const at = new Date(base + Math.min(0.999, frac) * windowMs).toISOString();
      cmds.push(["HSET", classicSolvesKey(login), challengeId, JSON.stringify({ points: challenge.points, at })]);

      const agg = classicAggregates.get(login) ?? { points: 0, solved: 0 };
      agg.points += challenge.points;
      agg.solved += 1;
      classicAggregates.set(login, agg);

      solveCounts.set(challengeId, (solveCounts.get(challengeId) ?? 0) + 1);
      classicSolvesSeeded++;
    });
    // Aggregates written as the final absolute total (not HINCRBY'd), mirroring
    // the quiz aggregates above — idempotent on a second seed run.
    for (const [login, agg] of classicAggregates) {
      cmds.push(["HSET", CLASSIC_POINTS_KEY, login, agg.points]);
      cmds.push(["HSET", CLASSIC_SOLVED_KEY, login, agg.solved]);
    }
    for (const [challengeId, count] of solveCounts) {
      cmds.push(["HSET", CLASSIC_SOLVECOUNT_KEY, challengeId, count]);
    }
  }

  const audit = JSON.stringify({
    at: new Date(now).toISOString(),
    by: actor,
    action: "seed",
    contestants: DEMO_CONTESTANTS.length,
    teams: DEMO_TEAMS.length,
    solves: total,
    ...(quizEnabled ? { quizQuestions: DEMO_QUESTIONS.length, quizAnswers: quizAnswersSeeded } : {}),
    ...(classicEnabled
      ? { classicChallenges: DEMO_CHALLENGES.length, classicSolves: classicSolvesSeeded }
      : {}),
  });
  cmds.push(["LPUSH", ADMIN_AUDIT_KEY, audit]);
  cmds.push(["LTRIM", ADMIN_AUDIT_KEY, 0, AUDIT_CAP - 1]);

  await upstashPipeline(cmds);
  return { contestants: DEMO_CONTESTANTS.length, teams: DEMO_TEAMS.length, solves: total };
}

// --- runtime admins (issue #147) ---------------------------------------------

// The key, the login pattern and the READ live in admin-admins.ts so the
// authorization path can import them without pulling in this module and the
// module registry behind it. Re-exported here so callers that already talk to
// the admin store keep one import.
export { ADMIN_ADMINS_KEY, listStoredAdmins } from "@/lib/admin-admins";

// SADD/SREM plus one audit line, in a single script, so a grant can never
// land without its record — the same guarantee updateAdminSettings gives.
const ADMINS_SCRIPT = `
if ARGV[1] == 'add' then redis.call('SADD', KEYS[1], ARGV[2])
else redis.call('SREM', KEYS[1], ARGV[2]) end
redis.call('LPUSH', KEYS[2], ARGV[3])
redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[4]))
return redis.call('SMEMBERS', KEYS[1])`;

async function mutateAdmins(action: "add" | "remove", login: string, actor: string): Promise<string[]> {
  const normalized = login.trim().toLowerCase();
  if (!normalized) throw new AdminValidationError("login", "login is required");
  if (!LOGIN_RE.test(normalized)) {
    throw new AdminValidationError("login", `'${login}' is not a GitHub login`);
  }
  const at = new Date().toISOString();
  const audit = JSON.stringify({ at, by: actor, action: `admin:${action}`, login: normalized });
  const res = await upstashEval(
    ADMINS_SCRIPT,
    [ADMIN_ADMINS_KEY, ADMIN_AUDIT_KEY],
    [action, normalized, audit, String(AUDIT_CAP - 1)],
  );
  const arr = Array.isArray(res) ? (res as string[]) : [];
  return arr.map((a) => String(a).toLowerCase()).sort();
}

/** Grant admin to `login` at runtime. Idempotent (SADD). */
export async function addStoredAdmin(login: string, actor: string): Promise<string[]> {
  return mutateAdmins("add", login, actor);
}

/** Revoke a RUNTIME grant. Cannot touch a baked admin — the route refuses
 *  that before calling here, because a baked login is the lockout recovery
 *  path and must survive any mistake made through the panel. */
export async function removeStoredAdmin(login: string, actor: string): Promise<string[]> {
  return mutateAdmins("remove", login, actor);
}
