import { describe, expect, it } from "vitest";
import { apps } from "@/lib/apps";
import {
  DEFAULT_SECURE_DEV_TARGETS, SECURE_DEV_TARGETS_MESSAGE, TARGET_IDS,
  checkSecureDevTargets, isAppId, normalizeSecureDevTargets,
} from "@/lib/secure-dev-targets";

describe("secure-dev targets contract", () => {
  it("TARGET_IDS is the catalogue in order and is the default", () => {
    expect([...TARGET_IDS]).toEqual(apps.map((a) => a.id));
    expect(DEFAULT_SECURE_DEV_TARGETS).toBe(TARGET_IDS);
    expect(TARGET_IDS).toHaveLength(6);
  });
  it("isAppId knows the six and nothing else", () => {
    expect(isAppId("dvwa")).toBe(true);
    expect(isAppId("DVWA")).toBe(false);
    expect(isAppId(7)).toBe(false);
  });
});

describe("normalizeSecureDevTargets", () => {
  it("absent, empty and garbage all mean default", () => {
    expect(normalizeSecureDevTargets(undefined)).toBeNull();
    expect(normalizeSecureDevTargets("")).toBeNull();
    expect(normalizeSecureDevTargets("not json")).toBeNull();
    expect(normalizeSecureDevTargets('{"a":1}')).toBeNull();
    expect(normalizeSecureDevTargets("[]")).toBeNull();
    expect(normalizeSecureDevTargets('["nope"]')).toBeNull();
  });
  it("drops unknown ids, dedups, and returns catalogue order", () => {
    expect(normalizeSecureDevTargets('["vampi","dvwa","vampi","zzz"]')).toEqual(["dvwa", "vampi"]);
  });
});

describe("checkSecureDevTargets", () => {
  it("accepts a non-empty list of known ids, normalised", () => {
    expect(checkSecureDevTargets(["vampi", "dvwa", "dvwa"])).toEqual({ ok: true, value: ["dvwa", "vampi"] });
  });
  it.each([[[]], [["dvwa", "nope"]], ["dvwa"], [null], [[1]]])("rejects %j", (v) => {
    expect(checkSecureDevTargets(v)).toEqual({ ok: false, message: SECURE_DEV_TARGETS_MESSAGE });
  });
});
