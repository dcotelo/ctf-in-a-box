// Route-level tests for the quiz API: the contestant answer route and the
// admin authoring route. Auth guard, quiz-store, and the Upstash pipeline
// (used only for the admin route's audit write) are all mocked — no Redis
// or GitHub session needed.
//
// login is ALWAYS derived from the session server-side for the contestant
// route; the admin route is gated by requireAdmin and shape-checks its
// payload before ever calling upsertQuestion. Neither route can leak the
// correct-answer key: `answerQuestion`'s return type never carries it.

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSession,
  requireAdmin,
  answerQuestion,
  listQuestions,
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
    answerQuestion: vi.fn(),
    listQuestions: vi.fn(),
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
vi.mock("@/lib/quiz-store", () => ({
  answerQuestion,
  listQuestions,
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

beforeEach(() => {
  getSession.mockReset();
  requireAdmin.mockReset();
  answerQuestion.mockReset();
  listQuestions.mockReset();
  upsertQuestion.mockReset();
  deleteQuestion.mockReset();
  upstashPipeline.mockReset();
  getSession.mockResolvedValue(SESSION);
  requireAdmin.mockResolvedValue({ ok: true, login: "alice" });
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
  it("401 for no session", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 401 });
    const res = await adminGET(adminReq("GET"));
    expect(res.status).toBe(401);
    expect(listQuestions).not.toHaveBeenCalled();
  });

  it("403 for a non-admin", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    const res = await adminGET(adminReq("GET"));
    expect(res.status).toBe(403);
    expect(listQuestions).not.toHaveBeenCalled();
  });

  it("returns the question list for an admin", async () => {
    listQuestions.mockResolvedValue([QUESTION]);
    const res = await adminGET(adminReq("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ questions: [QUESTION] });
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
    upsertQuestion.mockResolvedValue(undefined);
    const res = await adminPOST(adminReq("POST", CREATE_PAYLOAD));
    expect(res.status).toBe(200);
    expect(upsertQuestion).toHaveBeenCalledWith(QUESTION, ["opt-right"]);
    expect(await res.json()).toEqual({ question: QUESTION });

    expect(upstashPipeline).toHaveBeenCalledTimes(1);
    const [commands] = upstashPipeline.mock.calls[0] as [(string | number)[][]];
    expect(commands[0][0]).toBe("LPUSH");
    expect(commands[0][1]).toBe("ctf:admin:audit");
    expect(String(commands[0][2])).toContain('"by":"alice"');
    expect(String(commands[0][2])).toContain('"questionId":"q1"');
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
    upsertQuestion.mockResolvedValue(undefined);
    deleteQuestion.mockResolvedValue(undefined);

    const createRes = await adminPOST(adminReq("POST", CREATE_PAYLOAD));
    expect(createRes.status).toBe(200);
    expect(upsertQuestion).toHaveBeenCalledWith(expect.objectContaining({ id: "q1" }), ["opt-right"]);

    const deleteRes = await adminDELETE(adminReq("DELETE", { id: "q1" }));
    expect(deleteRes.status).toBe(200);
    expect(deleteQuestion).toHaveBeenCalledWith("q1");
  });
});
