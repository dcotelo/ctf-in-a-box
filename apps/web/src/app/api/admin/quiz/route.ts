import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { ADMIN_AUDIT_KEY, AUDIT_CAP } from "@/lib/admin-store";
import {
  deleteQuestion,
  listQuestionsForAdmin,
  QuizValidationError,
  upsertQuestion,
  type AdminQuestion,
  type Choice,
  type Question,
} from "@/lib/quiz-store";
import { upstashPipeline } from "@/lib/upstash";

/**
 * Organizer authoring surface for the quiz module: list (GET), create-or-
 * update (POST), and delete (DELETE) questions. Gated by `requireAdmin`
 * throughout; every write appends a line to the same `ctf:admin:audit`
 * trail `admin-store`'s settings/reset/seed writers use.
 *
 * This is the one surface that may return the answer key. GET calls
 * `listQuestionsForAdmin()`, so each row carries `{ question, correct }` and
 * the edit form can prefill which choices are currently right — an organizer
 * fixing a typo must not have to re-pick the answer from memory and risk
 * silently redefining it for every contestant. That is sound precisely
 * because `requireAdmin` runs FIRST, before any store read: anyone past it
 * can already rewrite or delete the answer outright. The contestant path is
 * untouched and stays keyless — `/quiz` calls `listQuestions()`, which never
 * reads `ctf:quiz:key` at all.
 *
 * The POST payload is runtime-shape-checked field by field, rejecting any
 * key it doesn't explicitly allow, BEFORE it ever reaches `upsertQuestion`.
 * This matters because TypeScript only rejects excess properties on object
 * LITERALS, not on parsed JSON — without this check, a crafted request body
 * could smuggle an extra key (e.g. a `points` field on a choice object)
 * straight through to the store, and `upsertQuestion`/GRADE_SCRIPT would
 * have no way to know that value wasn't meant to be there. `parseChoice`
 * and `parseQuestionPayload` below are the guard: unknown keys, wrong
 * types, or missing fields on the question OR any of its choices all fail
 * closed with a 400, never a partially-trusted write.
 */

type ChoicePayload = Choice;
type QuestionPayload = {
  id: string;
  prompt: string;
  type: "single" | "multi";
  choices: ChoicePayload[];
  points: number;
  order: number;
  correct: string[];
};

