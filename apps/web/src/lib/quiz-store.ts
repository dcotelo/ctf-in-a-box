import "server-only";
import { effectivePaused, getAdminSettings } from "@/lib/admin-store";
import { upstashEval, upstashPipeline } from "@/lib/upstash";

/**
 * The quiz module. This file is the ONLY place that touches `ctf:quiz:*`
 * Redis keys — nothing else in the app should read or write them directly.
 *
 * Key layout:
 *   ctf:quiz:questions          hash, id -> JSON Question (public-safe; this
 *                                is what contestants see)
 *   ctf:quiz:key                hash, id -> JSON sorted array of correct
 *                                choice ids (SECRET — never returned by any
 *                                function a contestant-facing route can call)
 *   ctf:quiz:answers:<login>    hash, id -> JSON {choices, points, at} —
 *                                records ONLY correct answers. Points are
 *                                captured at answer time, so a later
 *                                re-pricing of a question never rewrites
 *                                history.
 *   ctf:quiz:attempts:<login>   hash, id -> JSON {attempts, lastAt} — every
 *                                attempt, right or wrong; Task 3's retry gate
 *                                reads this.
 *
 * Secrecy boundary: `ctf:quiz:key` mirrors how hint text lives in a
 * scorer-owned hash the app only ever reads, and how the scoring rubric
 * stays private. `listQuestions` never issues a command against
 * `ctf:quiz:key`, and the `Question` type has no field that could carry a
 * correct-answer id. Grading (which DOES need to read the key) is Task 3's
 * responsibility, added to this same file — kept server-only and never
 * exposed by a route that echoes its input back to the caller.
 *
 * The key ALWAYS stores a sorted JSON array of correct choice ids, even for
 * `"single"` questions (the one-element case) — so grading has one code
 * path for both question types, not two.
 *
 * Callers (the /api/quiz route handlers) are responsible for authenticating
 * the session and deriving `login` server-side — nothing here trusts
 * client-supplied identity.
 */

const QUESTIONS_KEY = "ctf:quiz:questions";
const KEY_KEY = "ctf:quiz:key";
const answersKey = (login: string) => `ctf:quiz:answers:${login}`;
const attemptsKey = (login: string) => `ctf:quiz:attempts:${login}`;
/** Running totals, updated atomically by the grading script alongside the
 *  per-login answer row — the same `ctf:hints:spent` trick, so a leaderboard
 *  overlay costs one HGETALL each regardless of board size. */
const POINTS_KEY = "ctf:quiz:points";
const ANSWERED_KEY = "ctf:quiz:answered";

/** Default cap on graded attempts per question before the retry gate
 *  refuses further submissions. 0 would mean unlimited (not the default). */
export const QUIZ_MAX_ATTEMPTS = 3;

/** Default cooldown, in minutes, after a login's last attempt on a question
 *  before it may try again. 0 would mean no cooldown (not the default). */
export const QUIZ_RETRY_AFTER_MIN = 5;

/** Question/choice ids look like "q1" or "sqli-basics" — reject anything
 *  weirder before it reaches Redis, mirroring hint-store's CHALLENGE_ID_RE. */
const QUIZ_ID_RE = /^[\w-]{1,64}$/;

export type QuestionType = "single" | "multi";

export type Choice = {
  id: string;
  label: string;
};

/** Public-safe question shape. Never carries the correct answer. */
export type Question = {
  id: string;
  prompt: string;
  type: QuestionType;
  choices: Choice[];
  points: number;
  order: number;
};

function isChoice(value: unknown): value is Choice {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Choice).id === "string" &&
    typeof (value as Choice).label === "string"
  );
}

function parseQuestion(raw: string): Question | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const q = parsed as Record<string, unknown>;
    if (typeof q.id !== "string") return null;
    if (typeof q.prompt !== "string") return null;
    if (q.type !== "single" && q.type !== "multi") return null;
    if (!Array.isArray(q.choices) || !q.choices.every(isChoice)) return null;
    if (typeof q.points !== "number") return null;
    if (typeof q.order !== "number") return null;
    return {
      id: q.id,
      prompt: q.prompt,
      type: q.type,
      choices: q.choices as Choice[],
      points: q.points,
      order: q.order,
    };
  } catch {
    return null;
  }
}

/** All quiz questions, ascending by `order` then `id`. Answer key excluded —
 *  this issues a single HGETALL against the public-safe hash only. */
