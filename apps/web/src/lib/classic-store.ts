import "server-only";
import { effectivePaused, getAdminSettings } from "@/lib/admin-store";
import { MARKDOWN_MAX } from "@/lib/markdown";
import { upstashEval, upstashPipeline } from "@/lib/upstash";
import {
  CLASSIC_CHALLENGES_KEY as CHALLENGES_KEY,
  CLASSIC_FLAG_KEY as FLAG_KEY,
  CLASSIC_FLAGNORM_KEY as FLAGNORM_KEY,
  CLASSIC_CATEGORIES_KEY as CATEGORIES_KEY,
  CLASSIC_POINTS_KEY as POINTS_KEY,
  CLASSIC_SOLVED_KEY as SOLVED_KEY,
  CLASSIC_SOLVECOUNT_KEY as SOLVECOUNT_KEY,
  classicSolvesKey as solvesKey,
  classicAttemptsKey as attemptsKey,
  normalizeFlag,
  CLASSIC_ID_RE,
} from "@/lib/classic-keys";

/**
 * The classic (jeopardy-style flag) module. This file is the only place that
 * touches `ctf:classic:*` Redis keys during normal contestant and authoring
 * activity — submitting, grading, and challenge authoring/deletion all go
 * through it, and nothing else should read or write these keys for those
 * flows. The same deliberate exception quiz-store.ts documents applies here:
 * admin-store.ts's bulk-maintenance paths (demo seed, master reset) reuse the
 * key names from classic-keys.ts directly rather than going through these
 * functions.
 *
 * Key layout:
 *   ctf:classic:challenges       hash, id -> JSON Challenge (public-safe; this
 *                                 is what contestants see)
 *   ctf:classic:flag             hash, id -> the flag AS AUTHORED, trimmed
 *                                 (SECRET from contestants). Written for the
 *                                 admin edit form ALONE and read by exactly
 *                                 one function, `listChallengesForAdmin`. The
 *                                 grading script never reads it — see below.
 *   ctf:classic:flagnorm         hash, id -> `normalizeFlag(flag)` (SECRET).
 *                                 The ONLY value grading ever compares
 *                                 against.
 *   ctf:classic:categories       string, JSON array of category names in the
 *                                 organizer's chosen display order.
 *   ctf:classic:solves:<login>   hash, id -> JSON {points, at} — records ONLY
 *                                 solves. Points are captured at solve time,
 *                                 so a later re-pricing of a challenge never
 *                                 rewrites history.
 *   ctf:classic:attempts:<login> hash, id -> JSON {attempts, lastAt, lastAtMs}
 *                                 — every submission, right or wrong; the
 *                                 cooldown reads this. `lastAtMs` (a plain
 *                                 epoch-ms mirror of `lastAt`) exists only so
 *                                 SUBMIT_SCRIPT can do cooldown arithmetic in
 *                                 Lua without parsing an ISO-8601 string;
 *                                 readers outside this file should use `lastAt`.
 *   ctf:classic:points           hash, login -> running points total
 *   ctf:classic:solved           hash, login -> running solve count
 *   ctf:classic:solvecount       hash, challenge id -> DISTINCT solver count
 *
 * TWO flag hashes, on purpose. `flagnorm` is what grading compares; `flag` is
 * what an organizer sees when editing. They are written together in one
 * pipeline so they cannot observably disagree, and only `flagnorm` is ever
 * handed to Redis's scripting path.
 *
 * Normalization (`normalizeFlag`, in classic-keys.ts) happens in JS on BOTH
 * paths — authoring and submission — and NEVER in Lua. Lua's `string.lower` is
 * ASCII-only, so a Lua-side normalization of any non-ASCII flag would disagree
 * with the authoring side and produce a challenge nobody can solve.
 *
 * Secrecy boundary — a CONTESTANT boundary, not an absolute one, mirroring
 * `ctf:quiz:key`. Two readers, deliberately kept apart:
 *
 *   - `listChallenges` (the CONTESTANT path — `/flags`, the leaderboard
 *     overlay) never issues a command against `ctf:classic:flag` OR
 *     `ctf:classic:flagnorm`, and the `Challenge` type it returns has no field
 *     that could carry a flag. That property is absolute and must stay that
 *     way.
 *   - `listChallengesForAdmin` (the ADMIN path — `GET /api/admin/classic`,
 *     behind `requireAdmin`) DOES read `ctf:classic:flag`, and returns it in a
 *     separate `AdminChallenge` shape that is deliberately not assignable to
 *     `Challenge` (see its doc comment). Withholding the flag from an
 *     organizer editing the challenge buys nothing — anyone through that gate
 *     can already rewrite or delete it — while costing real correctness: an
 *     edit form that starts with an empty flag box turns every typo fix into a
 *     chance to silently redefine what counts as solved.
 *
 * Grading (which reads `ctf:classic:flagnorm`) is likewise server-only and is
 * never exposed by a route that echoes its input back to the caller.
 *
 * Callers (the /api/classic route handlers) are responsible for authenticating
 * the session and deriving `login` server-side — nothing here trusts
 * client-supplied identity.
 */

