// The build stamp `/health` reports.
//
// Two properties matter, and neither is "it returns the right string on a
// happy path". First, every field DEGRADES: this endpoint is what an operator
// polls when they already suspect something is wrong, so a missing build arg
// or an unreadable package.json must yield "unknown" rather than a 500.
// Second, the values are VALIDATED before being echoed — they arrive from the
// build environment and land in a world-readable response body.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  appVersion,
  normalizeBuiltAt,
  normalizeRevision,
  resetAppVersionCache,
  versionFromPackageJson,
} from "@/lib/app-version";

beforeEach(() => {
  resetAppVersionCache();
  vi.unstubAllEnvs();
});

describe("normalizeRevision", () => {
  it("accepts a short sha and a full one, lowercased", () => {
    expect(normalizeRevision("d3399e9")).toBe("d3399e9");
    expect(normalizeRevision("D3399E9ABCDE")).toBe("d3399e9abcde");
    expect(normalizeRevision("a".repeat(40))).toBe("a".repeat(40));
  });

  it("trims surrounding whitespace, which command substitution leaves behind", () => {
    expect(normalizeRevision(" d3399e9\n")).toBe("d3399e9");
  });

  it("reports unknown when the build passed nothing", () => {
    expect(normalizeRevision(undefined)).toBe("unknown");
    expect(normalizeRevision("")).toBe("unknown");
    expect(normalizeRevision("   ")).toBe("unknown");
  });

  // The reason this is validated rather than passed through: the value is
  // whatever the deploy shell produced, and it is echoed to the world.
  it("refuses anything that is not a hex sha", () => {
    expect(normalizeRevision("fatal: not a git repository")).toBe("unknown");
    expect(normalizeRevision("main")).toBe("unknown");
    expect(normalizeRevision("d3399e9-dirty")).toBe("unknown");
    expect(normalizeRevision("abc")).toBe("unknown"); // too short to be a sha
    expect(normalizeRevision("a".repeat(41))).toBe("unknown");
    expect(normalizeRevision("<script>alert(1)</script>")).toBe("unknown");
  });
});

describe("normalizeBuiltAt", () => {
  it("re-serializes a valid instant to ISO-8601", () => {
    expect(normalizeBuiltAt("2026-09-07T02:01:49Z")).toBe("2026-09-07T02:01:49.000Z");
  });

  it("is null when absent", () => {
    expect(normalizeBuiltAt(undefined)).toBeNull();
    expect(normalizeBuiltAt("")).toBeNull();
  });

  it("is null rather than echoing something unparseable", () => {
    expect(normalizeBuiltAt("not a date")).toBeNull();
    expect(normalizeBuiltAt("date: illegal option -- u")).toBeNull();
  });
});

describe("versionFromPackageJson", () => {
  it("reads the version field", () => {
    expect(versionFromPackageJson('{"version":"0.4.0"}')).toBe("0.4.0");
  });

  it("degrades on every shape that is not a usable version", () => {
    expect(versionFromPackageJson(null)).toBe("unknown"); // unreadable file
    expect(versionFromPackageJson("{ truncated")).toBe("unknown"); // partial write
    expect(versionFromPackageJson("{}")).toBe("unknown"); // no version key
    expect(versionFromPackageJson('{"version":""}')).toBe("unknown");
    expect(versionFromPackageJson('{"version":42}')).toBe("unknown"); // wrong type
  });
});

describe("appVersion", () => {
  it("reads the real package.json, so the wiring is exercised and not just the parser", () => {
    // vitest runs with cwd = apps/web, the same relationship the image has
    // (cwd = /app, package.json alongside). A version of "unknown" here would
    // mean the read path is broken even though every unit above passes.
    expect(appVersion().version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("carries the build args through when the image was built with them", () => {
    vi.stubEnv("APP_BUILD_REV", "d3399e9");
    vi.stubEnv("APP_BUILT_AT", "2026-09-07T02:01:49Z");
    resetAppVersionCache();
    expect(appVersion()).toMatchObject({
      revision: "d3399e9",
      builtAt: "2026-09-07T02:01:49.000Z",
    });
  });

  it("still answers when the image was built without them", () => {
    vi.stubEnv("APP_BUILD_REV", "");
    vi.stubEnv("APP_BUILT_AT", "");
    resetAppVersionCache();
    expect(appVersion()).toMatchObject({ revision: "unknown", builtAt: null });
  });

  it("reads once per process — /health may be polled on a timer", () => {
    vi.stubEnv("APP_BUILD_REV", "aaaaaaa");
    resetAppVersionCache();
    expect(appVersion().revision).toBe("aaaaaaa");
    // Changing the environment without resetting must NOT re-read: proving the
    // cache is real, not incidentally consistent.
    vi.stubEnv("APP_BUILD_REV", "bbbbbbb");
    expect(appVersion().revision).toBe("aaaaaaa");
    resetAppVersionCache();
    expect(appVersion().revision).toBe("bbbbbbb");
  });
});