export async function listQuestions(): Promise<Question[]> {
  const [res] = await upstashPipeline([["HGETALL", QUESTIONS_KEY]]);
  const flat = Array.isArray(res.result) ? (res.result as string[]) : [];
  const questions: Question[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    const parsed = parseQuestion(flat[i + 1]);
    if (parsed) questions.push(parsed);
  }
  questions.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return questions;
}

/** Creates or replaces a question and its correct-answer set. Writes the
 *  question (no answer) and the sorted key array (answer only, no prompt) in
 *  ONE pipeline call so the two hashes never observably disagree. */
export async function upsertQuestion(q: Question, correct: string[]): Promise<void> {
  if (!QUIZ_ID_RE.test(q.id)) throw new Error(`Invalid question id: ${q.id}`);
  for (const choice of q.choices) {
    if (!QUIZ_ID_RE.test(choice.id)) throw new Error(`Invalid choice id: ${choice.id}`);
  }
  const choiceIds = new Set(q.choices.map((c) => c.id));
  for (const id of correct) {
    if (!choiceIds.has(id)) throw new Error(`Correct choice id not among choices: ${id}`);
  }
  // A "single" question must have exactly one correct choice — with more
  // than one, the all-or-nothing grading rule could never be satisfied.
  if (q.type === "single" && correct.length !== 1) {
    throw new Error(`A "single" question must have exactly one correct choice, got ${correct.length}`);
  }
  const sortedCorrect = [...correct].sort();

  const results = await upstashPipeline([
    ["HSET", QUESTIONS_KEY, q.id, JSON.stringify(q)],
    ["HSET", KEY_KEY, q.id, JSON.stringify(sortedCorrect)],
  ]);
  const failed = results.find((r) => r.error);
  if (failed) throw new Error(`Upstash HSET failed: ${failed.error}`);
}

/** Removes a question and its answer key together. */
export async function deleteQuestion(id: string): Promise<void> {
  if (!QUIZ_ID_RE.test(id)) throw new Error(`Invalid question id: ${id}`);
  const results = await upstashPipeline([
    ["HDEL", QUESTIONS_KEY, id],
    ["HDEL", KEY_KEY, id],
  ]);
  const failed = results.find((r) => r.error);
  if (failed) throw new Error(`Upstash HDEL failed: ${failed.error}`);
}

export type ViewerQuiz = {
  /** Correct answers only, keyed by question id. */
  answered: Record<string, { points: number; at: string }>;
  /** Every attempt (right or wrong), keyed by question id. */
  attempts: Record<string, { attempts: number; lastAt: string }>;
};

function parseHashEntries<T>(flat: unknown, extract: (parsed: Record<string, unknown>) => T | null): Record<string, T> {
  const arr = Array.isArray(flat) ? (flat as string[]) : [];
  const out: Record<string, T> = {};
  for (let i = 0; i < arr.length; i += 2) {
    try {
      const parsed = JSON.parse(arr[i + 1]) as unknown;
      if (typeof parsed !== "object" || parsed === null) continue;
      const value = extract(parsed as Record<string, unknown>);
      if (value !== null) out[arr[i]] = value;
    } catch {
      // Skip unparseable rows.
    }
  }
  return out;
}

function extractAnswered(v: Record<string, unknown>): { points: number; at: string } | null {
  if (typeof v.points !== "number" || typeof v.at !== "string") return null;
  return { points: v.points, at: v.at };
}

function extractAttempt(v: Record<string, unknown>): { attempts: number; lastAt: string } | null {
  if (typeof v.attempts !== "number" || typeof v.lastAt !== "string") return null;
  return { attempts: v.attempts, lastAt: v.lastAt };
}

/** A single caller's quiz progress: correct answers earned (points/at only —
 *  the stored record's `choices` is answer-shaped and stays out of the
 *  viewer-facing shape) and every attempt made. Never touches the answer key
 *  hash. */
