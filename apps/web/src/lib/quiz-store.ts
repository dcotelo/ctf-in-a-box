import "server-only";
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
 */

const QUESTIONS_KEY = "ctf:quiz:questions";
const KEY_KEY = "ctf:quiz:key";
const answersKey = (login: string) => `ctf:quiz:answers:${login}`;
const attemptsKey = (login: string) => `ctf:quiz:attempts:${login}`;

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
