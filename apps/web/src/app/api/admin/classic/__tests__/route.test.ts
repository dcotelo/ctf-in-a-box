// Route-level tests for the classic (flag) module's organizer authoring
// route. Auth guard, classic-store, and the Upstash pipeline (used only for
// the audit write) are all mocked — no Redis or GitHub session needed.
//
// requireAdmin must run BEFORE any store read/write in every handler: the
// admin payload carries flags, so an early read on an unauthenticated
// request is not merely wasted work, it is the leak itself. The mutation
// check below (moving requireAdmin after the store read) is what proves the
// "checks requireAdmin BEFORE any store read" test actually enforces that,
// rather than merely looking like it does.

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAdmin,
  listChallengesForAdmin,
  listCategories,
  setCategories,
  upsertChallenge,
  deleteChallenge,
  importBundle,
  upstashPipeline,
  ClassicValidationError,
} = vi.hoisted(() => {
  // A real (not mocked) ClassicValidationError, so `err instanceof
  // ClassicValidationError` in the route sees the exact same class the test
  // constructs errors with — that's what makes the 400-vs-503 split testable
  // at all.
  class ClassicValidationError extends Error {
    field: string;
    constructor(field: string, message: string) {
      super(message);
      this.name = "ClassicValidationError";
      this.field = field;
    }
  }
  return {
    requireAdmin: vi.fn(),
    listChallengesForAdmin: vi.fn(),
    listCategories: vi.fn(),
    setCategories: vi.fn(),
    upsertChallenge: vi.fn(),
    deleteChallenge: vi.fn(),
    importBundle: vi.fn(),
    upstashPipeline: vi.fn(),
    ClassicValidationError,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin }));
vi.mock("@/lib/classic-store", () => ({
  listChallengesForAdmin,
  listCategories,
  setCategories,
  upsertChallenge,
  deleteChallenge,
  importBundle,
  ClassicValidationError,
}));
vi.mock("@/lib/admin-store", () => ({ ADMIN_AUDIT_KEY: "ctf:admin:audit", AUDIT_CAP: 500 }));
vi.mock("@/lib/upstash", () => ({ upstashPipeline }));

// classic-io's parseBundle is deliberately NOT mocked: the whole point of the
// import route is that it re-validates the raw text server-side with the
// REAL parser, so a test that mocked parseBundle away could not tell a route
// that actually re-validates from one that just trusts the client.
import { GET, POST, DELETE, CHALLENGE_KEYS, CATEGORIES_KEYS, IMPORT_KEYS } from "@/app/api/admin/classic/route";

const adminReq = (method: "GET" | "POST" | "DELETE", body?: unknown) =>
  new Request("http://x/api/admin/classic", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const CHALLENGE = {
  id: "c-1",
  title: "SQLi 101",
  category: "Web",
  description: "Find the flag.",
  points: 50,
  order: 1,
};

const validPayload = { ...CHALLENGE, flag: "CTF{flag}" };

const ADMIN_ROW = { challenge: CHALLENGE, flag: "CTF{flag}" };

function allowAdmin() {
  requireAdmin.mockResolvedValue({ ok: true, login: "alice" });
}

function denyAdmin() {
  requireAdmin.mockResolvedValue({ ok: false, status: 403 });
}

function upsertThrows(err: unknown) {
  upsertChallenge.mockRejectedValue(err);
}

beforeEach(() => {
  requireAdmin.mockReset();
  listChallengesForAdmin.mockReset();
  listCategories.mockReset();
  setCategories.mockReset();
  upsertChallenge.mockReset();
  deleteChallenge.mockReset();
  importBundle.mockReset();
  upstashPipeline.mockReset();
  allowAdmin();
  listChallengesForAdmin.mockResolvedValue([ADMIN_ROW]);
  listCategories.mockResolvedValue(["Web"]);
  upstashPipeline.mockResolvedValue([{ result: 1 }, { result: "OK" }]);
});

describe("GET /api/admin/classic", () => {
  it("checks requireAdmin BEFORE any store read", async () => {
    denyAdmin();
    const res = await GET(adminReq("GET"));
    expect(res.status).toBe(403);
    // The payload carries flags, so an early read on an unauthenticated
    // request is not merely wasted work.
    expect(listChallengesForAdmin).not.toHaveBeenCalled();
    expect(listCategories).not.toHaveBeenCalled();
  });

  it("401s for no session, with no flag data in the response", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 401 });
    const res = await GET(adminReq("GET"));
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain("CTF{flag}");
  });

  it("returns challenges (with flags) and categories for an admin", async () => {
    const res = await GET(adminReq("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenges: [ADMIN_ROW], categories: ["Web"] });
  });

  // Finding B: the store reads were not wrapped in a try/catch, so a
  // rejection here became an unhandled rejection instead of the clean 503
  // the write paths already get via `errorResponse`. Each list function is
  // rejected in turn so a fix that only guards one of the two calls (e.g.
  // `Promise.all` wrapped, but only the FIRST leg awaited defensively) can't
  // pass by accident.
  it("503s (not throw) when listChallengesForAdmin rejects", async () => {
    listChallengesForAdmin.mockRejectedValue(new Error("upstash down"));
    const res = await GET(adminReq("GET"));
    expect(res.status).toBe(503);
  });

  it("503s (not throw) when listCategories rejects", async () => {
    listCategories.mockRejectedValue(new Error("upstash down"));
    const res = await GET(adminReq("GET"));
    expect(res.status).toBe(503);
  });
});

