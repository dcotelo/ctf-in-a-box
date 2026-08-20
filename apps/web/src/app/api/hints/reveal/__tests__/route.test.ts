// Route-level tests for the hints reveal route. Auth, hint-store, and the
// pre-event gate are all mocked — no Redis or GitHub session needed.
//
// This route is gated like classic/submit and quiz/answer, but is a sharper
// case: an ungated call here doesn't just bank points early, it hands back
// hint TEXT — challenge content leaked before the event opens. The gate
// check must run before revealHint is ever called.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, revealHint, resolveHintConfig, requireGatePassed } = vi.hoisted(() => ({
  getSession: vi.fn(),
  revealHint: vi.fn(),
  resolveHintConfig: vi.fn(),
  requireGatePassed: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/gate-request", () => ({ requireGatePassed }));
vi.mock("@/lib/hint-store", () => ({ revealHint, resolveHintConfig }));

import { POST } from "@/app/api/hints/reveal/route";

const req = (body?: unknown) =>
  new Request("http://x/api/hints/reveal", { method: "POST", body: JSON.stringify(body ?? {}) });

const SESSION = { user: { login: "alice" } };

beforeEach(() => {
  getSession.mockReset();
  revealHint.mockReset();
  resolveHintConfig.mockReset();
  requireGatePassed.mockReset();
  getSession.mockResolvedValue(SESSION);
  requireGatePassed.mockResolvedValue(true);
  resolveHintConfig.mockResolvedValue({ enabled: true, cost: 10 });
});

describe("POST /api/hints/reveal", () => {
  it("401s an unauthenticated request without touching the store", async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(req({ app: "quiz", id: "q1" }));
    expect(res.status).toBe(401);
    expect(revealHint).not.toHaveBeenCalled();
  });

  it("400s a session with no GitHub login, without touching the store", async () => {
    getSession.mockResolvedValue({ user: {} });
    const res = await POST(req({ app: "quiz", id: "q1" }));
    expect(res.status).toBe(400);
    expect(revealHint).not.toHaveBeenCalled();
  });

  it("403s with { error: \"gate\" } while the pre-event gate is active, without revealing anything", async () => {
    requireGatePassed.mockResolvedValue(false);
    const res = await POST(req({ app: "quiz", id: "q1" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "gate" });
    expect(revealHint).not.toHaveBeenCalled();
  });

  // Covers both "gate active, valid unlock cookie" and "gate inactive" —
  // at this boundary they're the same case (requireGatePassed resolves
  // true either way); the active-vs-inactive distinction is exercised
  // directly against the real cookie/crypto logic in gate.test.ts.
  it("proceeds normally when the gate check passes", async () => {
    requireGatePassed.mockResolvedValue(true);
    revealHint.mockResolvedValue({ ok: true, hint: "look under the rug", alreadyOwned: false, spent: 10 });
    const res = await POST(req({ app: "quiz", id: "q1" }));
    expect(res.status).toBe(200);
    expect(revealHint).toHaveBeenCalledWith("alice", "quiz", "q1");
    expect(await res.json()).toEqual({ hint: "look under the rug", alreadyOwned: false, spent: 10, cost: 10 });
  });

  it("404s when the hint is missing", async () => {
    revealHint.mockResolvedValue({ ok: false, error: "missing", missing: true });
    const res = await POST(req({ app: "quiz", id: "nope" }));
    expect(res.status).toBe(404);
  });

  it("403s when the store forbids the reveal (anti-burner gate)", async () => {
    revealHint.mockResolvedValue({ ok: false, error: "forbidden", forbidden: true });
    const res = await POST(req({ app: "quiz", id: "q1" }));
    expect(res.status).toBe(403);
  });
});
