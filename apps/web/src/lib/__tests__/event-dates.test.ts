import { describe, expect, it } from "vitest";
import { formatDateRange } from "@/lib/event-dates";

describe("formatDateRange", () => {
  it("same day → one date", () => {
    expect(formatDateRange("2026-10-01T09:00:00Z", "2026-10-01T18:00:00Z")).toBe("Oct 1, 2026");
  });

  it("same year → 'Oct 1 – Oct 3, 2026'", () => {
    expect(formatDateRange("2026-10-01T09:00:00Z", "2026-10-03T18:00:00Z")).toBe(
      "Oct 1 – Oct 3, 2026",
    );
  });

  it("different years → both years", () => {
    expect(formatDateRange("2026-12-31T20:00:00Z", "2027-01-02T02:00:00Z")).toBe(
      "Dec 31, 2026 – Jan 2, 2027",
    );
  });

  it("start only → 'From Oct 1, 2026'", () => {
    expect(formatDateRange("2026-10-01T09:00:00Z", null)).toBe("From Oct 1, 2026");
  });

  it("end only → 'Until Oct 3, 2026'", () => {
    expect(formatDateRange(null, "2026-10-03T18:00:00Z")).toBe("Until Oct 3, 2026");
  });

  it("none or unparseable → ''", () => {
    expect(formatDateRange(null, null)).toBe("");
    expect(formatDateRange("nope", null)).toBe("");
  });
});