// Key names/builders live in ./classic-keys (a dependency-free module) rather
// than as local consts here — see classic-keys.ts's header comment for why.
// POINTS_KEY/SOLVED_KEY/SOLVECOUNT_KEY are running totals, updated atomically
// by SUBMIT_SCRIPT alongside the per-login solve row, so a leaderboard overlay
// costs one HGETALL each regardless of board size.

/** Default seconds a login must wait between submissions on the SAME
 *  challenge. Seconds, not minutes: the job is blocking scripted brute force,
 *  not rationing tries. 0 (an admin override) means no cooldown. */
export const CLASSIC_COOLDOWN_SEC = 5;

/** Upper bound on a challenge's point value, mirroring `QUIZ_POINTS_MAX`.
 *  This is not cosmetic: `upsertChallenge` writes `points` verbatim into the
 *  challenge hash via `JSON.stringify`, and at >=1e21 JavaScript serialises a
 *  number in exponential form (`1e+21`), which SUBMIT_SCRIPT's anchored
 *  `'"points":(%-?%d+)[,}]'` match cannot read — the script would fall back to
 *  0 and silently award nothing for a correct flag. A sane cap keeps every
 *  storable value inside the plain-integer form the script can actually
 *  parse. */
export const CLASSIC_POINTS_MAX = 100000;

/** Caps on the category list. Categories are rendered as headings on a page
 *  every contestant loads, and the whole list is stored in one string value. */
export const CLASSIC_CATEGORY_MAX_LEN = 64;
export const CLASSIC_CATEGORIES_MAX = 50;

/** Challenge id pattern, re-exported so callers (e.g. the submit route)
 *  validate against this exact pattern instead of keeping their own copy that
 *  could silently desync. It is DEFINED in classic-keys.ts because the admin
 *  panel's id generator runs in the browser and must check its output against
 *  the same object this `server-only` file validates with. */
export { CLASSIC_ID_RE };

/** Thrown by the authoring functions for genuine input-validation failures
 *  (bad id, unknown category, non-integer points, empty flag) — mirroring
 *  `QuizValidationError`. Callers (the admin route) can distinguish this from
 *  a plain `Error`, which these functions still throw for a genuine
 *  Upstash/infra failure, so a caller-facing status code can tell "your
 *  payload was bad" apart from "the store failed". */
export class ClassicValidationError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "ClassicValidationError";
    this.field = field;
  }
}

/** Public-safe challenge shape. Never carries a flag, in either form. */
export type Challenge = {
  id: string;
  title: string;
  category: string;
  description: string;
  points: number;
  order: number;
};

/** One challenge as the ADMIN-GATED surface sees it: the public-safe record
 *  and its flag, side by side but in two SEPARATE fields.
 *
 *  The nesting is the point, not an accident of style. The obvious shape —
 *  `Challenge & { flag: string }` — is structurally still a `Challenge`, so
 *  handing an admin record to a contestant-facing component (`<ClassicBoard
 *  challenges={rows} />`) would type-check and quietly ship every flag to
 *  every visitor. This shape is NOT assignable to `Challenge`, so that mistake
 *  is a compile error; reaching the public half takes an explicit
 *  `.challenge`, which is a thing you write on purpose rather than a thing you
 *  forget. */
export type AdminChallenge = {
  /** Byte-for-byte what `listChallenges` would have returned for this id. */
  challenge: Challenge;
  /** The flag AS AUTHORED (trimmed), exactly as `ctf:classic:flag` stores it.
   *  Empty only if the flag row is missing — a challenge in that state can
   *  never be solved, which is worth seeing in the edit form rather than
   *  hiding. */
  flag: string;
};

function parseChallenge(raw: string): Challenge | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const c = parsed as Record<string, unknown>;
    if (typeof c.id !== "string") return null;
    if (typeof c.title !== "string") return null;
    if (typeof c.category !== "string") return null;
    if (typeof c.description !== "string") return null;
    if (typeof c.points !== "number") return null;
    if (typeof c.order !== "number") return null;
    return {
      id: c.id,
      title: c.title,
      category: c.category,
      description: c.description,
      points: c.points,
      order: c.order,
    };
  } catch {
    return null;
  }
}

/** The board's reading order: cheapest first (points ascending), then the
 *  organizer's explicit `order`, then id as a stable tiebreak so two equal
 *  challenges never swap places between two renders of the same data. */
