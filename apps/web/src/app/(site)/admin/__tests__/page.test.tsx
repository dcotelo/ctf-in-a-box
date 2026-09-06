// @testing-library/react is not a dependency of this repo and must not be
// added just for this test. renderToStaticMarkup (ships with react-dom) is
// enough to check the initial server render of the page + its client
// controls, since we only assert on markup text, not interaction.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { requireAdmin, getAdminSettings, getSyncStatus, getResolvedModules, getModuleSetup } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getAdminSettings: vi.fn(),
  getSyncStatus: vi.fn(),
  // The registry's setup block is a FUNCTION of the org context (it names
  // the event's targets and GitHub org), so the page must call it here and
  // hand the resulting plain data to the client shell — the same rule
  // `home`/`guide`/`faq` follow. This stub is what the page is expected to
  // invoke; the assertion below checks its output reached the markup.
  getModuleSetup: vi.fn((id: string) =>
    id === "secure-development"
      ? (ctx: { githubOrg: string; appList: string }) => ({
          experience: `Contestants fork ${ctx.appList} under ${ctx.githubOrg} and patch it.`,
          steps: [{ title: "Provision the org", where: "outside" as const }],
          midEvent: { safe: [], unsafe: [] },
          docs: { href: "https://example.test/operations", label: "Operations" },
        })
      : undefined,
  ),
  // The real one calls `connection()`, which needs a request context that
  // renderToStaticMarkup does not provide — and the resolution itself has its
  // own suite (lib/__tests__/resolved-modules.test.ts).
  getResolvedModules: vi.fn(async () => [
    {
      id: "secure-development",
      title: "Secure Development",
      blurb: "Find the vulnerability, patch it for real, ship the fix as a PR.",
      targets: ["juice-shop"],
    },
  ]),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin }));
vi.mock("@/lib/admin-store", () => ({ getAdminSettings, getSyncStatus }));
vi.mock("@/lib/resolved-modules", () => ({ getResolvedModules, getModuleSetup }));

import AdminPage from "@/app/(site)/admin/page";

