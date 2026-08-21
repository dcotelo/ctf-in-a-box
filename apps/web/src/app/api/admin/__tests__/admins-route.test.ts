// Route-level tests for runtime admin management (issue #147). Auth and the
// store are mocked — no Upstash and no GitHub session needed.
//
// The assertions that matter here are the refusals, not the happy path: this
// route is the only way to grant admin, and the one guard it must never lose
// is that a BAKED admin cannot be removed through it.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, isBakedAdmin, listBakedAdmins, listStoredAdmins, addStoredAdmin, removeStoredAdmin } = vi.hoisted(
  () => ({
    requireAdmin: vi.fn(),
    isBakedAdmin: vi.fn(),
    listBakedAdmins: vi.fn(),
    listStoredAdmins: vi.fn(),
    addStoredAdmin: vi.fn(),
    removeStoredAdmin: vi.fn(),
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin, isBakedAdmin, listBakedAdmins }));
vi.mock("@/lib/admin-store", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-store")>()),
  listStoredAdmins,
  addStoredAdmin,
  removeStoredAdmin,
}));

import { DELETE, GET, POST } from "@/app/api/admin/admins/route";
import { AdminValidationError } from "@/lib/admin-store";

const req = (body?: unknown) =>
  new Request("http://x/api/admin/admins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, login: "alice" });
  isBakedAdmin.mockReturnValue(false);
  listBakedAdmins.mockReturnValue(["alice"]);
  listStoredAdmins.mockResolvedValue(["carol"]);
  addStoredAdmin.mockResolvedValue(["carol", "dave"]);
  removeStoredAdmin.mockResolvedValue([]);
});

describe("gating", () => {
  it("every method refuses a non-admin with the gate's own status", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    for (const call of [GET(req()), POST(req({ login: "dave" })), DELETE(req({ login: "carol" }))]) {
      expect((await call).status).toBe(403);
    }
    // Nothing may be read or written on the way to the refusal.
    expect(addStoredAdmin).not.toHaveBeenCalled();
    expect(removeStoredAdmin).not.toHaveBeenCalled();
  });

  it("passes 401 through when there is no session at all", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 401 });
    expect((await GET(req())).status).toBe(401);
  });
});

describe("GET", () => {
  it("marks baked admins so the panel can refuse to remove them", async () => {
    const body = await (await GET(req())).json();
    expect(body.admins).toEqual([
      { login: "alice", baked: true },
      { login: "carol", baked: false },
    ]);
  });

  it("reports a login that is both baked and stored exactly once, as baked", async () => {
    // Happens when someone is granted at runtime and later added to
    // event.yaml. `baked` is what decides removability, so it must win.
    listStoredAdmins.mockResolvedValue(["alice", "carol"]);
    const body = await (await GET(req())).json();
    expect(body.admins.filter((a: { login: string }) => a.login === "alice")).toEqual([
      { login: "alice", baked: true },
    ]);
  });
});

describe("POST", () => {
  it("grants and records the acting admin", async () => {
    const res = await POST(req({ login: "dave" }));
    expect(res.status).toBe(200);
    expect(addStoredAdmin).toHaveBeenCalledWith("dave", "alice");
  });

  it("400s a non-string login without touching the store", async () => {
    expect((await POST(req({ login: 42 }))).status).toBe(400);
    expect(addStoredAdmin).not.toHaveBeenCalled();
  });

  it("surfaces a validation error as 400, not 500", async () => {
    addStoredAdmin.mockRejectedValue(new AdminValidationError("login", "'not a login' is not a GitHub login"));
    const res = await POST(req({ login: "not a login" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("not a GitHub login");
  });

  it("503s when the store is unreachable", async () => {
    addStoredAdmin.mockRejectedValue(new Error("redis down"));
    expect((await POST(req({ login: "dave" }))).status).toBe(503);
  });
});

describe("DELETE", () => {
  it("revokes a runtime grant", async () => {
    const res = await DELETE(req({ login: "carol" }));
    expect(res.status).toBe(200);
    expect(removeStoredAdmin).toHaveBeenCalledWith("carol", "alice");
  });

  // THE LOCKOUT GUARD. A baked admin is the recovery path when a runtime grant
  // goes wrong; if this could remove one, a mistake — or a compromised admin
  // session — could lock every organizer out of /admin with no way back but a
  // rebuild.
  it("refuses to remove a BAKED admin, and does not touch the store", async () => {
    isBakedAdmin.mockReturnValue(true);
    const res = await DELETE(req({ login: "alice" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("event.yaml");
    expect(removeStoredAdmin).not.toHaveBeenCalled();
  });

  it("allows removing yourself, since a baked admin always remains", async () => {
    requireAdmin.mockResolvedValue({ ok: true, login: "carol" });
    const res = await DELETE(req({ login: "carol" }));
    expect(res.status).toBe(200);
    expect(removeStoredAdmin).toHaveBeenCalledWith("carol", "carol");
  });

  it("400s a non-string login without touching the store", async () => {
    expect((await DELETE(req({ login: null }))).status).toBe(400);
    expect(removeStoredAdmin).not.toHaveBeenCalled();
  });
});
