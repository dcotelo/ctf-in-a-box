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
  type ActivityEntry,
} from "@/app/(site)/admin/admin-activity-tab";

describe("AdminActivityTab initial view", () => {
  it("offers the load button and says what the log holds, with no table yet", () => {
    const html = renderToStaticMarkup(<AdminActivityTab />);
    expect(html).toContain("Load activity");
    expect(html).toMatch(/never a flag or an answer/i);
    expect(html).not.toContain("<table");
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