// Finding A: the admin POST route dispatches between payload shapes by KEY
// SET ALONE, with no discriminator field. That only stays safe as long as
// EVERY PAIR of the route's shapes' allowed key sets is disjoint — not just
// one hand-picked pair. This test derives all three sets from the actual
// exported constants the route's parsers use (`CHALLENGE_KEYS` /
// `CATEGORIES_KEYS` / `IMPORT_KEYS`) and checks every pair among them, so a
// FOURTH shape added later is covered automatically just by being added to
// the `sets` list below — a hardcoded pairwise copy would silently miss it.
describe("POST /api/admin/classic — dispatch key sets", () => {
  it("keeps every payload key set pairwise disjoint", () => {
    const sets = [
      ["CHALLENGE_KEYS", CHALLENGE_KEYS],
      ["CATEGORIES_KEYS", CATEGORIES_KEYS],
      ["IMPORT_KEYS", IMPORT_KEYS],
    ] as const;
    for (const [aName, a] of sets) {
      for (const [bName, b] of sets) {
        if (aName === bName) continue;
        const overlap = [...a].filter((k) => b.has(k));
        expect(overlap, `${aName} vs ${bName}`).toEqual([]);
      }
    }
  });

  it("400s a body that matches neither shape", async () => {
    const res = await POST(adminReq("POST", { nonsense: true }));
    expect(res.status).toBe(400);
    expect(upsertChallenge).not.toHaveBeenCalled();
    expect(setCategories).not.toHaveBeenCalled();
  });

  it("rejects a body carrying BOTH a categories key and challenge keys, rather than silently picking one", async () => {
    const res = await POST(adminReq("POST", { ...validPayload, categories: ["Web"] }));
    expect(res.status).toBe(400);
    expect(upsertChallenge).not.toHaveBeenCalled();
    expect(setCategories).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/classic — challenge upsert", () => {
  it("401s for no session, without writing anything", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 401 });
    const res = await POST(adminReq("POST", validPayload));
    expect(res.status).toBe(401);
    expect(upsertChallenge).not.toHaveBeenCalled();
  });

  it("403s for a non-admin, without writing anything", async () => {
    denyAdmin();
    const res = await POST(adminReq("POST", validPayload));
    expect(res.status).toBe(403);
    expect(upsertChallenge).not.toHaveBeenCalled();
  });

  it("rejects a payload carrying an unknown key", async () => {
    const res = await POST(adminReq("POST", { ...validPayload, sneaky: 1 }));
    expect(res.status).toBe(400);
    expect(upsertChallenge).not.toHaveBeenCalled();
  });

  it("400s a non-integer points value", async () => {
    const res = await POST(adminReq("POST", { ...validPayload, points: 1.5 }));
    expect(res.status).toBe(400);
    expect(upsertChallenge).not.toHaveBeenCalled();
  });

  it("400s a whitespace-only title", async () => {
    upsertChallenge.mockResolvedValue(ADMIN_ROW);
    const res = await POST(adminReq("POST", { ...validPayload, title: "   " }));
    expect(res.status).toBe(400);
    expect(upsertChallenge).not.toHaveBeenCalled();
  });

  it("400s an empty flag", async () => {
    const res = await POST(adminReq("POST", { ...validPayload, flag: "" }));
    expect(res.status).toBe(400);
    expect(upsertChallenge).not.toHaveBeenCalled();
  });

  it("maps a validation error to 400 and a store failure to 503", async () => {
    upsertThrows(new ClassicValidationError("points", "bad"));
    expect((await POST(adminReq("POST", validPayload))).status).toBe(400);

    upsertThrows(new Error("upstash down"));
    expect((await POST(adminReq("POST", validPayload))).status).toBe(503);
  });

  it("400s with the message and field for a ClassicValidationError", async () => {
    upsertThrows(new ClassicValidationError("category", "Unknown category: Nope"));
    const res = await POST(adminReq("POST", validPayload));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Unknown category: Nope", field: "category" });
  });

  it("upserts, echoes the stored record, and writes an audit line", async () => {
    upsertChallenge.mockResolvedValue(ADMIN_ROW);
    const res = await POST(adminReq("POST", validPayload));
    expect(res.status).toBe(200);
    expect(upsertChallenge).toHaveBeenCalledWith(CHALLENGE, "CTF{flag}");
    expect(await res.json()).toEqual({ challenge: CHALLENGE, flag: "CTF{flag}" });

    expect(upstashPipeline).toHaveBeenCalledTimes(1);
    const [commands] = upstashPipeline.mock.calls[0] as [(string | number)[][]];
    expect(commands[0][0]).toBe("LPUSH");
    expect(commands[0][1]).toBe("ctf:admin:audit");
    expect(String(commands[0][2])).toContain('"by":"alice"');
    expect(String(commands[0][2])).toContain('"challengeId":"c-1"');
  });
});

