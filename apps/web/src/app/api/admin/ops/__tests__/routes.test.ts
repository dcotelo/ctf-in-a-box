// Support-operation routes (issue #168). The store is mocked — what these
// pin is the boundary: who may call, what shapes are accepted, and that a
// destructive verb cannot be reached by accident.
//
// GET is gated exactly as hard as the writes. It returns everything the box
// knows about one named contestant — their team, points, attempts and hint
// spend — which is precisely the read a non-admin must never have.

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAdmin,
  lookupUser,
  resetUserProgress,
  deleteUser,
  forceRemoveFromTeam,
  forceTransferCaptain,
  forceDisbandTeam,
  OpsValidationError,
} = vi.hoisted(() => {
  class OpsValidationError extends Error {
    field: string;
    constructor(field: string, message: string) {
      super(message);
      this.name = "OpsValidationError";
      this.field = field;
    }
  }
  return {
    requireAdmin: vi.fn(),
    lookupUser: vi.fn(),
    resetUserProgress: vi.fn(),
    deleteUser: vi.fn(),
    forceRemoveFromTeam: vi.fn(),
    forceTransferCaptain: vi.fn(),
    forceDisbandTeam: vi.fn(),
    OpsValidationError,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin }));
vi.mock("@/lib/admin-ops-store", () => ({
  lookupUser,
  resetUserProgress,
  deleteUser,
  forceRemoveFromTeam,
  forceTransferCaptain,
  forceDisbandTeam,
  OpsValidationError,
}));

import { GET as userGET, POST as userPOST, DELETE as userDELETE } from "@/app/api/admin/ops/user/route";
import { POST as teamPOST, DELETE as teamDELETE } from "@/app/api/admin/ops/team/route";

const userReq = (login: string) =>
  new Request(`http://x/api/admin/ops/user?login=${encodeURIComponent(login)}`);
const jsonReq = (url: string, method: string, body?: unknown) =>
  new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });

const DETAIL = {
  login: "octocat",
  team: null,
  quiz: { answered: 0, points: 0, attempts: 0 },
  classic: { solved: 0, points: 0, attempts: 0 },
  secureDev: { solves: 0 },
  hints: { bought: 0, spent: 0 },
  known: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, login: "alice" });
  lookupUser.mockResolvedValue(DETAIL);
  resetUserProgress.mockResolvedValue({ cleared: {}, warnings: [] });
  deleteUser.mockResolvedValue({ cleared: {}, warnings: [], leftTeam: null });
  forceRemoveFromTeam.mockResolvedValue({ ok: true });
  forceTransferCaptain.mockResolvedValue({ ok: true });
  forceDisbandTeam.mockResolvedValue({ ok: true, members: 2 });
});

