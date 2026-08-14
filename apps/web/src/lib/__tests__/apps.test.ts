import { describe, expect, it } from "vitest";
import { apps, joinAppNames, workedExampleVariant, type AppMeta } from "@/lib/apps";
import { eventConfig } from "@/lib/event-config";

const juiceShop = apps.find((a) => a.id === "juice-shop") as AppMeta;
const dvwa = apps.find((a) => a.id === "dvwa") as AppMeta;

// Byte-identical to sync/src/config.js's REPO_NAMES — a fork link must point
// at the repo the kit's `ctf-setup org` actually created, casing included.
const REPO_NAMES: Record<string, string> = {
  "juice-shop": "juice-shop",
  dvwa: "DVWA",
  webgoat: "WebGoat",
  securityshepherd: "SecurityShepherd",
  vulnerableapp: "VulnerableApp",
  vampi: "VAmPI",
};

describe("app fork links", () => {
  it("derive from the configured GitHub org, not a hardcoded one", () => {
    for (const app of apps) {
      expect(app.repo).toBe(`https://github.com/${eventConfig.githubOrg}/${REPO_NAMES[app.id]}`);
    }
  });
});

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