export async function getViewerQuiz(login: string): Promise<ViewerQuiz> {
  const [answeredRes, attemptsRes] = await upstashPipeline([
    ["HGETALL", answersKey(login)],
    ["HGETALL", attemptsKey(login)],
  ]);
  return {
    answered: parseHashEntries(answeredRes.result, extractAnswered),
    attempts: parseHashEntries(attemptsRes.result, extractAttempt),
  };
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

export type QuizGate =
  | { allowed: true }
  | {
      allowed: false;
      reason: "paused" | "answered" | "exhausted" | "cooldown";
      retryAt?: string;
      attemptsLeft?: number;
    };

/** Decides whether `login` may submit a graded answer for `questionId` right
 *  now. Checked in this order (each one short-circuits the rest):
 *    1. scoring paused, or outside the scheduled scoring window
 *    2. `login` already holds a correct answer for this question
 *    3. `login` has spent every attempt `quizMaxAttempts` allows
 *    4. `login` is still inside the `quizRetryAfterMin` cooldown since its
 *       last attempt
 *
 *  `retryAt` (cooldown reason) is DERIVED from `lastAt + quizRetryAfterMin`
 *  on every call, never stored — so lowering the cooldown mid-event lifts a
 *  lock immediately instead of leaving it stale until some persisted
 *  unlock time catches up.
 *
 *  Fails CLOSED: if the attempt/answer lookup itself errors, this refuses
 *  the answer (reported as "exhausted", the closest of the four reasons,
 *  since the true attempt count couldn't be verified) rather than grading
 *  against a lookup we couldn't trust. This is the OPPOSITE of the scoring
 *  freeze (`effectivePaused`), which fails open so a Redis blip never drops
 *  a live submission — here, the safe failure is "no attempt", not "grade a
 *  possibly-replayed answer". */
export async function quizGate(login: string, questionId: string): Promise<QuizGate> {
  const settings = await getAdminSettings();
  if (effectivePaused(settings)) return { allowed: false, reason: "paused" };

  const maxAttempts = settings.quizMaxAttempts ?? QUIZ_MAX_ATTEMPTS;
  const retryAfterMin = settings.quizRetryAfterMin ?? QUIZ_RETRY_AFTER_MIN;

  let answered: { points: number; at: string } | null;
  let attempt: { attempts: number; lastAt: string } | null;
  try {
    const [answeredRes, attemptRes] = await upstashPipeline([
      ["HGET", answersKey(login), questionId],
      ["HGET", attemptsKey(login), questionId],
    ]);
    if (answeredRes.error) throw new Error(answeredRes.error);
    if (attemptRes.error) throw new Error(attemptRes.error);
    answered = parseJsonValue(answeredRes.result, extractAnswered);
    attempt = parseJsonValue(attemptRes.result, extractAttempt);
  } catch (err) {
    console.error("quiz gate: attempt/answer lookup failed:", err);
    return { allowed: false, reason: "exhausted", attemptsLeft: 0 };
  }

  if (answered) return { allowed: false, reason: "answered" };

  const attemptsSoFar = attempt?.attempts ?? 0;
  if (maxAttempts > 0 && attemptsSoFar >= maxAttempts) {
    return { allowed: false, reason: "exhausted", attemptsLeft: 0 };
  }

  if (retryAfterMin > 0 && attempt) {
    const lastMs = Date.parse(attempt.lastAt);
    if (Number.isFinite(lastMs)) {
      const retryAtMs = lastMs + retryAfterMin * 60_000;
      if (Date.now() < retryAtMs) {
        return { allowed: false, reason: "cooldown", retryAt: new Date(retryAtMs).toISOString() };
      }
    }
  }

  return { allowed: true };
}

// Grades one submission and, on success, records everything it changes in a
// single atomic operation — mirroring hint-store.ts's REVEAL_SCRIPT, whose
// SADD-return-value idempotency guard is the pattern copied here as an
// HEXISTS guard, so a double-click (or two requests racing the gate above)
// can never double-award points or double-spend an attempt:
//
//   1. HGET the secret answer key for this question. Missing -> {'missing'}:
//      there is nothing to grade (the caller passed a bad/deleted id).
//   2. HEXISTS on the per-login answers hash for this question, BEFORE any
//      write. A hit means `login` already banked a correct answer here (a
//      race that slipped past the gate's own read) -> {'already'}, with
//      nothing else touched.
//   3. Every submission that reaches this point spends an attempt: read the
//      current {attempts,lastAt} blob (plain string matching, not a JSON
//      library — the field format is one this module fully controls), bump
//      the count, and HSET the new blob with `now`. This happens whether the
//      submission turns out right or wrong.
//   4. Compare the submitted sorted-JSON-array string against the stored
//      key, byte for byte (both sides are produced by the same
//      `[...ids].sort()` + `JSON.stringify` recipe, so equal sets serialize
//      identically regardless of submission order). Not equal -> {'incorrect'}.
//   5. Equal: HGET the question's current `points` (read at grading time, per
//      spec, rather than trusting a value the caller might have fetched
//      earlier), HSET the answer row, and HINCRBY the two aggregate
//      counters (`ctf:quiz:points`, `ctf:quiz:answered`) that the leaderboard
//      overlay reads later -> {'correct', points}.
const GRADE_SCRIPT = `
local key = redis.call('HGET', KEYS[3], ARGV[1])
if not key then return {'missing'} end
if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 1 then return {'already'} end

local attemptsRaw = redis.call('HGET', KEYS[1], ARGV[1])
local attempts = 0
if attemptsRaw then
  local found = string.match(attemptsRaw, '"attempts":(%d+)')
  if found then attempts = tonumber(found) end
end
attempts = attempts + 1
redis.call('HSET', KEYS[1], ARGV[1], '{"attempts":' .. attempts .. ',"lastAt":"' .. ARGV[3] .. '"}')

if key ~= ARGV[2] then
  return {'incorrect', tostring(attempts)}
end

local qRaw = redis.call('HGET', KEYS[4], ARGV[1])
local points = 0
if qRaw then
  local found = string.match(qRaw, '"points":([%-%d%.]+)')
  if found then points = tonumber(found) end
end
redis.call('HSET', KEYS[2], ARGV[1], '{"choices":' .. ARGV[2] .. ',"points":' .. points .. ',"at":"' .. ARGV[3] .. '"}')
redis.call('HINCRBY', KEYS[5], ARGV[4], points)
redis.call('HINCRBY', KEYS[6], ARGV[4], 1)
return {'correct', tostring(points)}`;

export type AnswerResult =
  | { ok: true; correct: true; points: number }
  | { ok: true; correct: false }
  | { ok: false; reason: "paused" | "answered" | "exhausted" | "cooldown"; retryAt?: string }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "error" };

