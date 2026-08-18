import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { answerQuestion } from "@/lib/quiz-store";

/** Question/choice ids look like "q1" or "sqli-basics" — mirrors
 *  quiz-store's own (private) id format so a malformed request is rejected
 *  here, before it ever reaches `answerQuestion`. Because of that, any
 *  `"invalid"` reason the store itself returns can only mean the question
 *  id doesn't exist (GRADE_SCRIPT's "missing" branch) — not a shape
 *  problem this route already ruled out — which is what lets this route
 *  tell "malformed" (400) apart from "unknown question" (404) even though
 *  the store reports both under the same reason string. */
const QUIZ_ID_RE = /^[\w-]{1,64}$/;

function isChoiceList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((c) => typeof c === "string" && QUIZ_ID_RE.test(c));
}

/**
 * Submits a graded answer for one quiz question.
 *
 * `answerQuestion` is authoritative on the attempt cap, cooldown, and
 * grading (its Lua script re-checks everything atomically) — this route
 * never re-implements or second-guesses that enforcement. It only derives
 * `login` from the session (never the request body) and maps the store's
 * result to a status code:
 *   - unauthenticated -> 401
 *   - session with no GitHub login -> 400
 *   - malformed questionId/choices -> 400
 *   - unknown/missing question -> 404
 *   - gate refusal (paused/answered/exhausted/cooldown/unavailable) -> 403
 *   - grading script failure -> 503
 *   - success -> 200
 *
 * No response from this route can ever reveal the correct choice ids:
 * `AnswerResult` (quiz-store's return type) never carries them, by
 * construction — there is no field here to leak.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const login = (session.user as { login?: string }).login;
  if (!login) return NextResponse.json({ error: "session has no GitHub login" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const questionId = typeof body.questionId === "string" ? body.questionId : "";
  const choices = body.choices;
  if (!QUIZ_ID_RE.test(questionId) || !isChoiceList(choices)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const result = await answerQuestion(login, questionId, choices);
  if (result.ok) {
    return NextResponse.json(result.correct ? { correct: true, points: result.points } : { correct: false });
  }

  if (result.reason === "invalid") {
    return NextResponse.json({ error: "question not found" }, { status: 404 });
  }
  if (result.reason === "error") {
    return NextResponse.json({ error: "quiz grading failed" }, { status: 503 });
  }
  // paused | answered | exhausted | cooldown | unavailable
  const retryAt = "retryAt" in result ? result.retryAt : undefined;
  return NextResponse.json(retryAt ? { error: result.reason, retryAt } : { error: result.reason }, { status: 403 });
}