describe("authorization", () => {
  const forbidden = { ok: false, status: 403 };

  it("403s a non-admin on EVERY method, without touching the store", async () => {
    requireAdmin.mockResolvedValue(forbidden);
    const calls = [
      userGET(userReq("octocat")),
      userPOST(jsonReq("http://x/u", "POST", { login: "octocat", action: "reset" })),
      userDELETE(jsonReq("http://x/u", "DELETE", { login: "octocat" })),
      teamPOST(jsonReq("http://x/t", "POST", { slug: "red", login: "bob", action: "remove-member" })),
      teamDELETE(jsonReq("http://x/t", "DELETE", { slug: "red" })),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
    expect(lookupUser).not.toHaveBeenCalled();
    expect(resetUserProgress).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(forceRemoveFromTeam).not.toHaveBeenCalled();
    expect(forceTransferCaptain).not.toHaveBeenCalled();
    expect(forceDisbandTeam).not.toHaveBeenCalled();
  });

  it("gates the READ too — a lookup is not public data", async () => {
    requireAdmin.mockResolvedValue(forbidden);
    const res = await userGET(userReq("octocat"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("attributes the action to the SESSION's admin, not anything in the body", async () => {
    await userPOST(jsonReq("http://x/u", "POST", { login: "octocat", action: "reset", by: "mallory" }));
    expect(resetUserProgress).toHaveBeenCalledWith("octocat", "alice");
  });
});

describe("POST /api/admin/ops/user", () => {
  it("requires an explicit action, so a bare POST cannot reset anyone", async () => {
    const res = await userPOST(jsonReq("http://x/u", "POST", { login: "octocat" }));
    expect(res.status).toBe(400);
    expect(resetUserProgress).not.toHaveBeenCalled();
  });

  it("rejects an unknown action rather than guessing", async () => {
    const res = await userPOST(jsonReq("http://x/u", "POST", { login: "octocat", action: "nuke" }));
    expect(res.status).toBe(400);
    expect(resetUserProgress).not.toHaveBeenCalled();
  });

  it("400s a non-string login", async () => {
    const res = await userPOST(jsonReq("http://x/u", "POST", { login: 42, action: "reset" }));
    expect(res.status).toBe(400);
    expect(resetUserProgress).not.toHaveBeenCalled();
  });

  it("400s an unparseable body without reaching the store", async () => {
    const res = await userPOST(new Request("http://x/u", { method: "POST", body: "{" }));
    expect(res.status).toBe(400);
    expect(resetUserProgress).not.toHaveBeenCalled();
  });

  it("passes the store's warnings through to the caller", async () => {
    // The secure-dev re-ingest caveat is the part the organizer must act on.
    resetUserProgress.mockResolvedValue({ cleared: { secureDevSolves: 3 }, warnings: ["they come back"] });
    const res = await userPOST(jsonReq("http://x/u", "POST", { login: "octocat", action: "reset" }));
    expect(await res.json()).toMatchObject({ warnings: ["they come back"] });
  });
});

describe("DELETE /api/admin/ops/user", () => {
  it("surfaces a validation refusal as 400 with its message", async () => {
    deleteUser.mockRejectedValue(new OpsValidationError("login", "octocat is captain of \"Red\""));
    const res = await userDELETE(jsonReq("http://x/u", "DELETE", { login: "octocat" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("captain"), field: "login" });
  });

  it("503s an unexpected store failure without leaking it", async () => {
    deleteUser.mockRejectedValue(new Error("redis exploded"));
    const res = await userDELETE(jsonReq("http://x/u", "DELETE", { login: "octocat" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });
});

describe("/api/admin/ops/team", () => {
  it("routes remove-member and transfer-captain to their own store calls", async () => {
    await teamPOST(jsonReq("http://x/t", "POST", { slug: "red", login: "bob", action: "remove-member" }));
    expect(forceRemoveFromTeam).toHaveBeenCalledWith("red", "bob", "alice");

    await teamPOST(jsonReq("http://x/t", "POST", { slug: "red", login: "bob", action: "transfer-captain" }));
    expect(forceTransferCaptain).toHaveBeenCalledWith("red", "bob", "alice");
  });

  it("rejects an unknown team action", async () => {
    const res = await teamPOST(jsonReq("http://x/t", "POST", { slug: "red", login: "bob", action: "x" }));
    expect(res.status).toBe(400);
    expect(forceRemoveFromTeam).not.toHaveBeenCalled();
    expect(forceTransferCaptain).not.toHaveBeenCalled();
  });

  it("400s when slug or login is not a string", async () => {
    const res = await teamPOST(jsonReq("http://x/t", "POST", { slug: "red", action: "remove-member" }));
    expect(res.status).toBe(400);
    expect(forceRemoveFromTeam).not.toHaveBeenCalled();
  });

  it("disbands by slug and reports how many were released", async () => {
    const res = await teamDELETE(jsonReq("http://x/t", "DELETE", { slug: "red" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ members: 2 });
    expect(forceDisbandTeam).toHaveBeenCalledWith("red", "alice");
  });
});
