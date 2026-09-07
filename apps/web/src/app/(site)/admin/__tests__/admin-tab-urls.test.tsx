// The admin panel's two URL shapes. `/admin/<tab>` is what the sidebar links
// to and what an organizer bookmarks or pastes into a runbook; `/admin?tab=`
// is the original form, still honoured because docs, older bookmarks and
// cross-links carry it.
//
// Both hand the same string to the same shell, so what is pinned here is the
// pair of pure helpers that decide it — no DOM required, which matters
// because this repo's tests run in vitest's `node` environment.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adminTabHref, resolveAdminTab, tabFromLocation } from "@/app/(site)/admin/admin-tabs";

describe("adminTabHref", () => {
  it("builds the canonical path for a tab", () => {
    expect(adminTabHref("overview")).toBe("/admin/overview");
    expect(adminTabHref("activity")).toBe("/admin/activity");
    expect(adminTabHref("secure-development")).toBe("/admin/secure-development");
  });
});

describe("tabFromLocation", () => {
  it("reads the path segment of the canonical form", () => {
    expect(tabFromLocation("/admin/insights", "")).toBe("insights");
    expect(tabFromLocation("/admin/secure-development", "")).toBe("secure-development");
  });

  it("still reads the older query form", () => {
    expect(tabFromLocation("/admin", "?tab=hints")).toBe("hints");
  });

  it("prefers an explicit ?tab= over the path — a deep link means what it says", () => {
    expect(tabFromLocation("/admin/overview", "?tab=admins")).toBe("admins");
  });

  it("is empty for the bare panel, which the caller reads as Overview", () => {
    expect(tabFromLocation("/admin", "")).toBe("");
    expect(tabFromLocation("/admin/", "")).toBe("");
  });

  it("ignores anything below the tab segment rather than mangling it", () => {
    expect(tabFromLocation("/admin/quiz/extra", "")).toBe("quiz");
  });

  it("decodes a percent-encoded segment", () => {
    expect(tabFromLocation("/admin/secure%2Ddevelopment", "")).toBe("secure-development");
  });

  it("survives a malformed percent-escape instead of throwing", () => {
    // Browser history really can hold `/admin/%`. A throwing
    // decodeURIComponent inside the popstate handler would leave the panel
    // showing one destination while the URL says another.
    expect(tabFromLocation("/admin/%", "")).toBe("");
    expect(tabFromLocation("/admin/%E0%A4%A", "")).toBe("");
    // …and a bad path still yields to an explicit query.
    expect(tabFromLocation("/admin/%", "?tab=hints")).toBe("hints");
  });

  it("treats a repeated ?tab= as absent rather than picking one", () => {
    expect(tabFromLocation("/admin/insights", "?tab=hints&tab=event")).toBe("insights");
    expect(tabFromLocation("/admin", "?tab=hints&tab=event")).toBe("");
  });
});

describe("resolveAdminTab", () => {
  it("is the one rule both routes and the popstate handler share", () => {
    expect(resolveAdminTab("overview", undefined)).toBe("overview");
    expect(resolveAdminTab(undefined, "hints")).toBe("hints");
    // The query is the more specific of the two, and what old links carry.
    expect(resolveAdminTab("overview", "admins")).toBe("admins");
  });

  it("ignores an empty or repeated query and falls back to the path", () => {
    expect(resolveAdminTab("quiz", "")).toBe("quiz");
    expect(resolveAdminTab("quiz", [])).toBe("quiz");
    expect(resolveAdminTab("quiz", ["hints", "event"])).toBe("quiz");
  });

  it("counts repeats before dropping empties — one blank half is still a repeat", () => {
    // `?tab=&tab=admins` supplied the parameter twice. Filtering the empty
    // one away first would leave a single value and quietly select it,
    // against the rule that a repeated parameter is unusable.
    expect(resolveAdminTab("overview", ["", "admins"])).toBe("overview");
    expect(resolveAdminTab("overview", ["admins", ""])).toBe("overview");
    expect(resolveAdminTab(undefined, ["", "admins"])).toBe("");
  });

  it("is empty when neither source names a tab", () => {
    expect(resolveAdminTab(undefined, undefined)).toBe("");
    expect(resolveAdminTab(undefined, ["a", "b"])).toBe("");
  });
});

// The RSC boundary these helpers sit on (issue #312).
//
// This is a STATIC check on purpose. The bug it guards — a Server Component
// calling a function exported from a `"use client"` module — took every
// `/admin` URL to the error boundary in production while `next build`, vitest
// and the whole CI matrix stayed green: vitest has no RSC boundary, so
// `"use client"` is inert here and the call simply succeeds. No behavioural
// assertion in this suite can fail on it, so the file relationships are what
// gets pinned instead. The end-to-end proof lives in scripts/acceptance-app.sh,
// which requests /admin against a real built image and asserts on rendered copy.
describe("the RSC boundary", () => {
  const adminDir = join(import.meta.dirname, "..");
  const read = (f: string) => readFileSync(join(adminDir, f), "utf8");

  it("admin-tabs.ts is not a Client Component", () => {
    // The moment this file carries the marker, every server caller below breaks
    // again — and breaks the same silent way.
    expect(read("admin-tabs.ts")).not.toMatch(/^\s*["']use client["']/m);
  });

  it("admin-tabs.ts imports nothing that could carry the marker", () => {
    // A transitive `"use client"` puts it back on the client side of the
    // boundary just as effectively as its own marker would.
    const imports = [...read("admin-tabs.ts").matchAll(/^\s*import\s.*?from\s+["']([^"']+)["']/gm)];
    expect(imports.map((m) => m[1])).toEqual([]);
  });

  for (const route of ["page.tsx", join("[tab]", "page.tsx")]) {
    it(`${route} takes resolveAdminTab from admin-tabs, not admin-controls`, () => {
      const src = read(route);
      expect(src).toContain('from "@/app/(site)/admin/admin-tabs"');
      // admin-controls.tsx is `"use client"`; importing a callable from it here
      // is the exact defect. Rendering <AdminControls/> is fine, so only the
      // helper import is banned, not the module name appearing at all.
      expect(src).not.toMatch(/import\s*\{[^}]*\b(resolveAdminTab|adminTabHref|tabFromLocation)\b[^}]*\}\s*from\s*["'][^"']*admin-controls["']/);
    });
  }
});