describe("POST /api/admin/classic — categories", () => {
  it("401s for no session, without writing anything", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 401 });
    const res = await POST(adminReq("POST", { categories: ["Web"] }));
    expect(res.status).toBe(401);
    expect(setCategories).not.toHaveBeenCalled();
  });

  it("400s a categories array with a non-string entry", async () => {
    const res = await POST(adminReq("POST", { categories: ["Web", 1] }));
    expect(res.status).toBe(400);
    expect(setCategories).not.toHaveBeenCalled();
  });

  it("maps a validation error to 400 and a store failure to 503", async () => {
    setCategories.mockRejectedValue(new ClassicValidationError("categories", "too many"));
    expect((await POST(adminReq("POST", { categories: ["Web"] }))).status).toBe(400);

    setCategories.mockRejectedValue(new Error("upstash down"));
    expect((await POST(adminReq("POST", { categories: ["Web"] }))).status).toBe(503);
  });

  it("replaces categories, echoes the stored list, and writes an audit line", async () => {
    setCategories.mockResolvedValue(["Web", "Crypto"]);
    const res = await POST(adminReq("POST", { categories: ["Web", "Crypto"] }));
    expect(res.status).toBe(200);
    expect(setCategories).toHaveBeenCalledWith(["Web", "Crypto"]);
    expect(await res.json()).toEqual({ categories: ["Web", "Crypto"] });
    expect(upstashPipeline).toHaveBeenCalledTimes(1);
  });
});

const validBundle = {
  version: 1,
  categories: ["Web", "Crypto"],
  challenges: [
    { id: "web-one-ab12cd", title: "One", category: "Web", description: "**find it**", points: 50, order: 0, flag: "ctfbox{One}" },
    { id: "crypto-two-ef34gh", title: "Two", category: "Crypto", description: "look `here`", points: 100, order: 0, flag: "ctfbox{Two}" },
  ],
};

// Deliberately wrong in MULTIPLE independent ways (bad id shape, missing
// title, unknown category, negative points, empty flag) so a route that
// truncated to the first parseBundle error, rather than returning the whole
// list, would still show a suspiciously short `errors` array here.
const badBundle = {
  version: 1,
  categories: [],
  challenges: [{ id: "x!", title: "", category: "Nope", description: "", points: -1, order: 0, flag: "" }],
};

