// AdminHeader's contract: the compact one-row header (admin-redesign.md PR
// 1) — event name, phase badge, and boundary text, all optional except the
// "Admin" label and event name, which always render.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// admin-header.tsx pulls PHASE_COLOR/phaseBoundaryLabel from phase-line.tsx,
// which imports the `server-only`-guarded admin-store.ts — mocked here so
// the real module (and its "server-only" import) never loads, same as
// page.test.tsx and phase-line.test.tsx do.
vi.mock("@/lib/admin-store", () => ({ getAdminSettings: vi.fn() }));

import AdminHeader from "@/app/(site)/admin/admin-header";

const HOUR = 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe("AdminHeader", () => {
  it("names the event and states the phase and boundary when settings resolved", () => {
    const html = renderToStaticMarkup(
      <AdminHeader
        eventName="Chapter CTF"
        resolution={{ phase: "live", startsAt: iso(-HOUR), endsAt: iso(HOUR) }}
      />,
    );
    expect(html).toContain("Admin");
    expect(html).toContain("Chapter CTF");
    expect(html).toContain(">live<");
    expect(html).toMatch(/until .+ UTC/);
  });

  it("still names the event with no phase badge when settings could not be read", () => {
    const html = renderToStaticMarkup(<AdminHeader eventName="Chapter CTF" resolution={null} />);
    expect(html).toContain("Admin");
    expect(html).toContain("Chapter CTF");
    expect(html).not.toContain(">live<");
    expect(html).not.toContain(">frozen<");
    expect(html).not.toMatch(/until .+ UTC/);
  });

  it("promises no boundary during a manual freeze, same as the public phase strip", () => {
    const html = renderToStaticMarkup(
      <AdminHeader eventName="Chapter CTF" resolution={{ phase: "frozen", startsAt: null, endsAt: iso(HOUR) }} />,
    );
    expect(html).toContain(">frozen<");
    expect(html).not.toMatch(/until|UTC/);
  });
});
