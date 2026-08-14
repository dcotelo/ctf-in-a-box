import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn<(o: { headers: Headers }) => Promise<unknown>>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/event-config", () => ({ eventConfig: { admins: ["Alice", "bob"] } }));

import { isAdminLogin, requireAdmin } from "@/lib/admin-auth";

const { getSession } = mocks;

beforeEach(() => getSession.mockReset());

describe("isAdminLogin", () => {
  it("matches case-insensitively", () => {
    expect(isAdminLogin("alice")).toBe(true);
    expect(isAdminLogin("BOB")).toBe(true);
    expect(isAdminLogin("carol")).toBe(false);
    expect(isAdminLogin(undefined)).toBe(false);
  });
});

describe("requireAdmin", () => {
  it("401 with no session", async () => {
    getSession.mockResolvedValue(null);
    expect(await requireAdmin(new Headers())).toEqual({ ok: false, status: 401 });
  });

  it("403 when the login is not an admin", async () => {
    getSession.mockResolvedValue({ user: { login: "carol" } });
    expect(await requireAdmin(new Headers())).toEqual({ ok: false, status: 403 });
  });

  it("passes an allowlisted login (case-insensitive)", async () => {
    getSession.mockResolvedValue({ user: { login: "ALICE" } });
    expect(await requireAdmin(new Headers())).toEqual({ ok: true, login: "ALICE" });
  });
});
