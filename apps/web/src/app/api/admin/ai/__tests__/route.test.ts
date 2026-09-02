// Route-level tests for the ai module's organizer authoring route. Auth
// guard, ai-store, and the Upstash pipeline (used only for the audit write)
// are all mocked — no Redis or GitHub session needed.
//
// requireAdmin must run BEFORE any store read/write in every handler: the
// admin payload carries flags and signing keys, so an early read on an
// unauthenticated request is not merely wasted work, it is the leak itself.
// Mirrors admin/classic/route.test.ts's idiom, with the ai deltas: mode +
// urlTemplate in the challenge payload, a `{ rotate }` dispatch arm, and no
// import/export arm.

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAdmin,
  listAiChallengesForAdmin,
  listAiCategories,
  setAiCategories,
  upsertAiChallenge,
  deleteAiChallenge,
  rotateAiSigningKey,
  upstashPipeline,
  AiValidationError,
} = vi.hoisted(() => {
  // A real (not mocked) AiValidationError, so `err instanceof
  // AiValidationError` in the route sees the exact same class the test
  // constructs errors with — that's what makes the 400-vs-503 split testable
  // at all.
  class AiValidationError extends Error {
    field: string;
    constructor(field: string, message: string) {
      super(message);
      this.name = "AiValidationError";
      this.field = field;
    }
  }
  return {
    requireAdmin: vi.fn(),
    listAiChallengesForAdmin: vi.fn(),
    listAiCategories: vi.fn(),
    setAiCategories: vi.fn(),
    upsertAiChallenge: vi.fn(),
    deleteAiChallenge: vi.fn(),
    rotateAiSigningKey: vi.fn(),
    upstashPipeline: vi.fn(),
    AiValidationError,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin }));
vi.mock("@/lib/ai-store", () => ({
  listAiChallengesForAdmin,
  listAiCategories,
  setAiCategories,
  upsertAiChallenge,
  deleteAiChallenge,
  rotateAiSigningKey,
  AiValidationError,
}));
vi.mock("@/lib/admin-store", () => ({ ADMIN_AUDIT_KEY: "ctf:admin:audit", AUDIT_CAP: 500 }));
vi.mock("@/lib/upstash", () => ({ upstashPipeline }));

import { GET, POST, DELETE } from "@/app/api/admin/ai/route";

