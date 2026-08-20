// Route-level tests for the quiz API: the contestant answer route and the
// admin authoring route. Auth guard, quiz-store, and the Upstash pipeline
// (used only for the admin route's audit write) are all mocked — no Redis
// or GitHub session needed.
//
// login is ALWAYS derived from the session server-side for the contestant
// route; the admin route is gated by requireAdmin and shape-checks its
// payload before ever calling upsertQuestion.
//
// The correct-answer key reaches exactly ONE of these routes, and only past
// its gate. The contestant answer route can never carry it — `answerQuestion`
// has no field for it — while `GET /api/admin/quiz` returns it deliberately,
// so the organizer's edit form can prefill which choices are already correct.
// Both halves are pinned below, and the refusal cases assert on the response
// BODY, not just the status: a wrong status with a real payload attached
// would still be the leak.

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSession,
  requireAdmin,
  requireGatePassed,
  answerQuestion,
  listQuestions,
  listQuestionsForAdmin,
  upsertQuestion,
  deleteQuestion,
  upstashPipeline,
  QUIZ_ID_RE,
  QuizValidationError,
} = vi.hoisted(() => {
  // A real (not mocked) QuizValidationError, so `err instanceof
  // QuizValidationError` in the admin route sees the exact same class the
  // test constructs errors with — that's what makes the 400-vs-503 split
  // testable at all.
  class QuizValidationError extends Error {
    field: string;
    constructor(field: string, message: string) {
      super(message);
      this.name = "QuizValidationError";
      this.field = field;
    }
  }
  return {
    getSession: vi.fn(),
    requireAdmin: vi.fn(),
    requireGatePassed: vi.fn(),
    answerQuestion: vi.fn(),
    listQuestions: vi.fn(),
    listQuestionsForAdmin: vi.fn(),
    upsertQuestion: vi.fn(),
    deleteQuestion: vi.fn(),
    upstashPipeline: vi.fn(),
    QUIZ_ID_RE: /^[\w-]{1,64}$/,
    QuizValidationError,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin }));
vi.mock("@/lib/gate", () => ({ requireGatePassed }));
vi.mock("@/lib/quiz-store", () => ({
  answerQuestion,
  listQuestions,
  listQuestionsForAdmin,
  upsertQuestion,
  deleteQuestion,
  QUIZ_ID_RE,
  QuizValidationError,
}));
vi.mock("@/lib/admin-store", () => ({ ADMIN_AUDIT_KEY: "ctf:admin:audit", AUDIT_CAP: 500 }));
vi.mock("@/lib/upstash", () => ({ upstashPipeline }));

import { POST as answerPOST } from "@/app/api/quiz/answer/route";
import { GET as adminGET, POST as adminPOST, DELETE as adminDELETE } from "@/app/api/admin/quiz/route";

const answerReq = (body?: unknown) =>
  new Request("http://x/api/quiz/answer", { method: "POST", body: JSON.stringify(body ?? {}) });

