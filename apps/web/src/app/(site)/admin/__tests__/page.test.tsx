// @testing-library/react is not a dependency of this repo and must not be
// added just for this test. renderToStaticMarkup (ships with react-dom) is
// enough to check the initial server render of the page + its client
// controls, since we only assert on markup text, not interaction.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { requireAdmin, getAdminSettings, getSyncStatus } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getAdminSettings: vi.fn(),
  getSyncStatus: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin }));
vi.mock("@/lib/admin-store", () => ({ getAdminSettings, getSyncStatus }));

import AdminPage from "@/app/(site)/admin/page";

describe("admin page gate", () => {
  it("renders a forbidden view for a non-admin", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    const ui = await AdminPage();
    const html = renderToStaticMarkup(ui);
    expect(html).toMatch(/organizer/i);
  });

  it("renders controls for an admin", async () => {
    requireAdmin.mockResolvedValue({ ok: true, login: "alice" });
    getAdminSettings.mockResolvedValue({
      paused: false,
      hintsEnabled: null,
      hintCost: null,
      updatedBy: null,
      updatedAt: null,
    });
    getSyncStatus.mockResolvedValue({
      lastPollAt: "2026-08-14T00:00:00Z",
      lastError: null,
      ingested: 3,
      reposPolled: 2,
      paused: false,
    });
    const ui = await AdminPage();
    const html = renderToStaticMarkup(ui);
    expect(html).toMatch(/freeze|pause/i);
    expect(html).toMatch(/last poll|ingested/i);
  });

  it("shows 'sync not running' when there is no sync status yet", async () => {
    requireAdmin.mockResolvedValue({ ok: true, login: "alice" });
    getAdminSettings.mockResolvedValue({
      paused: false,
      hintsEnabled: null,
      hintCost: null,
      updatedBy: null,
      updatedAt: null,
    });
    getSyncStatus.mockResolvedValue(null);
    const ui = await AdminPage();
    const html = renderToStaticMarkup(ui);
    expect(html).toMatch(/sync not running/i);
  });
});
