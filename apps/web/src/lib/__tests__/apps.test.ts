import { describe, expect, it } from "vitest";
import { apps, joinAppNames, workedExampleVariant, type AppMeta } from "@/lib/apps";

const juiceShop = apps.find((a) => a.id === "juice-shop") as AppMeta;
const dvwa = apps.find((a) => a.id === "dvwa") as AppMeta;

// Fork links are pinned in apps-repo-names.differential.test.ts, against
// setup/targets.tsv — the file ctf-setup.sh actually derives fork names from.
// The literal that used to sit here was a copy of the map it was checking, so
// it proved apps.ts equalled itself and nothing about the repos that exist
// (issue #149).

describe("joinAppNames", () => {
  it("returns empty string for no names", () => {
    expect(joinAppNames([])).toBe("");
  });
  it("returns the single name unchanged", () => {
    expect(joinAppNames(["DVWA"])).toBe("DVWA");
  });
  it("Oxford-joins two or more names", () => {
    expect(joinAppNames(["DVWA", "Juice Shop"])).toBe("DVWA, and Juice Shop");
    expect(joinAppNames(["DVWA", "Juice Shop", "WebGoat"])).toBe(
      "DVWA, Juice Shop, and WebGoat",
    );
  });
});

describe("workedExampleVariant", () => {
  it("picks the juice-shop walkthrough when juice-shop is enabled", () => {
    expect(workedExampleVariant([juiceShop])).toBe("juice-shop");
    expect(workedExampleVariant([dvwa, juiceShop])).toBe("juice-shop");
  });
  it("falls back to the generic walkthrough when juice-shop is disabled", () => {
    expect(workedExampleVariant([dvwa])).toBe("generic");
    expect(workedExampleVariant([])).toBe("generic");
  });
});
