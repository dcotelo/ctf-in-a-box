// AdminSidebar's own contract, isolated from the settings/panel plumbing
// admin-controls.test.tsx already covers: which groups render, which single
// item is marked current, and the drawer's collapsed-by-default markup. No
// real viewport in this render (renderToStaticMarkup, no jsdom layout), so
// the "collapses below `lg`" claim is pinned at the className level — the
// classes that make the nav `hidden` under `lg` and `flex` at `lg:` and
// above — same as the rest of this repo's responsive-class assertions.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AdminSidebar, { type SidebarGroup } from "@/app/(site)/admin/admin-sidebar";

const groups: readonly SidebarGroup[] = [
  {
    heading: "Run",
    items: [
      { id: "overview", label: "Overview" },
      { id: "activity", label: "Activity" },
    ],
  },
  {
    heading: "Content",
    items: [{ id: "quiz", label: "Quiz" }],
  },
  {
    heading: "Setup",
    items: [
      { id: "event", label: "Event" },
      { id: "admins", label: "Admins" },
    ],
  },
];

describe("AdminSidebar", () => {
  it("renders every group heading and every item inside its own group", () => {
    const html = renderToStaticMarkup(<AdminSidebar groups={groups} active="overview" onSelect={() => {}} />);
    expect(html).toContain("Run");
    expect(html).toContain("Content");
    expect(html).toContain("Setup");
    for (const label of ["Overview", "Activity", "Quiz", "Event", "Admins"]) {
      expect(html).toContain(label);
    }
  });

  it("marks exactly the active destination current, and links every other one plainly", () => {
    const html = renderToStaticMarkup(<AdminSidebar groups={groups} active="quiz" onSelect={() => {}} />);
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(html).toContain('href="/admin/quiz" aria-current="page"');
    // A non-active destination is still a real link — just with no
    // aria-current — so it stays reachable by Tab in normal document order.
    expect(html).toContain('href="/admin/event"');
    expect(html).not.toContain('href="/admin/event" aria-current="page"');
  });

  it("is a nav, not the old tabs widget", () => {
    const html = renderToStaticMarkup(<AdminSidebar groups={groups} active="overview" onSelect={() => {}} />);
    expect(html).toContain('aria-label="Admin sections"');
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain('role="tablist"');
  });

  it("collapses to a drawer below `lg`, closed by default and toggled by a labelled button", () => {
    const html = renderToStaticMarkup(<AdminSidebar groups={groups} active="overview" onSelect={() => {}} />);
    // Closed by default: the nav carries `hidden` (below `lg`) and `lg:flex`
    // (so it always shows at `lg` and above regardless of the drawer state).
    expect(html).toMatch(/<nav[^>]*class="hidden [^"]*lg:flex[^"]*"/);
    // The toggle itself is `lg:hidden` — desktop never sees it — and starts
    // collapsed.
    expect(html).toMatch(/aria-expanded="false"[^>]*class="[^"]*lg:hidden/);
  });
});