const adminReq = (method: "GET" | "POST" | "DELETE", body?: unknown) =>
  new Request("http://x/api/admin/ai", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const CHALLENGE = {
  id: "c-1",
  title: "Prompt Injection 101",
  category: "AI",
  description: "Find the flag.",
  points: 50,
  order: 1,
  mode: "flag" as const,
  urlTemplate: "https://challenge.example/{token}",
};

const validPayload = { ...CHALLENGE, flag: "CTF{flag}" };

const ADMIN_ROW = { challenge: CHALLENGE, flag: "CTF{flag}", hint: null, signingKey: "signkey-abc" };

function allowAdmin() {
  requireAdmin.mockResolvedValue({ ok: true, login: "alice" });
}

function denyAdmin() {
  requireAdmin.mockResolvedValue({ ok: false, status: 403 });
}

beforeEach(() => {
  requireAdmin.mockReset();
  listAiChallengesForAdmin.mockReset();
  listAiCategories.mockReset();
  setAiCategories.mockReset();
  upsertAiChallenge.mockReset();
  deleteAiChallenge.mockReset();
  rotateAiSigningKey.mockReset();
  upstashPipeline.mockReset();
  allowAdmin();
  listAiChallengesForAdmin.mockResolvedValue([ADMIN_ROW]);
  listAiCategories.mockResolvedValue(["AI"]);
  upstashPipeline.mockResolvedValue([{ result: 1 }, { result: "OK" }]);
});

describe("GET /api/admin/ai", () => {
  it("403s when requireAdmin refuses, without touching the store", async () => {
    denyAdmin();
    const res = await GET(adminReq("GET"));
    expect(res.status).toBe(403);
    expect(listAiChallengesForAdmin).not.toHaveBeenCalled();
    expect(listAiCategories).not.toHaveBeenCalled();
  });

  it("returns challenges (with secrets) and categories for an admin, one call each", async () => {
    const res = await GET(adminReq("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenges: [ADMIN_ROW], categories: ["AI"] });
    expect(listAiChallengesForAdmin).toHaveBeenCalledTimes(1);
    expect(listAiCategories).toHaveBeenCalledTimes(1);
  });

  it("503s unavailable when the store throws, and logs neither a flag nor a key", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // A driver-decorated error, matching the shape `ai-store.ts`'s own
    // `errorLabel` docstring warns about: the message itself is generic, but
    // the error carries OWN PROPERTIES with the failed command's arguments —
    // exactly what a naive `console.error(err)` would print in full, and
    // what the `errorLabel` (name+message only) discipline must drop.
    const err = new Error("upstash down");
    Object.assign(err, { command: ["HGETALL", "ctf:ai:flag"], args: ["CTF{flag}"], cause: "signkey-abc" });
    listAiChallengesForAdmin.mockRejectedValue(err);
    const res = await GET(adminReq("GET"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    const logged = spy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).not.toContain("CTF{flag}");
    expect(logged).not.toContain("signkey-abc");
    spy.mockRestore();
  });
});

describe("POST /api/admin/ai — categories", () => {
  it("403s when requireAdmin refuses, without writing anything", async () => {
    denyAdmin();
    const res = await POST(adminReq("POST", { categories: ["AI"] }));
    expect(res.status).toBe(403);
    expect(setAiCategories).not.toHaveBeenCalled();
  });

  it("replaces categories, echoes the stored list, and writes an audit line", async () => {
    setAiCategories.mockResolvedValue(["AI", "Prompt"]);
    const res = await POST(adminReq("POST", { categories: ["AI", "Prompt"] }));
    expect(res.status).toBe(200);
    expect(setAiCategories).toHaveBeenCalledWith(["AI", "Prompt"]);
    expect(await res.json()).toEqual({ categories: ["AI", "Prompt"] });
    expect(upstashPipeline).toHaveBeenCalledTimes(1);
    const [commands] = upstashPipeline.mock.calls[0] as [(string | number)[][]];
    expect(commands[0][0]).toBe("LPUSH");
    expect(commands[0][1]).toBe("ctf:admin:audit");
    expect(String(commands[0][2])).toContain('"action":"ai-categories"');
    expect(String(commands[0][2])).toContain('"by":"alice"');
  });

  it("maps a validation error to 400 and a store failure to 503", async () => {
    setAiCategories.mockRejectedValue(new AiValidationError("categories", "too many"));
    expect((await POST(adminReq("POST", { categories: ["AI"] }))).status).toBe(400);

    setAiCategories.mockRejectedValue(new Error("upstash down"));
    expect((await POST(adminReq("POST", { categories: ["AI"] }))).status).toBe(503);
  });
});

describe("POST /api/admin/ai — rotate", () => {
  it("403s when requireAdmin refuses, without touching the store", async () => {
    denyAdmin();
    const res = await POST(adminReq("POST", { rotate: "c-1" }));
    expect(res.status).toBe(403);
    expect(rotateAiSigningKey).not.toHaveBeenCalled();
  });

  it("rotates the signing key, returns it, and audits the id but never the key", async () => {
    rotateAiSigningKey.mockResolvedValue("new-key-xyz");
    const res = await POST(adminReq("POST", { rotate: "c-1" }));
    expect(res.status).toBe(200);
    expect(rotateAiSigningKey).toHaveBeenCalledWith("c-1");
    expect(await res.json()).toEqual({ signingKey: "new-key-xyz" });

    expect(upstashPipeline).toHaveBeenCalledTimes(1);
    const [commands] = upstashPipeline.mock.calls[0] as [(string | number)[][]];
    const audit = String(commands[0][2]);
    expect(audit).toContain('"action":"ai-rotate-key"');
    expect(audit).toContain('"id":"c-1"');
    expect(audit).not.toContain("new-key-xyz");
  });

  it("maps a validation error to 400 and a store failure to 503", async () => {
    rotateAiSigningKey.mockRejectedValue(new AiValidationError("id", "Unknown challenge: c-1"));
    expect((await POST(adminReq("POST", { rotate: "c-1" }))).status).toBe(400);

    rotateAiSigningKey.mockRejectedValue(new Error("upstash down"));
    expect((await POST(adminReq("POST", { rotate: "c-1" }))).status).toBe(503);
  });
});

describe("POST /api/admin/ai — challenge upsert", () => {
  it("403s when requireAdmin refuses, without writing anything", async () => {
    denyAdmin();
    const res = await POST(adminReq("POST", validPayload));
    expect(res.status).toBe(403);
    expect(upsertAiChallenge).not.toHaveBeenCalled();
  });

  it("400s a body matching none of the three shapes", async () => {
    const res = await POST(adminReq("POST", { nonsense: true }));
    expect(res.status).toBe(400);
    expect(upsertAiChallenge).not.toHaveBeenCalled();
    expect(setAiCategories).not.toHaveBeenCalled();
    expect(rotateAiSigningKey).not.toHaveBeenCalled();
  });

  it("upserts, separates the challenge fields from {flag, hint}, and echoes the AdminAiChallenge", async () => {
    upsertAiChallenge.mockResolvedValue(ADMIN_ROW);
    const res = await POST(adminReq("POST", { ...validPayload, hint: "try harder" }));
    expect(res.status).toBe(200);
    expect(upsertAiChallenge).toHaveBeenCalledWith(CHALLENGE, { flag: "CTF{flag}", hint: "try harder" });
    expect(await res.json()).toEqual(ADMIN_ROW);

    expect(upstashPipeline).toHaveBeenCalledTimes(1);
    const [commands] = upstashPipeline.mock.calls[0] as [(string | number)[][]];
    expect(String(commands[0][2])).toContain('"action":"ai-upsert"');
    expect(String(commands[0][2])).toContain('"id":"c-1"');
  });

  it("400s with the message for an AiValidationError from the store", async () => {
    upsertAiChallenge.mockRejectedValue(new AiValidationError("mode", "Unknown mode: bogus"));
    const res = await POST(adminReq("POST", validPayload));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown mode: bogus" });
  });

  it("503s unavailable on a store failure, not 400", async () => {
    upsertAiChallenge.mockRejectedValue(new Error("upstash down"));
    const res = await POST(adminReq("POST", validPayload));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });

  it("rejects a payload carrying an unknown key", async () => {
    const res = await POST(adminReq("POST", { ...validPayload, sneaky: 1 }));
    expect(res.status).toBe(400);
    expect(upsertAiChallenge).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/ai", () => {
  it("403s when requireAdmin refuses, without deleting anything", async () => {
    denyAdmin();
    const res = await DELETE(adminReq("DELETE", { id: "c-1" }));
    expect(res.status).toBe(403);
    expect(deleteAiChallenge).not.toHaveBeenCalled();
  });

  it("400s a missing id, without deleting anything", async () => {
    const res = await DELETE(adminReq("DELETE", {}));
    expect(res.status).toBe(400);
    expect(deleteAiChallenge).not.toHaveBeenCalled();
  });

  it("deletes the challenge and writes an audit line with the id", async () => {
    deleteAiChallenge.mockResolvedValue(undefined);
    const res = await DELETE(adminReq("DELETE", { id: "c-1" }));
    expect(res.status).toBe(200);
    expect(deleteAiChallenge).toHaveBeenCalledWith("c-1");
    expect(upstashPipeline).toHaveBeenCalledTimes(1);
    const [commands] = upstashPipeline.mock.calls[0] as [(string | number)[][]];
    expect(String(commands[0][2])).toContain('"action":"ai-delete"');
    expect(String(commands[0][2])).toContain('"id":"c-1"');
  });

  it("400s with the message for an AiValidationError from the store", async () => {
    deleteAiChallenge.mockRejectedValue(new AiValidationError("id", "Invalid challenge id: ../etc"));
    const res = await DELETE(adminReq("DELETE", { id: "../etc" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid challenge id: ../etc" });
  });

  it("503s unavailable, not 400, when the store fails for an infra reason", async () => {
    deleteAiChallenge.mockRejectedValue(new Error("Upstash HDEL failed: timeout"));
    const res = await DELETE(adminReq("DELETE", { id: "c-1" }));
    expect(res.status).toBe(503);
  });
});