/** Grades `choices` against `questionId` for `login`. All-or-nothing: the
 *  submitted set must equal the correct set exactly, order-insensitive — a
 *  partial set or a superset scores 0 (and still spends an attempt), the
 *  same as any other wrong answer. Single-choice is simply the one-element
 *  case of this same rule, not a separate path.
 *
 *  The retry gate (`quizGate`) is checked BEFORE the grading script runs —
 *  a refused answer must never reach Redis's scoring path — and this
 *  function never returns the answer key itself, only whether the
 *  submission was right. */
export async function answerQuestion(login: string, questionId: string, choices: string[]): Promise<AnswerResult> {
  if (!QUIZ_ID_RE.test(questionId)) return { ok: false, reason: "invalid" };
  if (
    !Array.isArray(choices) ||
    choices.length === 0 ||
    !choices.every((c) => typeof c === "string" && QUIZ_ID_RE.test(c))
  ) {
    return { ok: false, reason: "invalid" };
  }

  const gate = await quizGate(login, questionId);
  if (!gate.allowed) {
    return gate.retryAt
      ? { ok: false, reason: gate.reason, retryAt: gate.retryAt }
      : { ok: false, reason: gate.reason };
  }

  // Order-insensitive: dedupe then sort, exactly as `upsertQuestion` stores
  // the correct set, so an exact JSON-string match inside the script is a
  // valid stand-in for a set comparison.
  const submitted = JSON.stringify(Array.from(new Set(choices)).sort());
  const now = new Date().toISOString();

  let verdict: unknown;
  try {
    verdict = await upstashEval(
      GRADE_SCRIPT,
      [attemptsKey(login), answersKey(login), KEY_KEY, QUESTIONS_KEY, POINTS_KEY, ANSWERED_KEY],
      [questionId, submitted, now, login],
    );
  } catch (err) {
    console.error("Quiz grading failed:", err);
    return { ok: false, reason: "error" };
  }

  const [status, value] = Array.isArray(verdict) ? (verdict as unknown[]) : [];
  if (status === "missing") return { ok: false, reason: "invalid" };
  if (status === "incorrect") return { ok: true, correct: false };
  // Raced a prior correct submission past the gate's own read — already
  // banked, so this call awards nothing further, but it IS a correct answer.
  if (status === "already") return { ok: true, correct: true, points: 0 };
  if (status === "correct") return { ok: true, correct: true, points: Number(value) || 0 };
  return { ok: false, reason: "error" };
}