const QUESTION_KEYS = new Set(["id", "prompt", "type", "choices", "points", "order", "correct"]);
const CHOICE_KEYS = new Set(["id", "label"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasOnlyKeys(obj: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(obj).every((k) => allowed.has(k));
}

function parseChoice(v: unknown): ChoicePayload | null {
  if (!isPlainObject(v) || !hasOnlyKeys(v, CHOICE_KEYS)) return null;
  if (typeof v.id !== "string" || v.id.length === 0) return null;
  if (typeof v.label !== "string" || v.label.length === 0) return null;
  return { id: v.id, label: v.label };
}

function parseQuestionPayload(body: unknown): QuestionPayload | null {
  if (!isPlainObject(body) || !hasOnlyKeys(body, QUESTION_KEYS)) return null;
  if (typeof body.id !== "string" || body.id.length === 0) return null;
  // TRIMMED, not merely non-empty, and stored trimmed. A whitespace-only
  // prompt is empty for every consumer that trims it later, and one of those
  // consumers is a safety gate: the delete confirmation's required phrase is
  // the trimmed prompt, and `ConfirmModal` reads an empty `requireType` as
  // "no phrase required" — so a question with a blank prompt would delete on
  // a single click with no type-to-confirm at all. `upsertQuestion` validates
  // the id, the choices and the points but never the prompt, so this boundary
  // is the only place that catches it. Fixed here, once, rather than by
  // teaching the modal about a value it should never have been handed.
  if (typeof body.prompt !== "string" || body.prompt.trim().length === 0) return null;
  if (body.type !== "single" && body.type !== "multi") return null;
  if (typeof body.points !== "number" || !Number.isInteger(body.points) || body.points < 0) return null;
  if (typeof body.order !== "number" || !Number.isInteger(body.order)) return null;
  if (!Array.isArray(body.choices) || body.choices.length === 0) return null;
  const choices: ChoicePayload[] = [];
  for (const raw of body.choices) {
    const choice = parseChoice(raw);
    if (!choice) return null;
    choices.push(choice);
  }
  if (!Array.isArray(body.correct) || body.correct.length === 0) return null;
  if (!body.correct.every((c) => typeof c === "string")) return null;
  return {
    id: body.id,
    prompt: body.prompt.trim(),
    type: body.type,
    choices,
    points: body.points,
    order: body.order,
    correct: body.correct as string[],
  };
}

/** Maps an error thrown by `upsertQuestion`/`deleteQuestion` to a response:
 *  a `QuizValidationError` means the caller's payload was genuinely bad
 *  (bad id/choice format, non-integer points, a `correct` id not among the
 *  choices, wrong arity) -> 400 with the message. Anything else is the
 *  store's own plain `Error` for a real Upstash/infra failure -> 503, so an
 *  organizer is never told "bad request" for a problem that was never
 *  theirs to fix (the same principle `quiz-store`'s fail-closed gate
 *  lookup already applies on the contestant side). */
function errorResponse(err: unknown): Response {
  if (err instanceof QuizValidationError) {
    return NextResponse.json({ error: err.message, field: err.field }, { status: 400 });
  }
  console.error("[admin/quiz] store write failed", err);
  return NextResponse.json({ error: "quiz store write failed" }, { status: 503 });
}

/** Appends one audit line, mirroring admin-store's LPUSH+LTRIM pattern.
 *  Best-effort: an audit-write failure is logged but never fails a request
 *  whose actual data write already succeeded. */
async function writeAudit(actor: string, action: string, detail: Record<string, unknown>): Promise<void> {
  const audit = JSON.stringify({ at: new Date().toISOString(), by: actor, action, ...detail });
  try {
    await upstashPipeline([
      ["LPUSH", ADMIN_AUDIT_KEY, audit],
      ["LTRIM", ADMIN_AUDIT_KEY, 0, AUDIT_CAP - 1],
    ]);
  } catch (err) {
    console.error("[admin/quiz] audit write failed", err);
  }
}

export async function GET(request: Request) {
  const gate = await requireAdmin(request.headers);
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  // Admin-gated, so this may carry the key — see the header comment. The
  // `requireAdmin` check above must stay the first statement in this
  // handler: with the key in the payload, an early store read on an
  // unauthenticated request is no longer merely wasted work.
  const questions = await listQuestionsForAdmin();
  return NextResponse.json({ questions });
}

export async function POST(request: Request) {
  const gate = await requireAdmin(request.headers);
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  const body = await request.json().catch(() => null);
  const parsed = parseQuestionPayload(body);
  if (!parsed) return NextResponse.json({ error: "invalid question payload" }, { status: 400 });

  const { correct, ...question } = parsed;
  const q: Question = question;
  let saved: AdminQuestion;
  try {
    saved = await upsertQuestion(q, correct);
  } catch (err) {
    return errorResponse(err);
  }

  await writeAudit(gate.login, "quiz-upsert", { questionId: q.id });
  // Echoes the STORED correct set (deduped and sorted by `upsertQuestion`),
  // not the raw payload, so the authoring client's list matches what a
  // subsequent GET would return rather than drifting from it.
  return NextResponse.json({ question: saved.question, correct: saved.correct });
}

export async function DELETE(request: Request) {
  const gate = await requireAdmin(request.headers);
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  const body = await request.json().catch(() => ({}));
  const id = typeof (body as { id?: unknown }).id === "string" ? (body as { id: string }).id : "";
  if (!id) return NextResponse.json({ error: "invalid question id" }, { status: 400 });

  try {
    await deleteQuestion(id);
  } catch (err) {
    return errorResponse(err);
  }

  await writeAudit(gate.login, "quiz-delete", { questionId: id });
  return NextResponse.json({ ok: true });
}
