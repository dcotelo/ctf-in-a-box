import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn<(o: { headers: Headers }) => Promise<unknown>>(),
  listStoredAdmins: vi.fn<() => Promise<string[]>>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/event-config", () => ({ eventConfig: { admins: ["Alice", "bob"] } }));
vi.mock("@/lib/admin-admins", () => ({ listStoredAdmins: mocks.listStoredAdmins }));

import { isAdminLogin, isBakedAdmin, listBakedAdmins, requireAdmin } from "@/lib/admin-auth";

const { getSession, listStoredAdmins } = mocks;

beforeEach(() => {
  getSession.mockReset();
  listStoredAdmins.mockReset();
  listStoredAdmins.mockResolvedValue([]);
});

describe("isBakedAdmin", () => {
  it("matches case-insensitively and never touches the store", () => {
    expect(isBakedAdmin("alice")).toBe(true);
    expect(isBakedAdmin("BOB")).toBe(true);
    expect(isBakedAdmin("carol")).toBe(false);
    expect(isBakedAdmin(undefined)).toBe(false);
    // The point of the sync check: it answers without Redis, so a baked
    // organizer can still get in while the datastore is down.
    expect(listStoredAdmins).not.toHaveBeenCalled();
  });

  it("lists the baked set for the panel to mark as unremovable", () => {
    expect(listBakedAdmins()).toEqual(["alice", "bob"]);
  });
});

describe("isAdminLogin", () => {
  it("matches baked admins case-insensitively", async () => {
    expect(await isAdminLogin("alice")).toBe(true);
    expect(await isAdminLogin("BOB")).toBe(true);
    expect(await isAdminLogin(undefined)).toBe(false);
  });

  it("matches a runtime grant that is not baked", async () => {
    listStoredAdmins.mockResolvedValue(["carol"]);
    expect(await isAdminLogin("carol")).toBe(true);
    expect(await isAdminLogin("CAROL")).toBe(true);
    expect(await isAdminLogin("dave")).toBe(false);
  });
});

describe("requireAdmin", () => {
  it("401 with no session", async () => {
    getSession.mockResolvedValue(null);
    expect(await requireAdmin(new Headers())).toEqual({ ok: false, status: 401 });
  });

  it("403 when the login is neither baked nor granted", async () => {
    getSession.mockResolvedValue({ user: { login: "carol" } });
    expect(await requireAdmin(new Headers())).toEqual({ ok: false, status: 403 });
  });

  it("403 when the session has no user.login at all", async () => {
    getSession.mockResolvedValue({ user: {} });
    expect(await requireAdmin(new Headers())).toEqual({ ok: false, status: 403 });
  });

  it("passes a baked login (case-insensitive)", async () => {
    getSession.mockResolvedValue({ user: { login: "ALICE" } });
    expect(await requireAdmin(new Headers())).toEqual({ ok: true, login: "ALICE" });
  });

  it("passes a runtime-granted login", async () => {
    listStoredAdmins.mockResolvedValue(["carol"]);
    getSession.mockResolvedValue({ user: { login: "Carol" } });
    expect(await requireAdmin(new Headers())).toEqual({ ok: true, login: "Carol" });
  });

  // THE ONE THAT MATTERS. admin-auth gates access, so an unreachable datastore
  // must DENY. This is deliberately the opposite of the manual-freeze read in
  // admin-store, which fails OPEN so a Redis blip cannot drop live
  // submissions — a safety switch and an access check want opposite defaults.
  it("403 — not 200 — when the store is unreachable", async () => {
    listStoredAdmins.mockRejectedValue(new Error("redis down"));
    getSession.mockResolvedValue({ user: { login: "carol" } });
    expect(await requireAdmin(new Headers())).toEqual({ ok: false, status: 403 });
  });

  it("still admits a BAKED admin when the store is unreachable", async () => {
    // The recovery path: the organizer listed in event.yaml can reach /admin
    // precisely when Redis is broken, which is when they most need to.
    listStoredAdmins.mockRejectedValue(new Error("redis down"));
    getSession.mockResolvedValue({ user: { login: "alice" } });
    expect(await requireAdmin(new Headers())).toEqual({ ok: true, login: "alice" });
  });
});