const adminReq = (method: "GET" | "POST" | "DELETE", body?: unknown) =>
  new Request("http://x/api/admin/quiz", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const SESSION = { user: { login: "alice" } };

const QUESTION = {
  id: "q1",
  prompt: "2+2?",
  type: "single" as const,
  choices: [
    { id: "opt-wrong", label: "Three" },
    { id: "opt-right", label: "Four" },
  ],
  points: 10,
  order: 1,
};

const CREATE_PAYLOAD = { ...QUESTION, correct: ["opt-right"] };

/** What `listQuestionsForAdmin`/`upsertQuestion` hand back: the public-safe
 *  record and its correct set, in two separate fields. */
const ADMIN_ROW = { question: QUESTION, correct: ["opt-right"] };

beforeEach(() => {
  getSession.mockReset();
  requireAdmin.mockReset();
  requireGatePassed.mockReset();
  answerQuestion.mockReset();
  listQuestions.mockReset();
  listQuestionsForAdmin.mockReset();
  upsertQuestion.mockReset();
  deleteQuestion.mockReset();
  upstashPipeline.mockReset();
  getSession.mockResolvedValue(SESSION);
  requireAdmin.mockResolvedValue({ ok: true, login: "alice" });
  requireGatePassed.mockResolvedValue(true);
  upstashPipeline.mockResolvedValue([{ result: 1 }, { result: "OK" }]);
});

describe("POST /api/quiz/answer", () => {
  it("401 for no session", async () => {
    getSession.mockResolvedValue(null);
    const res = await answerPOST(answerReq({ questionId: "q1", choices: ["b"] }));
    expect(res.status).toBe(401);
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it("400 for a session with no GitHub login", async () => {
    getSession.mockResolvedValue({ user: {} });
    const res = await answerPOST(answerReq({ questionId: "q1", choices: ["b"] }));
    expect(res.status).toBe(400);
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it("403s with { error: \"gate\" } while the pre-event gate is active, without touching the store", async () => {
    requireGatePassed.mockResolvedValue(false);
    const res = await answerPOST(answerReq({ questionId: "q1", choices: ["b"] }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "gate" });
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it("proceeds normally with a gate cookie that verifies (gate active, valid unlock)", async () => {
    requireGatePassed.mockResolvedValue(true);
    answerQuestion.mockResolvedValue({ ok: true, correct: true, points: 10 });
    const res = await answerPOST(answerReq({ questionId: "q1", choices: ["b"] }));
    expect(res.status).toBe(200);
    expect(answerQuestion).toHaveBeenCalledWith("alice", "q1", ["b"]);
  });

  it("proceeds normally when the gate is inactive (requireGatePassed short-circuits true) — the common case", async () => {
    requireGatePassed.mockResolvedValue(true);
    answerQuestion.mockResolvedValue({ ok: true, correct: false });
    const res = await answerPOST(answerReq({ questionId: "q1", choices: ["b"] }));
    expect(res.status).toBe(200);
    expect(answerQuestion).toHaveBeenCalled();
  });

  it("400 for malformed input (missing choices)", async () => {
    const res = await answerPOST(answerReq({ questionId: "q1" }));
    expect(res.status).toBe(400);
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it("400 for malformed input (empty questionId)", async () => {
    const res = await answerPOST(answerReq({ questionId: "", choices: ["b"] }));
    expect(res.status).toBe(400);
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it("derives login from the session, never the request body", async () => {
    answerQuestion.mockResolvedValue({ ok: true, correct: false });
    await answerPOST(answerReq({ questionId: "q1", choices: ["b"], login: "mallory" }));
    expect(answerQuestion).toHaveBeenCalledWith("alice", "q1", ["b"]);
  });

  it("404 for an unknown/missing question", async () => {
    answerQuestion.mockResolvedValue({ ok: false, reason: "invalid" });
    const res = await answerPOST(answerReq({ questionId: "q404", choices: ["b"] }));
    expect(res.status).toBe(404);
  });

  it("503 when the grading script itself fails", async () => {
    answerQuestion.mockResolvedValue({ ok: false, reason: "error" });
    const res = await answerPOST(answerReq({ questionId: "q1", choices: ["b"] }));
    expect(res.status).toBe(503);
  });

  it.each(["paused", "answered", "exhausted", "unavailable"] as const)(
    "403 with the reason for a %s gate refusal",
    async (reason) => {
      answerQuestion.mockResolvedValue({ ok: false, reason });
      const res = await answerPOST(answerReq({ questionId: "q1", choices: ["b"] }));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: reason });
    },
  );

  it("403 with retryAt for a cooldown refusal", async () => {
    answerQuestion.mockResolvedValue({ ok: false, reason: "cooldown", retryAt: "2026-01-01T00:00:00.000Z" });
    const res = await answerPOST(answerReq({ questionId: "q1", choices: ["b"] }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "cooldown", retryAt: "2026-01-01T00:00:00.000Z" });
  });

  it("200 with correct:true and points for a correct answer", async () => {
    answerQuestion.mockResolvedValue({ ok: true, correct: true, points: 10 });
    const res = await answerPOST(answerReq({ questionId: "q1", choices: ["b"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ correct: true, points: 10 });
  });

  it("a wrong-answer response never includes the correct choice ids", async () => {
    // The store never hands the route the correct set (AnswerResult has no
    // such field) — this pins the exact response shape so a future change
    // that DID thread the answer key through would fail this test.
    answerQuestion.mockResolvedValue({ ok: true, correct: false });
    const res = await answerPOST(answerReq({ questionId: "q1", choices: ["a"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ correct: false });
    const text = JSON.stringify(body);
    for (const choice of QUESTION.choices) {
      expect(text).not.toContain(choice.id);
      expect(text).not.toContain(choice.label);
    }
  });
});

describe("GET /api/admin/quiz", () => {
  // Every refusal case checks the response BODY for answer data, not just the
  // status code. Asserting only the status would pass just as happily on a
  // 403 that still shipped the key in its payload.
  const assertNoAnswerData = async (res: Response) => {
    const text = await res.text();
    expect(text).not.toContain("opt-right");
    expect(text).not.toMatch(/correct/i);
    expect(text).not.toContain(QUESTION.prompt);
  };

  it("401 for no session, with no answer data in the response", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 401 });
    listQuestionsForAdmin.mockResolvedValue([ADMIN_ROW]);
    const res = await adminGET(adminReq("GET"));
    expect(res.status).toBe(401);
    await assertNoAnswerData(res);
    // The gate short-circuits before the store is even asked.
    expect(listQuestionsForAdmin).not.toHaveBeenCalled();
  });

  it("403 for a non-admin, with no answer data in the response", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    listQuestionsForAdmin.mockResolvedValue([ADMIN_ROW]);
    const res = await adminGET(adminReq("GET"));
    expect(res.status).toBe(403);
    await assertNoAnswerData(res);
    expect(listQuestionsForAdmin).not.toHaveBeenCalled();
  });

  it("returns each question WITH its correct set for an admin, so the edit form can prefill", async () => {
    listQuestionsForAdmin.mockResolvedValue([ADMIN_ROW]);
    const res = await adminGET(adminReq("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ questions: [{ question: QUESTION, correct: ["opt-right"] }] });
    expect(body.questions[0].correct).toEqual(["opt-right"]);
  });

  it("reads the admin accessor, never the keyless contestant one", async () => {
    // Which function this route calls IS the security decision — reverting to
    // `listQuestions()` would silently take the prefill away again, and the
    // response-shape assertion above would be the only thing to notice.
    listQuestionsForAdmin.mockResolvedValue([ADMIN_ROW]);
    await adminGET(adminReq("GET"));
    expect(listQuestionsForAdmin).toHaveBeenCalledTimes(1);
    expect(listQuestions).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/quiz", () => {
  it("401 for no session, without writing anything", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 401 });
    const res = await adminPOST(adminReq("POST", CREATE_PAYLOAD));
    expect(res.status).toBe(401);
    expect(upsertQuestion).not.toHaveBeenCalled();
  });

  it("403 for a non-admin, without writing anything", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    const res = await adminPOST(adminReq("POST", CREATE_PAYLOAD));
    expect(res.status).toBe(403);
    expect(upsertQuestion).not.toHaveBeenCalled();
  });

  it("400 for a payload with an unknown top-level key", async () => {
    const res = await adminPOST(adminReq("POST", { ...CREATE_PAYLOAD, bogus: "x" }));
    expect(res.status).toBe(400);
    expect(upsertQuestion).not.toHaveBeenCalled();
  });

  it("400 for a choice smuggling an extra key (e.g. points)", async () => {
    const bad = {
      ...CREATE_PAYLOAD,
      choices: [
        { id: "a", label: "3" },
        { id: "b", label: "4", points: 999 },
      ],
    };
    const res = await adminPOST(adminReq("POST", bad));
    expect(res.status).toBe(400);
    expect(upsertQuestion).not.toHaveBeenCalled();
  });

  it("400 for a non-integer points value", async () => {
    const res = await adminPOST(adminReq("POST", { ...CREATE_PAYLOAD, points: 1.5 }));
    expect(res.status).toBe(400);
    expect(upsertQuestion).not.toHaveBeenCalled();
  });

  // A whitespace-only prompt is not merely untidy. The delete confirmation
  // asks the organizer to retype the trimmed prompt, and `ConfirmModal` reads
  // an empty `requireType` as "no phrase required" — so storing one would
  // leave that question deletable in a single click, with the type-to-confirm
  // gate silently disarmed. `upsertQuestion` validates the id, choices and
  // points but never the prompt, which makes this boundary the only place
  // that catches it. Not reachable through the admin form (`isDraftValid`
  // trims), but very reachable by an admin POSTing directly.
  it("400 for a whitespace-only prompt, so the delete gate can't be disarmed", async () => {
    // Store mocked to SUCCEED, so nothing downstream can be the reason this
    // request fails: if the boundary check goes, the write goes through and
    // this is a 200 — which is precisely the report we want.
    upsertQuestion.mockResolvedValue(ADMIN_ROW);
    const res = await adminPOST(adminReq("POST", { ...CREATE_PAYLOAD, prompt: "   \t\n " }));
    expect(res.status).toBe(400);
    expect(upsertQuestion).not.toHaveBeenCalled();
  });

  it("stores a padded prompt trimmed, so what is stored is what the gate asks for", async () => {
    upsertQuestion.mockResolvedValue(ADMIN_ROW);
    const res = await adminPOST(adminReq("POST", { ...CREATE_PAYLOAD, prompt: "  2+2?  " }));
    expect(res.status).toBe(200);
    expect(upsertQuestion).toHaveBeenCalledWith({ ...QUESTION, prompt: "2+2?" }, ["opt-right"]);
  });

  it("400 for a missing correct array", async () => {
    const { correct: _correct, ...withoutCorrect } = CREATE_PAYLOAD;
    void _correct;
    const res = await adminPOST(adminReq("POST", withoutCorrect));
    expect(res.status).toBe(400);
    expect(upsertQuestion).not.toHaveBeenCalled();
  });

  it("400 with the message when the store rejects a genuinely invalid question (QuizValidationError)", async () => {
    upsertQuestion.mockRejectedValue(new QuizValidationError("correct", "Correct choice id not among choices: z"));
    const res = await adminPOST(adminReq("POST", CREATE_PAYLOAD));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Correct choice id not among choices: z", field: "correct" });
  });

  it("503, not 400, when the store fails for an infra reason (not a QuizValidationError)", async () => {
    upsertQuestion.mockRejectedValue(new Error("Upstash HSET failed: timeout"));
    const res = await adminPOST(adminReq("POST", CREATE_PAYLOAD));
    expect(res.status).toBe(503);
  });

  it("creates/updates a question, echoes it back, and writes an audit line", async () => {
    upsertQuestion.mockResolvedValue(ADMIN_ROW);
    const res = await adminPOST(adminReq("POST", CREATE_PAYLOAD));
    expect(res.status).toBe(200);
    expect(upsertQuestion).toHaveBeenCalledWith(QUESTION, ["opt-right"]);
    expect(await res.json()).toEqual({ question: QUESTION, correct: ["opt-right"] });

    expect(upstashPipeline).toHaveBeenCalledTimes(1);
    const [commands] = upstashPipeline.mock.calls[0] as [(string | number)[][]];
    expect(commands[0][0]).toBe("LPUSH");
    expect(commands[0][1]).toBe("ctf:admin:audit");
    expect(String(commands[0][2])).toContain('"by":"alice"');
    expect(String(commands[0][2])).toContain('"questionId":"q1"');
  });

  it("echoes the STORED correct set, not the caller's raw array", async () => {
    // `upsertQuestion` dedupes and sorts before writing. Echoing the request's
    // own array instead would leave the authoring panel's in-memory list
    // holding a set the store never wrote — and a later reload disagreeing
    // with what the organizer just saw saved.
    upsertQuestion.mockResolvedValue({ question: QUESTION, correct: ["opt-right", "opt-wrong"] });
    const res = await adminPOST(
      adminReq("POST", { ...CREATE_PAYLOAD, type: "multi", correct: ["opt-wrong", "opt-right", "opt-wrong"] }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ correct: ["opt-right", "opt-wrong"] });
  });
});

describe("DELETE /api/admin/quiz", () => {
  it("401 for no session, without deleting anything", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 401 });
    const res = await adminDELETE(adminReq("DELETE", { id: "q1" }));
    expect(res.status).toBe(401);
    expect(deleteQuestion).not.toHaveBeenCalled();
  });

  it("403 for a non-admin, without deleting anything", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    const res = await adminDELETE(adminReq("DELETE", { id: "q1" }));
    expect(res.status).toBe(403);
    expect(deleteQuestion).not.toHaveBeenCalled();
  });

  it("400 for a missing id", async () => {
    const res = await adminDELETE(adminReq("DELETE", {}));
    expect(res.status).toBe(400);
    expect(deleteQuestion).not.toHaveBeenCalled();
  });

  it("deletes the question and writes an audit line", async () => {
    deleteQuestion.mockResolvedValue(undefined);
    const res = await adminDELETE(adminReq("DELETE", { id: "q1" }));
    expect(res.status).toBe(200);
    expect(deleteQuestion).toHaveBeenCalledWith("q1");
    expect(upstashPipeline).toHaveBeenCalledTimes(1);
  });

  it("400 with the message for a QuizValidationError from the store", async () => {
    deleteQuestion.mockRejectedValue(new QuizValidationError("id", "Invalid question id: ../etc"));
    const res = await adminDELETE(adminReq("DELETE", { id: "../etc" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid question id: ../etc", field: "id" });
  });

  it("503, not 400, when the store fails for an infra reason", async () => {
    deleteQuestion.mockRejectedValue(new Error("Upstash HDEL failed: timeout"));
    const res = await adminDELETE(adminReq("DELETE", { id: "q1" }));
    expect(res.status).toBe(503);
  });
});

describe("admin create/delete round-trip", () => {
  it("creates then deletes the same question id", async () => {
    upsertQuestion.mockResolvedValue(ADMIN_ROW);
    deleteQuestion.mockResolvedValue(undefined);

    const createRes = await adminPOST(adminReq("POST", CREATE_PAYLOAD));
    expect(createRes.status).toBe(200);
    expect(upsertQuestion).toHaveBeenCalledWith(expect.objectContaining({ id: "q1" }), ["opt-right"]);

    const deleteRes = await adminDELETE(adminReq("DELETE", { id: "q1" }));
    expect(deleteRes.status).toBe(200);
    expect(deleteQuestion).toHaveBeenCalledWith("q1");
  });
});
