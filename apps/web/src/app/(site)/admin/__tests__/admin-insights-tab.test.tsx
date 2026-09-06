// The Insights tab. renderToStaticMarkup only (no testing-library in this
// repo, by choice), so this pins the initial view — nothing behind the fetch
// ever appears in a static render — and drives the sparkline's time axis
// through the exported pure helper.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AdminInsightsTab, { axisLabels } from "@/app/(site)/admin/admin-insights-tab";

describe("AdminInsightsTab initial view", () => {
  it("offers the compute button, as primary, and says where the numbers come from", () => {
    const html = renderToStaticMarkup(<AdminInsightsTab visible live />);
    expect(html).toMatch(/<button[^>]*bg-\[#2563eb\][^>]*>Compute metrics/);
    expect(html).toMatch(/nothing is collected from contestants/i);
    expect(html).not.toContain("<table");
    // The stamp has nothing to say before a first load lands.
    expect(html).not.toContain("updated ");
  });
});

describe("axisLabels", () => {
  const bucket = (iso: string) => ({ at: iso });

  it("gives first, middle and last bucket as HH:MM inside one day", () => {
    const timeline = [
      bucket("2026-08-24T18:00:00.000Z"),
      bucket("2026-08-24T18:10:00.000Z"),
      bucket("2026-08-24T18:20:00.000Z"),
      bucket("2026-08-24T18:30:00.000Z"),
      bucket("2026-08-24T18:40:00.000Z"),
    ];
    expect(axisLabels(timeline)).toEqual({ start: "18:00", mid: "18:20", end: "18:40" });
  });

  it("prefixes the date once the buckets cross midnight, so the axis cannot read backwards", () => {
    const timeline = [bucket("2026-08-24T22:50:00.000Z"), bucket("2026-08-25T00:00:00.000Z"), bucket("2026-08-25T01:10:00.000Z")];
    expect(axisLabels(timeline)).toEqual({ start: "08-24 22:50", mid: "08-25 00:00", end: "08-25 01:10" });
  });

  it("picks the lower middle for an even count", () => {
    const timeline = [bucket("2026-08-24T18:00:00.000Z"), bucket("2026-08-24T18:10:00.000Z"), bucket("2026-08-24T18:20:00.000Z"), bucket("2026-08-24T18:30:00.000Z")];
    expect(axisLabels(timeline)?.mid).toBe("18:10");
  });

  it("is null for fewer than two buckets — one tick is not an axis", () => {
    expect(axisLabels([])).toBeNull();
    expect(axisLabels([bucket("2026-08-24T18:00:00.000Z")])).toBeNull();
  });
});
