// The Activity tab (issue #212). renderToStaticMarkup only (no
// testing-library in this repo, by choice), so these assert the initial
// server-derived view — anything behind the load button never appears in a
// static render — and drive the filter/format logic through the exported
// helpers directly.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import AdminActivityTab, {
  filterEntries,
  formatWhen,
  refreshLimit,
  type ActivityEntry,
} from "@/app/(site)/admin/admin-activity-tab";

describe("AdminActivityTab initial view", () => {
  it("offers the load button and says what the log holds, with no table yet", () => {
    const html = renderToStaticMarkup(<AdminActivityTab />);
    expect(html).toContain("Load activity");
    expect(html).toMatch(/never a flag or an answer/i);
    expect(html).not.toContain("<table");
  });

  it("shows the load button as primary while nothing is loaded — the poll has not run yet", () => {
    const html = renderToStaticMarkup(<AdminActivityTab visible live />);
    expect(html).toMatch(/<button[^>]*bg-\[#2563eb\][^>]*>Load activity/);
    // The stamp has nothing to say before a first load lands.
    expect(html).not.toContain("updated ");
  });
});

// A timed refresh re-reads from the top; this decides how far down. Dropping
// rows the organizer had paged in would make the log jump under them every
// 15 seconds.
describe("refreshLimit", () => {
  it("re-reads at least a page", () => {
    expect(refreshLimit(0)).toBe(200);
    expect(refreshLimit(37)).toBe(200);
  });

  it("keeps everything already paged in", () => {
    expect(refreshLimit(400)).toBe(400);
  });

  it("stops at the route's cap", () => {
    expect(refreshLimit(900)).toBe(500);
  });
});

describe("formatWhen", () => {
  it("renders a compact UTC stamp sliced from the ISO string, no clock read", () => {
    expect(formatWhen("2026-08-24T18:03:27.000Z")).toBe("08-24 18:03");
  });
});

describe("filterEntries", () => {
  const entries: ActivityEntry[] = [
    { at: "2026-08-24T18:00:00.000Z", type: "login", login: "octocat" },
    { at: "2026-08-24T18:01:00.000Z", type: "classic-solve", login: "OctoCat", detail: "crypto-1" },
    { at: "2026-08-24T18:02:00.000Z", type: "login", login: "hubot" },
  ];

  it("passes everything through with no filters", () => {
    expect(filterEntries(entries, null, "")).toEqual(entries);
  });

  it("filters by type", () => {
    expect(filterEntries(entries, "login", "").map((e) => e.login)).toEqual(["octocat", "hubot"]);
  });

  it("matches login as a case-insensitive substring", () => {
    expect(filterEntries(entries, null, "OCTO")).toHaveLength(2);
    expect(filterEntries(entries, null, "  hub ").map((e) => e.login)).toEqual(["hubot"]);
  });

  it("applies both filters together", () => {
    expect(filterEntries(entries, "classic-solve", "octo")).toEqual([entries[1]]);
  });
});
