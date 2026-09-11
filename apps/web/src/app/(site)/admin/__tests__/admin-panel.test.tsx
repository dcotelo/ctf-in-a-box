// The Forbidden wall's fail-closed notice (config v2, coordinator review
// round 1 on #386's Task 2). The Admins tab cannot carry this warning —
// requireAdmin refuses EVERY login while ADMIN_LOGINS is empty, so nobody
// ever reaches that tab in that state — so the wall itself says so instead.
// Only a boolean (envAdmins().size === 0) crosses into the render; the
// allowlist itself must never appear in markup.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { requireAdmin, envAdmins } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  envAdmins: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin }));
vi.mock("@/lib/bootstrap-env", () => ({ envAdmins }));

import AdminPanel from "@/app/(site)/admin/admin-panel";

describe("admin panel Forbidden wall", () => {
  it("warns when ADMIN_LOGINS is empty", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    envAdmins.mockReturnValue(new Set());
    const html = renderToStaticMarkup(await AdminPanel({}));
    expect(html).toMatch(/organizer/i);
    expect(html).toContain(
      "ADMIN_LOGINS is empty — nobody can use /admin until it is set and the app restarts.",
    );
  });

  it("stays quiet when ADMIN_LOGINS is non-empty — this viewer is just not on it", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    envAdmins.mockReturnValue(new Set(["alice"]));
    const html = renderToStaticMarkup(await AdminPanel({}));
    expect(html).toMatch(/organizer/i);
    expect(html).not.toContain("ADMIN_LOGINS is empty");
  });

  // The allowlist itself must never leak into the wall's markup — only the
  // fact that it is empty (or not) may cross the server/client boundary.
  it("never renders the env admin logins themselves", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    envAdmins.mockReturnValue(new Set(["shouldnotleak"]));
    const html = renderToStaticMarkup(await AdminPanel({}));
    expect(html).not.toContain("shouldnotleak");
  });
});
