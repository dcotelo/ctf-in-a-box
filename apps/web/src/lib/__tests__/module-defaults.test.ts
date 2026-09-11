import { describe, expect, it } from "vitest";
import { defaultEnabledModules, secureDevAvailable } from "@/lib/module-defaults";

describe("secureDevAvailable", () => {
  it("is true when SCORE_IMAGE names an image", () => {
    expect(secureDevAvailable({ SCORE_IMAGE: "ghcr.io/x/score:latest" })).toBe(true);
  });
  it("is false when SCORE_IMAGE is unset, empty, or whitespace", () => {
    expect(secureDevAvailable({})).toBe(false);
    expect(secureDevAvailable({ SCORE_IMAGE: "" })).toBe(false);
    expect(secureDevAvailable({ SCORE_IMAGE: "   " })).toBe(false);
  });
});

describe("defaultEnabledModules", () => {
  it("is secure-development only when a scorer image exists", () => {
    expect(defaultEnabledModules({ SCORE_IMAGE: "ghcr.io/x/score:latest" })).toEqual(["secure-development"]);
  });
  it("is empty when there is no scorer image — quiz, classic and ai start OFF", () => {
    expect(defaultEnabledModules({})).toEqual([]);
  });
  it("never reads anything but SCORE_IMAGE", () => {
    expect(defaultEnabledModules({ EVENT_CONFIG_B64: "abc", DEMO_MODE: "1" })).toEqual([]);
  });
});
