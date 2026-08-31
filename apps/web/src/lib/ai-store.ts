import "server-only";
export { AI_COOLDOWN_SEC } from "./ai-defaults";

import { foldTeamItems } from "@/lib/leaderboard/team-fold";
import { generateSigningKey } from "@/lib/ai-token";
import { MARKDOWN_MAX } from "@/lib/markdown";
import { upstashPipeline } from "@/lib/upstash";
import {
  AI_CATEGORIES_KEY as CATEGORIES_KEY,
  AI_CATEGORIES_MAX,
  AI_CATEGORY_MAX_LEN,
  AI_CHALLENGES_KEY as CHALLENGES_KEY,
  AI_FLAG_KEY as FLAG_KEY,
  AI_FLAGNORM_KEY as FLAGNORM_KEY,
  AI_HINTS_KEY as HINTS_KEY,
  AI_HINT_MAX,
  AI_ID_RE,
  AI_POINTS_KEY as POINTS_KEY,
  AI_POINTS_MAX,
  AI_SIGNKEY_KEY as SIGNKEY_KEY,
  AI_SOLVECOUNT_KEY as SOLVECOUNT_KEY,
  AI_SOLVED_KEY as SOLVED_KEY,
  aiAttemptsKey as attemptsKey,
  aiSolvesKey as solvesKey,
  flagComparisonForm,
  isAiMode,
  validateUrlTemplate,
  type AiMode,
} from "@/lib/ai-keys";

/**
 * The ai (externally hosted AI/LLM challenge) module. This file is the only
 * place that touches `ctf:ai:*` during normal contestant and authoring
 * activity. The one documented exception, as in classic: `admin-store.ts`'s
 * demo seed and master reset reuse the key names from `ai-keys.ts` directly.
 *
 * Secrecy boundary — a CONTESTANT boundary, with FOUR secret hashes rather
 * than classic's three:
 *
 *   - `listAiChallenges` (CONTESTANT path) issues no command against
 *     `ctf:ai:flag`, `ctf:ai:flagnorm`, `ctf:ai:hints` or `ctf:ai:signkey`,
 *     and `AiChallenge` has no field any of them could ride in.
 *   - `listAiChallengesForAdmin` (behind `requireAdmin`) reads all four and
 *     returns them in an `AdminAiChallenge` shape that is deliberately NOT
 *     assignable to `AiChallenge`, so handing an admin row to a
 *     contestant-facing component is a compile error rather than a leak.
 *
 * `ctf:ai:signkey` is the most dangerous of the four. A flag lets its holder
 * claim one solve; a signing key lets its holder ASSERT solves on that
 * challenge for every player who has opened it. Treat any code path that could
 * carry it into a contestant payload as a critical bug.
 */

/** Public-safe challenge record. Never carries a flag, a hint or a key. */
export type AiChallenge = {
  id: string;
  title: string;
  category: string;
  description: string;
  points: number;
  order: number;
  /** Which solve paths are live for this challenge (see `AiMode`). PUBLIC:
   *  the page has to know whether to render a flag input at all. */
  mode: AiMode;
  /** The organizer's launch template, containing `{token}`. PUBLIC: it is
   *  rendered into an anchor the contestant clicks. */
  urlTemplate: string;
  /** Compare this challenge's flag with case intact. Absent means false —
   *  the forgiving default, same rule as classic. */
  caseSensitive?: boolean;
};

/** The ADMIN-gated surface: the public record and its three secrets, side by
 *  side but in SEPARATE fields. Not assignable to `AiChallenge` on purpose. */
export type AdminAiChallenge = {
  challenge: AiChallenge;
  /** The flag AS AUTHORED. Empty when the challenge is event-only, or when
   *  the row is missing — worth seeing in the edit form either way. */
  flag: string;
  hint: string | null;
  /** ADMIN SURFACES ONLY. Empty only for a record written before its key was
   *  minted, which the panel renders as "no key yet — rotate to mint one". */
  signingKey: string;
};