function compareChallenges(a: Challenge, b: Challenge): number {
  return a.points - b.points || a.order - b.order || a.id.localeCompare(b.id);
}

function parseChallengeHash(flat: unknown): Challenge[] {
  const arr = Array.isArray(flat) ? (flat as string[]) : [];
  const out: Challenge[] = [];
  for (let i = 0; i < arr.length; i += 2) {
    const parsed = parseChallenge(arr[i + 1]);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** All challenges, in board order. Flags excluded — this issues a single
 *  HGETALL against the public-safe hash only, and the `Challenge` shape it
 *  returns has nowhere to put a flag even if it did. This is the ONLY list
 *  function a contestant-facing route (or the leaderboard) may call. */
export async function listChallenges(): Promise<Challenge[]> {
  const [res] = await upstashPipeline([["HGETALL", CHALLENGES_KEY]]);
  const challenges = parseChallengeHash(res.result);
  challenges.sort(compareChallenges);
  return challenges;
}

/** The same list, WITH each challenge's flag — for the admin-gated authoring
 *  surface ONLY (`GET /api/admin/classic`, behind `requireAdmin`).
 *
 *  Named so a call site reads as a decision rather than a default: any route
 *  reaching for this one is asserting it has already established the caller is
 *  an organizer. Contestant-facing code calls `listChallenges` instead, and
 *  the `AdminChallenge` return shape (not assignable to `Challenge`) is what
 *  stops the two from being mixed up by accident.
 *
 *  Reads the flag AS AUTHORED (`ctf:classic:flag`), never the normalized form:
 *  an edit form must show the organizer what they typed, casing included.
 *  Both hashes are read in ONE pipeline, so the challenges and their flags
 *  come from the same instant. */
export async function listChallengesForAdmin(): Promise<AdminChallenge[]> {
  const [challengesRes, flagRes] = await upstashPipeline([
    ["HGETALL", CHALLENGES_KEY],
    ["HGETALL", FLAG_KEY],
  ]);

  const flagFlat = Array.isArray(flagRes.result) ? (flagRes.result as string[]) : [];
  const flagById = new Map<string, string>();
  for (let i = 0; i < flagFlat.length; i += 2) {
    if (typeof flagFlat[i + 1] === "string") flagById.set(flagFlat[i], flagFlat[i + 1]);
  }

  const rows = parseChallengeHash(challengesRes.result).map((challenge) => ({
    challenge,
    flag: flagById.get(challenge.id) ?? "",
  }));
  rows.sort((a, b) => compareChallenges(a.challenge, b.challenge));
  return rows;
}

/** The organizer's category list, in the display order they chose. Stored as
 *  one JSON array in a single string key rather than a Redis set: order is
 *  content here (it is the order the board renders headings in), and a set has
 *  none. An absent or unparseable value reads as an empty list — a board with
 *  no categories yet, not an error. */
export async function listCategories(): Promise<string[]> {
  const [res] = await upstashPipeline([["GET", CATEGORIES_KEY]]);
  if (typeof res.result !== "string") return [];
  try {
    const parsed = JSON.parse(res.result) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

/** Replaces the whole category list. Returns what was actually STORED — the
 *  trimmed, deduped list — so the authoring client holds the canonical value a
 *  later `listCategories` would hand it.
 *
 *  Dedupe is case-INSENSITIVE (keeping the first spelling): "Web" and "web"
 *  rendering as two headings side by side is never what an organizer meant,
 *  and `upsertChallenge` matches a challenge's category against this list
 *  exactly, so two casings would also split challenges across them. */
export async function setCategories(names: string[]): Promise<string[]> {
  if (!Array.isArray(names)) throw new ClassicValidationError("categories", "categories must be an array");
  if (names.length > CLASSIC_CATEGORIES_MAX) {
    throw new ClassicValidationError("categories", `At most ${CLASSIC_CATEGORIES_MAX} categories are allowed`);
  }
  const seen = new Set<string>();
  const canonical: string[] = [];
  for (const name of names) {
    if (typeof name !== "string") throw new ClassicValidationError("categories", "Each category must be a string");
    const trimmed = name.trim();
    if (!trimmed) throw new ClassicValidationError("categories", "A category name cannot be empty");
    if (trimmed.length > CLASSIC_CATEGORY_MAX_LEN) {
      throw new ClassicValidationError(
        "categories",
        `A category name must be at most ${CLASSIC_CATEGORY_MAX_LEN} characters`,
      );
    }
    const fold = trimmed.toLowerCase();
    if (seen.has(fold)) continue;
    seen.add(fold);
    canonical.push(trimmed);
  }

  const [res] = await upstashPipeline([["SET", CATEGORIES_KEY, JSON.stringify(canonical)]]);
  if (res.error) throw new Error(`Upstash SET failed: ${res.error}`);
  return canonical;
}

/** Creates or replaces a challenge and its flag. Writes the challenge (no
 *  flag), the flag as authored, and the normalized flag in ONE pipeline call
 *  so the three hashes never observably disagree — in particular so a
 *  challenge can never be live with a `flagnorm` belonging to a previous
 *  version of its flag.
 *
 *  The flag is stored TRIMMED but otherwise verbatim: trailing whitespace in a
 *  flag is invisible in an edit form and would otherwise round-trip into the
 *  organizer's next save. Casing and everything else are preserved, because
 *  the authored copy exists to be read by a human; `normalizeFlag` owns what
 *  grading actually compares.
 *
 *  Returns what was STORED, as an `AdminChallenge`. Contestant-facing code
 *  never sees this value. */
export async function upsertChallenge(c: Challenge, flag: string): Promise<AdminChallenge> {
  if (!CLASSIC_ID_RE.test(c.id)) throw new ClassicValidationError("id", `Invalid challenge id: ${c.id}`);
  if (typeof c.title !== "string" || !c.title.trim()) {
    throw new ClassicValidationError("title", "Challenge title is required");
  }
  // The category must already exist. A challenge filed under a category the
  // board does not render is a challenge no contestant can find.
  const categories = await listCategories();
  if (!categories.includes(c.category)) {
    throw new ClassicValidationError("category", `Unknown category: ${c.category}`);
  }
  if (typeof c.description !== "string" || c.description.length > MARKDOWN_MAX) {
    throw new ClassicValidationError("description", `Description must be at most ${MARKDOWN_MAX} characters`);
  }
  // Points get written verbatim into the challenge hash and read back INSIDE
  // SUBMIT_SCRIPT by pattern-matching a plain integer (see SUBMIT_SCRIPT's
  // comment) — a non-integer here would either fail to match (silently
  // awarding 0) or corrupt HINCRBY mid-script after the attempt bump and solve
  // row had already been written, with no way to roll back.
  if (!Number.isInteger(c.points) || c.points < 0 || c.points > CLASSIC_POINTS_MAX) {
    throw new ClassicValidationError("points", `Challenge points must be an integer in [0, ${CLASSIC_POINTS_MAX}]`);
  }
  if (typeof flag !== "string" || !flag.trim()) {
    throw new ClassicValidationError("flag", "Flag is required");
  }

  const authored = flag.trim();
  const results = await upstashPipeline([
    ["HSET", CHALLENGES_KEY, c.id, JSON.stringify(c)],
    ["HSET", FLAG_KEY, c.id, authored],
    ["HSET", FLAGNORM_KEY, c.id, normalizeFlag(flag)],
  ]);
  const failed = results.find((r) => r.error);
  if (failed) throw new Error(`Upstash HSET failed: ${failed.error}`);

  return { challenge: c, flag: authored };
}

/** Removes a challenge and both of its flag rows together — nothing else.
 *
 *  Scope, stated plainly because it is easy to assume otherwise: this retires
 *  the challenge (contestants stop seeing it, and it can no longer be
 *  submitted against — SUBMIT_SCRIPT's step 1 returns `missing` without the
 *  `flagnorm` row), but it deliberately does NOT touch contestant history.
 *  `ctf:classic:solves:<login>` / `ctf:classic:attempts:<login>` rows for the
 *  deleted id stay put, and the aggregate counters are not decremented — so
 *  points already banked for this challenge REMAIN on the leaderboard.
 *  Clearing banked points is the master reset's job (admin-store's
 *  `resetEvent`).
 *
 *  That's a deliberate contract, mirroring `deleteQuestion`: cascading a
 *  delete across every per-login hash plus aggregate decrements is a fan-out
 *  destructive write with no atomic story and no undo, and retiring a
 *  challenge is a far more common need than un-awarding points for it.
 *  Because the aggregates outlive the challenge, a login can hold more solves
 *  than the challenge list has entries — the leaderboard overlay clamps the
 *  "solved / total" denominator for exactly that reason. */
export async function deleteChallenge(id: string): Promise<void> {
  if (!CLASSIC_ID_RE.test(id)) throw new ClassicValidationError("id", `Invalid challenge id: ${id}`);
  const results = await upstashPipeline([
    ["HDEL", CHALLENGES_KEY, id],
    ["HDEL", FLAG_KEY, id],
    ["HDEL", FLAGNORM_KEY, id],
  ]);
  const failed = results.find((r) => r.error);
  if (failed) throw new Error(`Upstash HDEL failed: ${failed.error}`);
}

type Solve = { points: number; at: string };
type Attempt = { attempts: number; lastAt: string };

function extractSolve(v: Record<string, unknown>): Solve | null {
  if (typeof v.points !== "number" || typeof v.at !== "string") return null;
  return { points: v.points, at: v.at };
}

function extractAttempt(v: Record<string, unknown>): Attempt | null {
  if (typeof v.attempts !== "number" || typeof v.lastAt !== "string") return null;
  return { attempts: v.attempts, lastAt: v.lastAt };
}

function parseHashEntries<T>(flat: unknown, extract: (parsed: Record<string, unknown>) => T | null): Record<string, T> {
  const arr = Array.isArray(flat) ? (flat as string[]) : [];
  const out: Record<string, T> = {};
  for (let i = 0; i < arr.length; i += 2) {
    const value = parseJsonValue(arr[i + 1], extract);
    if (value !== null) out[arr[i]] = value;
  }
  return out;
}

/** Parses a single HGET reply (not a flat hash array) the same way
 *  `parseHashEntries` parses each row of one. */
function parseJsonValue<T>(raw: unknown, extract: (parsed: Record<string, unknown>) => T | null): T | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    return extract(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

export type ViewerClassic = {
  /** Solves only, keyed by challenge id. Points are what the challenge was
   *  worth AT SOLVE TIME, not what it is worth now. */
  solved: Record<string, Solve>;
};

/** A single caller's classic progress: which challenges they have solved, and
 *  for how many points each. One HGETALL against that login's solve hash —
 *  neither flag hash is touched. */
export async function getViewerClassic(login: string): Promise<ViewerClassic> {
  const [solvesRes] = await upstashPipeline([["HGETALL", solvesKey(login)]]);
  return { solved: parseHashEntries(solvesRes.result, extractSolve) };
}

function parseCounterHash(flat: unknown): Map<string, number> {
  const arr = Array.isArray(flat) ? (flat as string[]) : [];
  const out = new Map<string, number>();
  for (let i = 0; i < arr.length; i += 2) {
    const n = Number(arr[i + 1]);
    if (Number.isFinite(n)) out.set(arr[i], n);
  }
  return out;
}

/** How many DISTINCT logins have solved each challenge, keyed by challenge id
 *  — the "N solves" figure the board shows. One HGETALL, maintained
 *  atomically by SUBMIT_SCRIPT.
 *
 *  Distinct by construction, not by care: the script's already-solved guard
 *  runs before any write, so a login that resubmits a flag it already holds
 *  returns `already` without ever reaching the increment. */
export async function getSolveCounts(): Promise<Map<string, number>> {
  const [res] = await upstashPipeline([["HGETALL", SOLVECOUNT_KEY]]);
  return parseCounterHash(res.result);
}

/** One login's (or one team's) classic aggregate, as consumed by the
 *  leaderboard overlay. */
export type ClassicTotal = { points: number; solved: number; lastAt: string | null };

/** Per-login classic totals for every login that has solved at least one
 *  challenge — two HGETALLs (`ctf:classic:points`, `ctf:classic:solved`),
 *  maintained atomically by SUBMIT_SCRIPT alongside the per-login solve row.
 *  Cost is exactly two round trips regardless of how many logins are on the
 *  board.
 *
 *  `lastAt` is always `null`: neither aggregate hash carries a timestamp (only
 *  a running total), and reading the per-login solve hash to derive one would
 *  reintroduce the per-login cost this function exists to avoid. Callers fall
 *  back to whatever other activity timestamp they already have. */
export async function getClassicTotals(): Promise<Map<string, ClassicTotal>> {
  const [pointsRes, solvedRes] = await upstashPipeline([
    ["HGETALL", POINTS_KEY],
    ["HGETALL", SOLVED_KEY],
  ]);
  const points = parseCounterHash(pointsRes.result);
  const solved = parseCounterHash(solvedRes.result);

  const totals = new Map<string, ClassicTotal>();
  for (const login of new Set([...points.keys(), ...solved.keys()])) {
    totals.set(login, { points: points.get(login) ?? 0, solved: solved.get(login) ?? 0, lastAt: null });
  }
  return totals;
}

/** A TEAM's classic total is the UNION of challenges its members solved, never
 *  the sum of member aggregates — summing would double count any challenge two
 *  teammates both solved. The aggregates can't serve a team: they're running
 *  totals with no memory of WHICH challenges contributed, so there is no way
 *  to dedupe from them. Instead this reads each member's
 *  `ctf:classic:solves:<login>` hash directly and dedupes by challenge id,
 *  keeping the EARLIEST solve's stored points for any challenge two or more
 *  members hold (a later solve by a teammate — or a since-changed price
 *  recorded on someone else's row — never changes what the team already
 *  earned).
 *
 *  Exactly ONE `upstashPipeline` round trip for the whole board: one team's
 *  members per entry in `teams`, one `ClassicTotal` per entry out, in the same
 *  order. `/leaderboard` is dynamic and fetched `no-store`, so a per-team form
 *  would cost a 25-team event 25 REST calls on every single page view. A login
 *  on two teams is fetched ONCE and its reply reused for both, so the pipeline
 *  carries one HGETALL per DISTINCT member. */
export async function getTeamClassicTotalsBatch(
  teams: readonly (readonly string[])[],
): Promise<ClassicTotal[]> {
  const indexByLogin = new Map<string, number>();
  for (const members of teams) {
    for (const login of members) {
      if (!indexByLogin.has(login)) indexByLogin.set(login, indexByLogin.size);
    }
  }
  const logins = [...indexByLogin.keys()];
  if (logins.length === 0) return teams.map(() => ({ points: 0, solved: 0, lastAt: null }));

  const results = await upstashPipeline(logins.map((login) => ["HGETALL", solvesKey(login)]));
  return teams.map((members) => foldTeamSolves(members.map((login) => results[indexByLogin.get(login) ?? -1])));
}

/** The union-by-challenge fold. Keeps the EARLIEST solve for any challenge
 *  more than one member holds. */
function foldTeamSolves(memberReplies: ({ result?: unknown; error?: string } | undefined)[]): ClassicTotal {
  const byChallenge = new Map<string, Solve>();
  for (const res of memberReplies) {
    const flat = Array.isArray(res?.result) ? (res.result as string[]) : [];
    for (let i = 0; i < flat.length; i += 2) {
      const parsed = parseJsonValue(flat[i + 1], extractSolve);
      if (!parsed) continue;
      const challengeId = flat[i];
      const existing = byChallenge.get(challengeId);
      if (!existing || Date.parse(parsed.at) < Date.parse(existing.at)) {
        byChallenge.set(challengeId, parsed);
      }
    }
  }

  let points = 0;
  let lastAtMs = -Infinity;
  for (const { points: solvePoints, at } of byChallenge.values()) {
    points += solvePoints;
    const ms = Date.parse(at);
    if (Number.isFinite(ms) && ms > lastAtMs) lastAtMs = ms;
  }
  return {
    points,
    solved: byChallenge.size,
    lastAt: Number.isFinite(lastAtMs) ? new Date(lastAtMs).toISOString() : null,
  };
}

type ResolvedAdminSettings = Awaited<ReturnType<typeof getAdminSettings>>;

type ClassicGate =
  | { allowed: true }
  | { allowed: false; reason: "paused" | "solved" | "cooldown" | "unavailable"; retryAt?: string };

/** The submission gate, checked in this order (each short-circuits the rest):
 *    1. scoring paused, or outside the scheduled scoring window
 *    2. `login` has already solved this challenge
 *    3. `login` is still inside the cooldown since its last submission
 *
 *  `retryAt` is DERIVED from `lastAt + the CURRENT cooldown setting` on every
 *  call, never stored — so lowering the cooldown mid-event lifts a lock
 *  immediately instead of leaving it stale until some persisted unlock time
 *  catches up.
 *
 *  Two different failure directions, on purpose:
 *
 *  - The pause/schedule check fails OPEN. `settings` is `null` when the
 *    settings read itself failed, and a null reads as "not paused": a Redis
 *    blip must never silently drop a live submission. This mirrors the
 *    manual-freeze fail-open the scorer and sync poller implement.
 *  - The solve/attempt lookup fails CLOSED, with its OWN distinct reason,
 *    "unavailable" — deliberately NOT "cooldown" and never a claim about
 *    spent attempts. Misreporting an unverifiable lookup as a fact about a
 *    contestant's own attempts turns a transient blip into a support argument
 *    about a number nobody can check.
 *
 *  IMPORTANT: this is a cheap, NON-ATOMIC pre-check. It reads solves/attempts
 *  over its own separate round trip, so two concurrent submissions can both
 *  observe "not cooling" before either writes. SUBMIT_SCRIPT re-checks both
 *  the already-solved guard and the cooldown against state read fresh at
 *  script-execution time, and is what actually enforces them. */
async function evaluateGate(
  settings: ResolvedAdminSettings | null,
  login: string,
  challengeId: string,
  cooldownSec: number,
): Promise<ClassicGate> {
  if (settings && effectivePaused(settings)) return { allowed: false, reason: "paused" };

  let solve: Solve | null;
  let attempt: Attempt | null;
  try {
    const [solveRes, attemptRes] = await upstashPipeline([
      ["HGET", solvesKey(login), challengeId],
      ["HGET", attemptsKey(login), challengeId],
    ]);
    if (solveRes.error) throw new Error(solveRes.error);
    if (attemptRes.error) throw new Error(attemptRes.error);
    solve = parseJsonValue(solveRes.result, extractSolve);
    attempt = parseJsonValue(attemptRes.result, extractAttempt);
  } catch (err) {
    console.error("classic gate: solve/attempt lookup failed:", err);
    return { allowed: false, reason: "unavailable" };
  }

  if (solve) return { allowed: false, reason: "solved" };

  if (cooldownSec > 0 && attempt) {
    const lastMs = Date.parse(attempt.lastAt);
    if (Number.isFinite(lastMs)) {
      const retryAtMs = lastMs + cooldownSec * 1000;
      if (Date.now() < retryAtMs) {
        return { allowed: false, reason: "cooldown", retryAt: new Date(retryAtMs).toISOString() };
      }
    }
  }

  return { allowed: true };
}

// Grades one flag submission and records everything it changes atomically.
//
// This script — NOT the JS pre-check — is the authority on the cooldown. The
// pre-check reads over its own separate round trip, so two concurrent
// submissions can both observe "not cooling" before either writes. Redis runs
// one script to completion before starting the next, so each submission here
// sees every effect of every submission that finished before it.
//
//   1. HGET the normalized flag. Missing -> {'missing'} (bad/deleted id).
//   2. HEXISTS the solve row BEFORE any write -> {'already'}, nothing touched.
//      This guard is also what makes KEYS[6] (solvecount) distinct-by-
//      construction: a login can never increment it twice.
//   3. Read {attempts,lastAtMs} and re-check the cooldown WITHOUT WRITING.
//      The cooldown comes in as ARGV (the CURRENT admin setting, resolved by
//      the caller on every call — never a stored cutoff) and is combined with
//      the attempts row the script reads at execution time, never a value the
//      caller read earlier and handed in, which is what would let a race
//      bypass it.
//   4. Only past the check: spend an attempt (right or wrong).
//   5. Compare whole values with `==`. A flag routinely contains braces,
//      quotes and backslashes, so it is never pattern-matched out of a JSON
//      blob the way quiz's points are — the value IS the whole hash field.
//      And it is compared against ARGV[2], which the CALLER normalized with
//      the same `normalizeFlag` that produced the stored value. Nothing here
//      lowercases anything: Lua's `string.lower` is ASCII-only and would
//      disagree with the JS recipe on any non-ASCII flag, producing a
//      challenge nobody can solve.
//   6. Equal: read points, write the solve row, bump the three counters.
//
// The points match is anchored with a trailing [,}] so it can only match a
// complete "points":<int> pair, not a digit run appearing earlier in the blob.
const SUBMIT_SCRIPT = `
local target = redis.call('HGET', KEYS[3], ARGV[1])
if not target then return {'missing'} end
if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 1 then return {'already'} end

local cooldownMs = tonumber(ARGV[5])
local nowMs = tonumber(ARGV[6])

local attemptsRaw = redis.call('HGET', KEYS[1], ARGV[1])
local attempts = 0
local lastAtMs = nil
if attemptsRaw then
  local foundAttempts = string.match(attemptsRaw, '"attempts":(%d+)[,}]')
  if foundAttempts then attempts = tonumber(foundAttempts) end
  local foundLastAtMs = string.match(attemptsRaw, '"lastAtMs":(%d+)[,}]')
  if foundLastAtMs then lastAtMs = tonumber(foundLastAtMs) end
end

if cooldownMs > 0 and lastAtMs and nowMs < (lastAtMs + cooldownMs) then
  return {'cooldown', tostring(lastAtMs + cooldownMs)}
end

attempts = attempts + 1
redis.call('HSET', KEYS[1], ARGV[1], '{"attempts":' .. attempts .. ',"lastAt":"' .. ARGV[3] .. '","lastAtMs":' .. ARGV[6] .. '}')

if target ~= ARGV[2] then
  return {'incorrect', tostring(attempts)}
end

local cRaw = redis.call('HGET', KEYS[4], ARGV[1])
local points = 0
if cRaw then
  local found = string.match(cRaw, '"points":(%-?%d+)[,}]')
  if found then points = tonumber(found) end
end
redis.call('HSET', KEYS[2], ARGV[1], '{"points":' .. points .. ',"at":"' .. ARGV[3] .. '"}')
redis.call('HINCRBY', KEYS[5], ARGV[4], points)
redis.call('HINCRBY', KEYS[7], ARGV[4], 1)
redis.call('HINCRBY', KEYS[6], ARGV[1], 1)
return {'correct', tostring(points)}`;

export type SubmitResult =
  // `already` marks the idempotent re-submission of a flag this login had
  // ALREADY banked (SUBMIT_SCRIPT's step-2 guard). It is still a correct flag,
  // but `points` is 0 because this call awarded nothing further — NOT because
  // the challenge is worth nothing. Callers must render the two apart.
  | { ok: true; correct: true; points: number; already?: boolean }
  | { ok: true; correct: false }
  | { ok: false; reason: "paused" | "solved" | "cooldown"; retryAt?: string }
  // The gate's lookup itself failed (fail-closed), the submission was
  // malformed / named an unknown challenge, or the script blew up. Kept
  // distinct from the gate reasons above so a caller-facing message can say
  // the check couldn't be completed instead of stating a fact about the
  // contestant that was never established.
  | { ok: false; reason: "unavailable" | "invalid" | "error" };

/** Grades `flag` against `challengeId` for `login`, and on success records the
 *  solve, the running totals and the challenge's solve count — all in one
 *  atomic script.
 *
 *  The gate is checked BEFORE the script runs — a refused submission must
 *  never reach Redis's scoring path — but it is only a cheap pre-check;
 *  SUBMIT_SCRIPT re-checks the already-solved guard and the cooldown
 *  authoritatively (see its comment) using the CURRENT admin settings resolved
 *  by THIS call, so a race that slips past the pre-check is still caught,
 *  atomically, by the script.
 *
 *  Both sides of the comparison are normalized by `normalizeFlag` in JS: the
 *  authoring side when `upsertChallenge` writes `ctf:classic:flagnorm`, and
 *  this side before the value is ever handed to the script. That agreement is
 *  the whole design — see SUBMIT_SCRIPT step 5.
 *
 *  This function never returns the flag itself, only whether the submission
 *  was right. */
export async function submitFlag(login: string, challengeId: string, flag: string): Promise<SubmitResult> {
  if (!CLASSIC_ID_RE.test(challengeId)) return { ok: false, reason: "invalid" };
  if (typeof flag !== "string" || !flag.trim()) return { ok: false, reason: "invalid" };

  // Fails OPEN: if the settings read blows up we treat scoring as live rather
  // than dropping a submission a contestant is entitled to make. The cooldown
  // then falls back to the module default, which the script still enforces.
  let settings: ResolvedAdminSettings | null = null;
  try {
    settings = await getAdminSettings();
  } catch (err) {
    console.error("classic: admin settings read failed, treating scoring as live:", err);
  }
  const cooldownSec = settings?.classicCooldownSec ?? CLASSIC_COOLDOWN_SEC;

  const gate = await evaluateGate(settings, login, challengeId, cooldownSec);
  if (!gate.allowed) {
    // Kept as its own branch (not folded into the passthrough below) so its
    // caller-facing shape can never accidentally pick up a retryAt the lookup
    // never actually established.
    if (gate.reason === "unavailable") return { ok: false, reason: "unavailable" };
    return gate.retryAt
      ? { ok: false, reason: gate.reason, retryAt: gate.retryAt }
      : { ok: false, reason: gate.reason };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  // A duration in ms, recomputed from the SAME settings the pre-check used —
  // never a stored cutoff. The script combines it with the attempts row IT
  // reads at execution time.
  const cooldownMs = cooldownSec * 1000;

  let verdict: unknown;
  try {
    verdict = await upstashEval(
      SUBMIT_SCRIPT,
      [
        attemptsKey(login), // KEYS[1]
        solvesKey(login), // KEYS[2]
        FLAGNORM_KEY, // KEYS[3] — the normalized flag; ctf:classic:flag is
        //                          never handed to the script at all
        CHALLENGES_KEY, // KEYS[4]
        POINTS_KEY, // KEYS[5]
        SOLVECOUNT_KEY, // KEYS[6]
        SOLVED_KEY, // KEYS[7]
      ],
      [challengeId, normalizeFlag(flag), nowIso, login, cooldownMs, now.getTime()],
    );
  } catch (err) {
    console.error("Classic grading failed:", err);
    return { ok: false, reason: "error" };
  }

  const [status, value] = Array.isArray(verdict) ? (verdict as unknown[]) : [];
  if (status === "missing") return { ok: false, reason: "invalid" };
  if (status === "cooldown") {
    const retryAtMs = Number(value);
    return { ok: false, reason: "cooldown", retryAt: new Date(retryAtMs).toISOString() };
  }
  if (status === "incorrect") return { ok: true, correct: false };
  // Raced a prior correct submission past the gate's own read — already
  // banked, so this call awards nothing further, but it IS a correct flag.
  if (status === "already") return { ok: true, correct: true, points: 0, already: true };
  if (status === "correct") return { ok: true, correct: true, points: Number(value) || 0 };
  return { ok: false, reason: "error" };
}