describe("admin page gate", () => {
  it("renders a forbidden view for a non-admin", async () => {
    requireAdmin.mockResolvedValue({ ok: false, status: 403 });
    const ui = await AdminPage({ searchParams: Promise.resolve({}) });
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
      moduleOverrides: {},
    });
    getSyncStatus.mockResolvedValue({
      lastPollAt: "2026-08-14T00:00:00Z",
      lastError: null,
      ingested: 3,
      dropped: 0,
      lastDrop: null,
      reposPolled: 2,
      paused: false,
    });
    const ui = await AdminPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(ui);
    expect(html).toMatch(/freeze|pause/i);
    expect(html).toMatch(/last poll|ingested/i);
  });

  it("resolves each module's setup block server-side and renders it in that module's panel", async () => {
    requireAdmin.mockResolvedValue({ ok: true, login: "alice" });
    getAdminSettings.mockResolvedValue({
      paused: false,
      hintsEnabled: null,
      hintCost: null,
      updatedBy: null,
      updatedAt: null,
      moduleOverrides: {},
    });
    getSyncStatus.mockResolvedValue(null);
    const ui = await AdminPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(ui);
    expect(getModuleSetup).toHaveBeenCalledWith("secure-development");
    // Interpolated from the real event config the page builds its context
    // from, so the sentence proves the function was CALLED, not just found.
    expect(html).toMatch(/Contestants fork .+ under .+ and patch it\./);
    // Steps done OUTSIDE the panel (provisioning, ctf-setup.sh) are not
    // repeated on an enabled module's screen — the guide link carries them
    // (admin-redesign.md § Content screens; see admin-module-setup.tsx).
    expect(html).not.toContain("Provision the org");
    expect(html).toContain('href="https://example.test/operations"');
    expect(html).toContain("One provisioning step done outside this panel is not repeated here");
  });

  // A healthy poller must not show a warning: an amber "Dropped" that is
  // always lit is one organizers stop seeing, which would defeat the whole
  // point of putting it beside Ingested.
  it("shows a quiet Dropped counter and no last-drop line when nothing was dropped", async () => {
    requireAdmin.mockResolvedValue({ ok: true, login: "alice" });
    getAdminSettings.mockResolvedValue({
      paused: false, hintsEnabled: null, hintCost: null,
      updatedBy: null, updatedAt: null, moduleOverrides: {},
    });
    getSyncStatus.mockResolvedValue({
      lastPollAt: "2026-08-14T00:00:00Z", lastError: null,
      ingested: 3, dropped: 0, lastDrop: null, reposPolled: 2, paused: false,
    });
    const html = renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({}) }));
    expect(html).toMatch(/Dropped/);
    expect(html).not.toMatch(/Last drop/);
    // No hex assertion: #d4a017 is now the theme-wide signal color (focus
    // rings, the Right-now readout), so its presence no longer implies the
    // drop warning — the /Last drop/ line above is the real pin.
  });

  it("surfaces the drop count and what was dropped when the poller lost a score", async () => {
    requireAdmin.mockResolvedValue({ ok: true, login: "alice" });
    getAdminSettings.mockResolvedValue({
      paused: false, hintsEnabled: null, hintCost: null,
      updatedBy: null, updatedAt: null, moduleOverrides: {},
    });
    getSyncStatus.mockResolvedValue({
      lastPollAt: "2026-08-14T00:00:00Z", lastError: null, ingested: 3, dropped: 2,
      lastDrop: "submit DVWA#7: rejected (4xx), dropped", reposPolled: 2, paused: false,
    });
    const html = renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({}) }));
    // The count itself, in its own cell — not merely a "2" loose in the markup.
    expect(html).toMatch(/Dropped<\/dt>[\s\S]{0,160}?>2</);
    expect(html).toContain("submit DVWA#7: rejected (4xx), dropped");
    // The amber class on the Dropped value itself — the page is full of
    // amber focus/schedule classes, so a whole-document contains() proves
    // nothing about this cell.
    expect(html).toMatch(/Dropped<\/dt><dd[^>]*text-\[#d4a017\]/);
  });

  it("shows 'sync not running' when there is no sync status yet", async () => {
    requireAdmin.mockResolvedValue({ ok: true, login: "alice" });
    getAdminSettings.mockResolvedValue({
      paused: false,
      hintsEnabled: null,
      hintCost: null,
      updatedBy: null,
      updatedAt: null,
      moduleOverrides: {},
    });
    getSyncStatus.mockResolvedValue(null);
    const ui = await AdminPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(ui);
    expect(html).toMatch(/sync not running/i);
  });

  it("degrades gracefully instead of 500ing when the settings read fails", async () => {
    requireAdmin.mockResolvedValue({ ok: true, login: "alice" });
    getAdminSettings.mockRejectedValue(new Error("redis down"));
    getSyncStatus.mockResolvedValue(null);
    const ui = await AdminPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(ui);
    expect(html).toMatch(/unavailable/i);
  });
});

// `/quiz` and `/flags` route an organizer here from their empty states, and a
// link that lands on the Event tab has not actually delivered them to the
// authoring controls.
describe("?tab= deep link", () => {
  const settings = {
    paused: false,
    hintsEnabled: null,
    hintCost: null,
    updatedBy: null,
    updatedAt: null,
    moduleOverrides: {},
  };

  async function render(searchParams: Record<string, string | string[] | undefined>) {
    requireAdmin.mockResolvedValue({ ok: true, login: "alice" });
    getAdminSettings.mockResolvedValue(settings);
    getSyncStatus.mockResolvedValue(null);
    getResolvedModules.mockResolvedValue([
      { id: "secure-development", title: "Secure Development", blurb: "b", targets: ["juice-shop"] },
      { id: "quiz", title: "Quiz", blurb: "b", targets: [] },
    ]);
    return renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve(searchParams) }));
  }

  /** Which sidebar destination the shell reports as current — the only
   *  assertion that survives every panel being mounted at once (they are,
   *  deliberately, so a half-typed form isn't lost on a tab switch). */
  function selectedTab(html: string): string | null {
    const match = html.match(/href="\?tab=([a-z-]+)"[^>]*aria-current="page"/);
    return match ? match[1] : null;
  }

  it("opens the Overview destination with no parameter", async () => {
    expect(selectedTab(await render({}))).toBe("overview");
  });

  it("opens the named module's tab", async () => {
    expect(selectedTab(await render({ tab: "quiz" }))).toBe("quiz");
  });

  // A stale bookmark, a typo, or a link to a module this event did not enable
  // must land somewhere real rather than on an empty shell.
  it("falls back to Overview for a tab this event does not have", async () => {
    expect(selectedTab(await render({ tab: "classic" }))).toBe("overview");
    expect(selectedTab(await render({ tab: "nonsense" }))).toBe("overview");
    expect(selectedTab(await render({ tab: ["quiz", "event"] }))).toBe("overview");
  });
});
