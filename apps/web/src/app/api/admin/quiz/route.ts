import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { ADMIN_AUDIT_KEY, AUDIT_CAP } from "@/lib/admin-store";
import { deleteQuestion, listQuestions, upsertQuestion, type Choice, type Question } from "@/lib/quiz-store";
import { upstashPipeline } from "@/lib/upstash";

/**
 * Organizer authoring surface for the quiz module: list (GET), create-or-
 * update (POST), and delete (DELETE) questions. Gated by `requireAdmin`
 * throughout; every write appends a line to the same `ctf:admin:audit`
 * trail `admin-store`'s settings/reset/seed writers use.
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
  if (typeof body.prompt !== "string" || body.prompt.length === 0) return null;
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
    prompt: body.prompt,
    type: body.type,
    choices,
    points: body.points,
    order: body.order,
    correct: body.correct as string[],
  };
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

  const questions = await listQuestions();
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
  try {
    await upsertQuestion(q, correct);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "upsert failed" }, { status: 400 });
  }

  await writeAudit(gate.login, "quiz-upsert", { questionId: q.id });
  return NextResponse.json({ question: q });
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
    return NextResponse.json({ error: err instanceof Error ? err.message : "delete failed" }, { status: 400 });
  }

  await writeAudit(gate.login, "quiz-delete", { questionId: id });
  return NextResponse.json({ ok: true });
}