export class AiValidationError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "AiValidationError";
    this.field = field;
  }
}

function parseChallenge(raw: string): AiChallenge | null {
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
    // A record whose mode does not parse is DROPPED rather than defaulted: a
    // wrong default here would either hide a flag input the challenge needs or
    // offer one it cannot grade.
    if (!isAiMode(c.mode)) return null;
    if (typeof c.urlTemplate !== "string") return null;
    return {
      id: c.id,
      title: c.title,
      category: c.category,
      description: c.description,
      points: c.points,
      order: c.order,
      mode: c.mode,
      urlTemplate: c.urlTemplate,
      // Carried back only when stored true, mirroring how it is written.
      ...(c.caseSensitive === true ? { caseSensitive: true as const } : {}),
    };
  } catch {
    return null;
  }
}

/** Board reading order: cheapest first, then the organizer's `order`, then id
 *  as a stable tiebreak. Same rule as classic's. */
function compareChallenges(a: AiChallenge, b: AiChallenge): number {
  return a.points - b.points || a.order - b.order || a.id.localeCompare(b.id);
}

function parseChallengeHash(flat: unknown): AiChallenge[] {
  const arr = Array.isArray(flat) ? (flat as string[]) : [];
  const out: AiChallenge[] = [];
  for (let i = 0; i < arr.length; i += 2) {
    const parsed = parseChallenge(arr[i + 1]);
    if (parsed) out.push(parsed);
  }
  return out;
}

function hashToMap(flat: unknown): Map<string, string> {
  const arr = Array.isArray(flat) ? (flat as string[]) : [];
  const out = new Map<string, string>();
  for (let i = 0; i < arr.length; i += 2) {
    if (typeof arr[i + 1] === "string") out.set(arr[i], arr[i + 1]);
  }
  return out;
}

/** All ai challenges in board order. The ONLY list function a
 *  contestant-facing route or the leaderboard may call. */
export async function listAiChallenges(): Promise<AiChallenge[]> {
  const [res] = await upstashPipeline([["HGETALL", CHALLENGES_KEY]]);
  const challenges = parseChallengeHash(res.result);
  challenges.sort(compareChallenges);
  return challenges;
}

/** The same list WITH each challenge's flag, hint and signing key — for the
 *  `requireAdmin`-gated authoring surface ONLY. All four hashes in one
 *  pipeline, so they come from the same instant. */
export async function listAiChallengesForAdmin(): Promise<AdminAiChallenge[]> {
  const [challengesRes, flagRes, hintRes, keyRes] = await upstashPipeline([
    ["HGETALL", CHALLENGES_KEY],
    ["HGETALL", FLAG_KEY],
    ["HGETALL", HINTS_KEY],
    ["HGETALL", SIGNKEY_KEY],
  ]);
  const flagById = hashToMap(flagRes.result);
  const hintById = hashToMap(hintRes.result);
  const keyById = hashToMap(keyRes.result);

  const rows = parseChallengeHash(challengesRes.result).map((challenge) => ({
    challenge,
    flag: flagById.get(challenge.id) ?? "",
    hint: hintById.get(challenge.id) ?? null,
    signingKey: keyById.get(challenge.id) ?? "",
  }));
  rows.sort((a, b) => compareChallenges(a.challenge, b.challenge));
  return rows;
}

/** The organizer's category display order. Absent or unparseable reads as an
 *  empty list — a board with no categories yet, not an error. */
export async function listAiCategories(): Promise<string[]> {
  const [res] = await upstashPipeline([["GET", CATEGORIES_KEY]]);
  if (typeof res.result !== "string") return [];
  try {
    const parsed = JSON.parse(res.result) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is string => typeof n === "string");
  } catch {
    return [];
  }
}

/** How the solve was earned. `flag` is the default for any row written before
 *  this field existed. */
