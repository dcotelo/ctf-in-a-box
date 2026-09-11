// The Forbidden wall's fail-closed notice (config v2, coordinator review
// round 1 on #386's Task 2). The Admins tab cannot carry this warning —
// requireAdmin refuses EVERY login while ADMIN_LOGINS is empty, so nobody
// ever reaches that tab in that state — so the wall itself says so instead.
// Only a boolean (listEnvAdmins().length === 0) crosses into the render; the
// allowlist itself must never appear in markup. `listEnvAdmins` is read from
// `admin-auth.ts`, the same module-load snapshot `requireAdmin` already
// checked, rather than a second `bootstrap-env.envAdmins()` read (#386
// review round 3A-1 — one snapshot for the gate and the wall).
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { requireAdmin, listEnvAdmins } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listEnvAdmins: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin, listEnvAdmins }));

import AdminPanel from "@/app/(site)/admin/admin-panel";

describe("admin panel Forbidden wall", () => {
  it("warns when ADMIN_LOGINS is empty or holds no valid login", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    listEnvAdmins.mockReturnValue([]);
    const html = renderToStaticMarkup(await AdminPanel({}));
    expect(html).toMatch(/organizer/i);
    // Not "ADMIN_LOGINS is empty" alone: a typo'd value (e.g. an email
    // address instead of a login) also parses to an empty set, and the old
    // wording read as false to an organizer who can see the variable is set
    // (#386 review).
    expect(html).toContain(
      "ADMIN_LOGINS is empty or holds no valid GitHub login — nobody can use /admin until it is set and the app restarts.",
    );
  });

  it("stays quiet when ADMIN_LOGINS is non-empty — this viewer is just not on it", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    listEnvAdmins.mockReturnValue(["alice"]);
    const html = renderToStaticMarkup(await AdminPanel({}));
    expect(html).toMatch(/organizer/i);
    expect(html).not.toContain("ADMIN_LOGINS is empty");
  });

  // The allowlist itself must never leak into the wall's markup — only the
  // fact that it is empty (or not) may cross the server/client boundary.
  it("never renders the env admin logins themselves", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    listEnvAdmins.mockReturnValue(["shouldnotleak"]);
    const html = renderToStaticMarkup(await AdminPanel({}));
    expect(html).not.toContain("shouldnotleak");
  });
});
