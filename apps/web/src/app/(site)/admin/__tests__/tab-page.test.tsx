// `/admin/<tab>` — the canonical, linkable form of every admin destination.
//
// Same mocks and same shape as page.test.tsx (the `?tab=` entry), because the
// point of these cases is that the two routes are the SAME panel: one gate,
// one set of reads, one fallback. A difference between them is the bug this
// file exists to catch.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { requireAdmin, getAdminSettings, getSyncStatus, getResolvedModules, getModuleSetup } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getAdminSettings: vi.fn(),
  getSyncStatus: vi.fn(),
  getModuleSetup: vi.fn(() => undefined),
  getResolvedModules: vi.fn(async () => [
    { id: "secure-development", title: "Secure Development", blurb: "", targets: ["juice-shop"] },
    { id: "quiz", title: "Quiz", blurb: "", targets: [] },
  ]),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin }));
vi.mock("@/lib/admin-store", () => ({ getAdminSettings, getSyncStatus }));
vi.mock("@/lib/resolved-modules", () => ({ getResolvedModules, getModuleSetup }));

import AdminTabPage from "@/app/(site)/admin/[tab]/page";

// The same minimal settings shape page.test.tsx uses — `moduleOverrides` is
// not optional in practice: the module panels index into it.
const SETTINGS = {
  paused: false,
  hintsEnabled: null,
  hintCost: null,
  updatedBy: null,
  updatedAt: null,
  moduleOverrides: {},
};

async function render(tab: string): Promise<string> {
  return renderToStaticMarkup(await AdminTabPage({ params: Promise.resolve({ tab }) }));
}

function selectedTab(html: string): string | null {
  const match = html.match(/href="\/admin\/([a-z-]+)"[^>]*aria-current="page"/);
  return match ? match[1] : null;
}

function asAdmin(): void {
  requireAdmin.mockResolvedValue({ ok: true, login: "alice" });
  getAdminSettings.mockResolvedValue(SETTINGS);
  getSyncStatus.mockResolvedValue(null);
}

describe("/admin/<tab>", () => {
  it("gates exactly like /admin — a non-admin gets the courteous wall, not a 404", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    expect(await render("overview")).toMatch(/organizer/i);
  });

  it("opens the destination the path names", async () => {
    asAdmin();
    expect(selectedTab(await render("activity"))).toBe("activity");
    expect(selectedTab(await render("insights"))).toBe("insights");
    expect(selectedTab(await render("quiz"))).toBe("quiz");
  });

  it("falls back to Overview for a segment this event has no tab for", async () => {
    asAdmin();
    // A stale runbook link, a typo, or a module this event never enabled —
    // all land somewhere real rather than on a 404.
    expect(selectedTab(await render("classic"))).toBe("overview");
    expect(selectedTab(await render("nonsense"))).toBe("overview");
  });

  it("links every destination as a path, never the old query form", async () => {
    asAdmin();
    const html = await render("overview");
    expect(html).toContain('href="/admin/hints"');
    expect(html).toContain('href="/admin/secure-development"');
    expect(html).not.toContain('href="?tab=');
  });
});