export type AiSolveSource = "flag" | "event";
type Solve = { points: number; at: string; source: AiSolveSource };
type Attempt = { attempts: number; lastAt: string };

function extractSolve(v: Record<string, unknown>): Solve | null {
  if (typeof v.points !== "number" || typeof v.at !== "string") return null;
  return { points: v.points, at: v.at, source: v.source === "event" ? "event" : "flag" };
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

export type ViewerAi = {
  solved: Record<string, Solve>;
  attempts: Record<string, Attempt>;
};

/** One caller's ai progress. Two HGETALLs in one pipeline against that login's
 *  own hashes — no secret key is touched. */
export async function getViewerAi(login: string): Promise<ViewerAi> {
  const [solvesRes, attemptsRes] = await upstashPipeline([
    ["HGETALL", solvesKey(login)],
    ["HGETALL", attemptsKey(login)],
  ]);
  return {
    solved: parseHashEntries(solvesRes.result, extractSolve),
    attempts: parseHashEntries(attemptsRes.result, extractAttempt),
  };
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

/** Distinct solvers per challenge — distinct by construction, because
 *  AWARD_SCRIPT's already-solved guard runs before any increment. */
export async function getAiSolveCounts(): Promise<Map<string, number>> {
  const [res] = await upstashPipeline([["HGETALL", SOLVECOUNT_KEY]]);
  return parseCounterHash(res.result);
}

export type AiTotal = { points: number; solved: number; lastAt: string | null };

/** Per-login totals off the two aggregate hashes: two round trips regardless
 *  of board size. `lastAt` is always null — neither aggregate carries a
 *  timestamp, and deriving one would reintroduce the per-login cost this
 *  function exists to avoid. */
export async function getAiTotals(): Promise<Map<string, AiTotal>> {
  const [pointsRes, solvedRes] = await upstashPipeline([
    ["HGETALL", POINTS_KEY],
    ["HGETALL", SOLVED_KEY],
  ]);
  const points = parseCounterHash(pointsRes.result);
  const solved = parseCounterHash(solvedRes.result);

  const totals = new Map<string, AiTotal>();
  for (const login of new Set([...points.keys(), ...solved.keys()])) {
    totals.set(login, { points: points.get(login) ?? 0, solved: solved.get(login) ?? 0, lastAt: null });
  }
  return totals;
}

/** A TEAM's total is the UNION of challenges its members solved, never the sum
 *  of member aggregates — summing double counts a challenge two teammates both
 *  solved, and the aggregates have no memory of WHICH challenges contributed.
 *  One pipeline for the whole board; a login on two teams is fetched once. */
export async function getTeamAiTotalsBatch(teams: readonly (readonly string[])[]): Promise<AiTotal[]> {
  const indexByLogin = new Map<string, number>();
  for (const members of teams) {
    for (const login of members) {
      if (!indexByLogin.has(login)) indexByLogin.set(login, indexByLogin.size);
    }
  }
  const logins = [...indexByLogin.keys()];
  if (logins.length === 0) return teams.map(() => ({ points: 0, solved: 0, lastAt: null }));

  const results = await upstashPipeline(logins.map((login) => ["HGETALL", solvesKey(login)]));
  return teams.map((members) => {
    const { points, completed, lastAt } = foldTeamItems(members.map((login) => results[indexByLogin.get(login) ?? -1]));
    return { points, solved: completed, lastAt };
  });
}

/** Replaces the category list. Names are trimmed and deduped, and ORDER IS
 *  CONTENT — it is the order the board renders headings in, which is why this
 *  is one JSON array in a string key rather than a Redis set. */
export async function setAiCategories(names: string[]): Promise<string[]> {
  if (!Array.isArray(names)) throw new AiValidationError("categories", "Categories must be a list");
  const cleaned: string[] = [];
  for (const raw of names) {
    if (typeof raw !== "string") throw new AiValidationError("categories", "Category names must be strings");
    const name = raw.trim();
    if (!name) continue;
    if (name.length > AI_CATEGORY_MAX_LEN) {
      throw new AiValidationError("categories", `Category names must be at most ${AI_CATEGORY_MAX_LEN} characters`);
    }
    if (!cleaned.includes(name)) cleaned.push(name);
  }
  if (cleaned.length > AI_CATEGORIES_MAX) {
    throw new AiValidationError("categories", `At most ${AI_CATEGORIES_MAX} categories`);
  }
  const [res] = await upstashPipeline([["SET", CATEGORIES_KEY, JSON.stringify(cleaned)]]);
  if (res.error) throw new Error(`Upstash SET failed: ${res.error}`);
  return cleaned;
}

export type AiUpsertSecrets = { flag?: string; hint?: string | null };

/** Creates or updates one challenge, and guarantees it has a signing key.
 *
 *  The key is minted ONLY when the challenge has none. An edit must never
 *  rotate silently: the organizer has already pasted that key into an external
 *  system, and a rename that invalidated it would break a live integration
 *  with no message anywhere saying why. Rotation is its own explicit call.
 *
 *  A `mode: "event"` challenge stores no flag at all — both flag hashes are
 *  DELETED rather than left holding a stale value that a later mode change
 *  would silently resurrect. */
export async function upsertAiChallenge(c: AiChallenge, secrets: AiUpsertSecrets = {}): Promise<AdminAiChallenge> {
  if (!AI_ID_RE.test(c.id)) throw new AiValidationError("id", `Invalid challenge id: ${c.id}`);
  if (typeof c.title !== "string" || !c.title.trim()) {
    throw new AiValidationError("title", "Challenge title is required");
  }
  if (!isAiMode(c.mode)) throw new AiValidationError("mode", `Unknown mode: ${String(c.mode)}`);

  const categories = await listAiCategories();
  if (!categories.includes(c.category)) {
    throw new AiValidationError("category", `Unknown category: ${c.category}`);
  }
  if (typeof c.description !== "string" || c.description.length > MARKDOWN_MAX) {
    throw new AiValidationError("description", `Description must be at most ${MARKDOWN_MAX} characters`);
  }
  // Points are read back INSIDE AWARD_SCRIPT by matching a plain integer — a
  // non-integer would either silently award 0 or corrupt HINCRBY mid-script,
  // after the solve row had already been written, with no way to roll back.
  if (!Number.isInteger(c.points) || c.points < 0 || c.points > AI_POINTS_MAX) {
    throw new AiValidationError("points", `Challenge points must be an integer in [0, ${AI_POINTS_MAX}]`);
  }

  const template = validateUrlTemplate(c.urlTemplate);
  if (!template.ok) throw new AiValidationError("urlTemplate", template.reason);

  const graded = c.mode !== "event";
  const flag = typeof secrets.flag === "string" ? secrets.flag.trim() : "";
  if (graded && !flag) {
    throw new AiValidationError("flag", "A flag is required unless the challenge is event-only");
  }
  const hint = secrets.hint;
  if (hint != null && (typeof hint !== "string" || hint.length > AI_HINT_MAX)) {
    throw new AiValidationError("hint", `Hint must be at most ${AI_HINT_MAX} characters`);
  }
  const authoredHint = typeof hint === "string" && hint.trim() ? hint.trim() : null;

  // Minting a key is a check-then-act, so it has to be done with an atomic
  // HSETNX rather than a separate HGET-then-HSET: two concurrent creates (or
  // edits of a legacy keyless row) could otherwise both observe "no key yet"
  // and each mint a different key, with the later write winning silently —
  // the losing caller would return a key that was never persisted, exactly
  // the broken-integration failure mode this function exists to prevent.
  // HSETNX either plants the candidate (fresh row) or is a no-op (a key
  // already exists); the follow-up HGET in the SAME pipeline reads back
  // whichever key actually won, so every racer converges on one value.
  const candidateKey = generateSigningKey();
  const [, effectiveKeyRes] = await upstashPipeline([
    ["HSETNX", SIGNKEY_KEY, c.id, candidateKey],
    ["HGET", SIGNKEY_KEY, c.id],
  ]);
  const signingKey = typeof effectiveKeyRes.result === "string" && effectiveKeyRes.result
    ? effectiveKeyRes.result
    : candidateKey;

  const record: AiChallenge = { ...c, urlTemplate: template.value };
  const results = await upstashPipeline([
    ["HSET", CHALLENGES_KEY, c.id, JSON.stringify(record)],
    graded ? ["HSET", FLAG_KEY, c.id, flag] : ["HDEL", FLAG_KEY, c.id],
    graded
      ? ["HSET", FLAGNORM_KEY, c.id, flagComparisonForm(flag, c.caseSensitive)]
      : ["HDEL", FLAGNORM_KEY, c.id],
    authoredHint ? ["HSET", HINTS_KEY, c.id, authoredHint] : ["HDEL", HINTS_KEY, c.id],
    ["HSET", SIGNKEY_KEY, c.id, signingKey],
  ]);
  const failed = results.find((r) => r.error);
  if (failed) throw new Error(`Upstash HSET failed: ${failed.error}`);

  return { challenge: record, flag: graded ? flag : "", hint: authoredHint, signingKey };
}

/** Mints a NEW signing key for an existing challenge. The old key stops
 *  working immediately — there is no grace window, so the panel warns before
 *  calling this. Refuses on an unknown challenge rather than creating an
 *  orphan key row nothing will ever read. */
export async function rotateAiSigningKey(id: string): Promise<string> {
  if (!AI_ID_RE.test(id)) throw new AiValidationError("id", `Invalid challenge id: ${id}`);
  const [existing] = await upstashPipeline([["HGET", CHALLENGES_KEY, id]]);
  if (typeof existing.result !== "string") {
    throw new AiValidationError("id", `Unknown challenge: ${id}`);
  }
  const key = generateSigningKey();
  const [res] = await upstashPipeline([["HSET", SIGNKEY_KEY, id, key]]);
  if (res.error) throw new Error(`Upstash HSET failed: ${res.error}`);
  return key;
}

/** Deletes a challenge and every secret hanging off it. A swallowed error here
 *  would leave a live signing key for a challenge nobody can see, so failures
 *  are surfaced rather than ignored. Solve rows are deliberately NOT rewritten
 *  — history keeps what it earned, exactly as classic's delete does. */
export async function deleteAiChallenge(id: string): Promise<void> {
  if (!AI_ID_RE.test(id)) throw new AiValidationError("id", `Invalid challenge id: ${id}`);
  const results = await upstashPipeline([
    ["HDEL", CHALLENGES_KEY, id],
    ["HDEL", FLAG_KEY, id],
    ["HDEL", FLAGNORM_KEY, id],
    ["HDEL", HINTS_KEY, id],
    ["HDEL", SIGNKEY_KEY, id],
    ["HDEL", SOLVECOUNT_KEY, id],
  ]);
  const failed = results.find((r) => r.error);
  if (failed) throw new Error(`Upstash HDEL failed: ${failed.error}`);
}

/** Wipes the whole ai catalogue — the destructive replace-all path used by the
 *  master reset. Surfaces per-command errors for the same reason as above. */
export async function clearAiChallenges(): Promise<void> {
  const results = await upstashPipeline([
    ["DEL", CHALLENGES_KEY],
    ["DEL", FLAG_KEY],
    ["DEL", FLAGNORM_KEY],
    ["DEL", HINTS_KEY],
    ["DEL", SIGNKEY_KEY],
    ["DEL", CATEGORIES_KEY],
    ["DEL", SOLVECOUNT_KEY],
  ]);
  const failed = results.find((r) => r.error);
  if (failed) throw new Error(`Upstash DEL failed: ${failed.error}`);
}
