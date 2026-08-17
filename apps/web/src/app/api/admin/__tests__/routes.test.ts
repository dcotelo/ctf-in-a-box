// Route-level tests for the admin status/settings API. Auth guard, store, and
// the leaderboard source are all mocked — no Upstash or GitHub session needed.
//
// The leaderboard freshness read is best-effort: a throw there must degrade
// to `leaderboard: null`, never fail the whole status route (settings/sync
// are the core payload).

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, getAdminSettings, updateAdminSettings, getSyncStatus, getLeaderboardSource, resetEvent } =
  vi.hoisted(() => ({
    requireAdmin: vi.fn(),
    getAdminSettings: vi.fn(),
    updateAdminSettings: vi.fn(),
    getSyncStatus: vi.fn(),
    getLeaderboardSource: vi.fn(),
    resetEvent: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin }));
vi.mock("@/lib/admin-store", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-store")>()),
  getAdminSettings,
  updateAdminSettings,
  getSyncStatus,
  resetEvent,
}));
vi.mock("@/lib/leaderboard/source", () => ({ getLeaderboardSource }));
vi.mock("@/lib/event-config", () => ({ eventConfig: { name: "Test Event" } }));

import { GET } from "@/app/api/admin/status/route";
import { POST } from "@/app/api/admin/settings/route";
import { POST as resetPOST } from "@/app/api/admin/reset/route";

const req = (body?: unknown) =>
  new Request("http://x/api/admin/settings", { method: "POST", body: JSON.stringify(body ?? {}) });

const SETTINGS = { paused: true, hintsEnabled: null, hintCost: null, updatedBy: "alice", updatedAt: "t" };

beforeEach(() => {
  requireAdmin.mockReset();
  getAdminSettings.mockReset();
  updateAdminSettings.mockReset();
  getSyncStatus.mockReset();
  getLeaderboardSource.mockReset();
  resetEvent.mockReset();
  requireAdmin.mockResolvedValue({ ok: true, login: "alice" });
  getAdminSettings.mockResolvedValue(SETTINGS);
  getSyncStatus.mockResolvedValue(null);
  getLeaderboardSource.mockReturnValue({
    getLeaderboard: vi.fn().mockResolvedValue({
      entries: [],
      teams: [],
      generatedAt: "t",
      capabilities: { apps: false, teams: false, challenges: false },
    }),
  });
});

describe("GET /api/admin/status", () => {
  it("403 for a non-admin", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    const res = await GET(new Request("http://x/api/admin/status"));
    expect(res.status).toBe(403);
    expect(getAdminSettings).not.toHaveBeenCalled();
  });

  it("401 for no session", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 401 });
    const res = await GET(new Request("http://x/api/admin/status"));
    expect(res.status).toBe(401);
  });

  it("returns settings and sync for an admin", async () => {
    const res = await GET(new Request("http://x/api/admin/status"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ settings: { paused: true }, sync: null });
  });

  it("includes leaderboard freshness computed from entries", async () => {
    getLeaderboardSource.mockReturnValue({
      getLeaderboard: vi.fn().mockResolvedValue({
        entries: [
          { rank: 1, login: "a", team: null, points: 10, patched: 1, failed: 0, total: 1, apps: {}, updatedAt: "2026-08-14T10:00:00.000Z" },
          { rank: 2, login: "b", team: null, points: 5, patched: 1, failed: 0, total: 1, apps: {}, updatedAt: "2026-08-14T12:00:00.000Z" },
        ],
        teams: [],
        generatedAt: "t",
        capabilities: { apps: false, teams: false, challenges: false },
      }),
    });
    const res = await GET(new Request("http://x/api/admin/status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leaderboard).toMatchObject({ players: 2, lastUpdatedAt: "2026-08-14T12:00:00.000Z" });
  });

  it("degrades leaderboard to null on a read failure instead of failing the route", async () => {
    getLeaderboardSource.mockReturnValue({
      getLeaderboard: vi.fn().mockRejectedValue(new Error("source down")),
    });
    const res = await GET(new Request("http://x/api/admin/status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings).toMatchObject({ paused: true });
    expect(body.leaderboard).toBeNull();
  });
});

describe("POST /api/admin/settings", () => {
  it("401 for no session", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 401 });
    expect((await POST(req({ paused: true }))).status).toBe(401);
    expect(updateAdminSettings).not.toHaveBeenCalled();
  });

  it("403 for a non-admin", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    expect((await POST(req({ paused: true }))).status).toBe(403);
    expect(updateAdminSettings).not.toHaveBeenCalled();
  });

  it("writes and echoes the new settings", async () => {
    updateAdminSettings.mockResolvedValue(SETTINGS);
    const res = await POST(req({ paused: true }));
    expect(res.status).toBe(200);
    expect(updateAdminSettings).toHaveBeenCalledWith({ paused: true }, "alice");
    expect(await res.json()).toMatchObject({ settings: { paused: true } });
  });

  it("400 with the field on a validation error", async () => {
    const { AdminValidationError } = await import("@/lib/admin-store");
    updateAdminSettings.mockRejectedValue(new AdminValidationError("hintCost", "bad"));
    const res = await POST(req({ hintCost: -1 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "hintCost" });
  });

  it("503 on a Redis failure", async () => {
    updateAdminSettings.mockRejectedValue(new Error("upstash down"));
    expect((await POST(req({ paused: true }))).status).toBe(503);
  });
});

describe("POST /api/admin/reset", () => {
  const rreq = (body?: unknown) =>
    new Request("http://x/api/admin/reset", { method: "POST", body: JSON.stringify(body ?? {}) });

  it("401 for no session, without wiping anything", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 401 });
    expect((await resetPOST(rreq({ confirm: "Test Event" }))).status).toBe(401);
    expect(resetEvent).not.toHaveBeenCalled();
  });

  it("403 for a non-admin, without wiping anything", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    expect((await resetPOST(rreq({ confirm: "Test Event" }))).status).toBe(403);
    expect(resetEvent).not.toHaveBeenCalled();
  });

  it("400 when the confirm phrase does not match, without wiping", async () => {
    const res = await resetPOST(rreq({ confirm: "nope" }));
    expect(res.status).toBe(400);
    expect(resetEvent).not.toHaveBeenCalled();
  });

  it("wipes and returns counts when the event name matches", async () => {
    resetEvent.mockResolvedValue({ cleared: { solves: 3, teams: 1 }, resetAt: "123" });
    const res = await resetPOST(rreq({ confirm: "Test Event" }));
    expect(res.status).toBe(200);
    expect(resetEvent).toHaveBeenCalledWith("alice");
    expect(await res.json()).toMatchObject({ cleared: { solves: 3 }, resetAt: "123" });
  });

  it("also accepts the literal RESET phrase", async () => {
    resetEvent.mockResolvedValue({ cleared: {}, resetAt: "1" });
    expect((await resetPOST(rreq({ confirm: "RESET" }))).status).toBe(200);
    expect(resetEvent).toHaveBeenCalledOnce();
  });

  it("503 on a reset failure", async () => {
    resetEvent.mockRejectedValue(new Error("upstash down"));
    expect((await resetPOST(rreq({ confirm: "RESET" }))).status).toBe(503);
  });
});