describe("POST /api/admin/classic — import", () => {
  it("401s for no session, without parsing or importing anything", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 401 });
    const res = await POST(adminReq("POST", { import: JSON.stringify(validBundle) }));
    expect(res.status).toBe(401);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("checks requireAdmin before parsing or importing", async () => {
    denyAdmin();
    const res = await POST(adminReq("POST", { import: JSON.stringify(validBundle) }));
    expect(res.status).toBe(403);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("imports a valid bundle and reports what changed", async () => {
    importBundle.mockResolvedValue({ created: 2, updated: 0, categories: 2 });
    const res = await POST(adminReq("POST", { import: JSON.stringify(validBundle) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: 2, updated: 0, categories: 2 });
    expect(importBundle).toHaveBeenCalledWith(validBundle);
  });

  it("400s an invalid bundle and returns EVERY error, writing nothing", async () => {
    const res = await POST(adminReq("POST", { import: JSON.stringify(badBundle) }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors.length).toBeGreaterThan(1);
    expect(importBundle).not.toHaveBeenCalled();
  });

  // The whole reason the route accepts raw TEXT rather than a pre-parsed
  // bundle: this payload is shaped exactly like a bundle object (right
  // top-level keys, an array of "challenges") but every field inside is
  // invalid. A route that skipped its own `parseBundle` call and forwarded
  // the client's object straight to `importBundle` would let this through.
  it("re-validates server-side even if the client sent something shaped right", async () => {
    const res = await POST(
      adminReq("POST", {
        import: JSON.stringify({
          version: 1,
          categories: [],
          challenges: [{ id: "x!", title: "", category: "Nope", description: "", points: -1, order: 0, flag: "" }],
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("400s malformed JSON in the import string", async () => {
    const res = await POST(adminReq("POST", { import: "{not json" }));
    expect(res.status).toBe(400);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("maps a store failure to 503, not 400", async () => {
    importBundle.mockRejectedValue(new Error("upstash down"));
    const res = await POST(adminReq("POST", { import: JSON.stringify(validBundle) }));
    expect(res.status).toBe(503);
  });

  it("imports and writes an audit line recording the counts", async () => {
    importBundle.mockResolvedValue({ created: 2, updated: 0, categories: 2 });
    await POST(adminReq("POST", { import: JSON.stringify(validBundle) }));
    expect(upstashPipeline).toHaveBeenCalledTimes(1);
    const [commands] = upstashPipeline.mock.calls[0] as [(string | number)[][]];
    expect(commands[0][0]).toBe("LPUSH");
    expect(commands[0][1]).toBe("ctf:admin:audit");
    const audit = String(commands[0][2]);
    expect(audit).toContain('"by":"alice"');
    expect(audit).toContain('"created":2');
    expect(audit).toContain('"updated":0');
    expect(audit).toContain('"categories":2');
  });
});

describe("DELETE /api/admin/classic", () => {
  it("401s for no session, without deleting anything", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 401 });
    const res = await DELETE(adminReq("DELETE", { id: "c-1" }));
    expect(res.status).toBe(401);
    expect(deleteChallenge).not.toHaveBeenCalled();
  });

  it("403s for a non-admin, without deleting anything", async () => {
    denyAdmin();
    const res = await DELETE(adminReq("DELETE", { id: "c-1" }));
    expect(res.status).toBe(403);
    expect(deleteChallenge).not.toHaveBeenCalled();
  });

  it("400s a missing id", async () => {
    const res = await DELETE(adminReq("DELETE", {}));
    expect(res.status).toBe(400);
    expect(deleteChallenge).not.toHaveBeenCalled();
  });

  it("deletes the challenge and writes an audit line", async () => {
    deleteChallenge.mockResolvedValue(undefined);
    const res = await DELETE(adminReq("DELETE", { id: "c-1" }));
    expect(res.status).toBe(200);
    expect(deleteChallenge).toHaveBeenCalledWith("c-1");
    expect(upstashPipeline).toHaveBeenCalledTimes(1);
  });

  it("400s with the message for a ClassicValidationError from the store", async () => {
    deleteChallenge.mockRejectedValue(new ClassicValidationError("id", "Invalid challenge id: ../etc"));
    const res = await DELETE(adminReq("DELETE", { id: "../etc" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid challenge id: ../etc", field: "id" });
  });

  it("503s, not 400, when the store fails for an infra reason", async () => {
    deleteChallenge.mockRejectedValue(new Error("Upstash HDEL failed: timeout"));
    const res = await DELETE(adminReq("DELETE", { id: "c-1" }));
    expect(res.status).toBe(503);
  });
});
