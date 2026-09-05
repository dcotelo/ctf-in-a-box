// Integration tests: exercises the REAL Lua script against a live Redis (srh
// in CI, Upstash or srh locally), because that's where the atomic
// settings-write + audit-append is actually enforced (a change can never land
// without its audit record). Gating comes from live-redis.ts: skipped without
// the env, a FAILURE when CTF_LUA_SUITES_REQUIRED is set.
//
// Not key-isolated, on purpose: the settings and audit keys are the fixed
// ones the store reads (ADMIN_SETTINGS_KEY / the audit list), and the cap
// test needs an empty audit list to count from. Every other live suite either
// uses run-unique keys or (hint-store) reads these settings, so the live run
// is serial — `--no-file-parallelism` in ci.yml — rather than concurrent.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { liveConfigured } from "./live-redis";

vi.mock("server-only", () => ({}));

describe.skipIf(!liveConfigured)("admin-store against a live SRH proxy", () => {
  let AUDIT_CAP: number;
  let getAdminSettings: (typeof import("@/lib/admin-store"))["getAdminSettings"];
  let updateAdminSettings: (typeof import("@/lib/admin-store"))["updateAdminSettings"];
  let upstashPipeline: (typeof import("@/lib/upstash"))["upstashPipeline"];

  beforeAll(async () => {
    ({ AUDIT_CAP, getAdminSettings, updateAdminSettings } = await import("@/lib/admin-store"));
    ({ upstashPipeline } = await import("@/lib/upstash"));
  });

  beforeEach(async () => {
    await upstashPipeline([["DEL", "ctf:admin:settings"], ["DEL", "ctf:admin:audit"]]);
  });

  afterAll(async () => {
    await upstashPipeline([["DEL", "ctf:admin:settings"], ["DEL", "ctf:admin:audit"]]);
  });

  it("writes settings and an audit line atomically", async () => {
    await updateAdminSettings({ paused: true, hintCost: 25 }, "alice");
    const s = await getAdminSettings();
    expect(s.paused).toBe(true);
    expect(s.hintCost).toBe(25);
    expect(s.updatedBy).toBe("alice");
    const [len] = await upstashPipeline([["LLEN", "ctf:admin:audit"]]);
    expect(Number(len.result)).toBe(1);
  });

  it("caps the audit list at AUDIT_CAP", async () => {
    for (let i = 0; i < AUDIT_CAP + 5; i++) await updateAdminSettings({ paused: i % 2 === 0 }, "bot");
    const [len] = await upstashPipeline([["LLEN", "ctf:admin:audit"]]);
    expect(Number(len.result)).toBe(AUDIT_CAP);
  });

  it("clears the paused field to absent (not \"0\") when unpausing", async () => {
    await updateAdminSettings({ paused: true }, "alice");
    const [setGet] = await upstashPipeline([["HGET", "ctf:admin:settings", "paused"]]);
    expect(setGet.result).toBe("1");

    await updateAdminSettings({ paused: false }, "alice");
    const [clearedExists, clearedUpdatedAt] = await upstashPipeline([
      ["HEXISTS", "ctf:admin:settings", "paused"],
      ["HGET", "ctf:admin:settings", "updatedAt"],
    ]);
    expect(Number(clearedExists.result)).toBe(0);
    expect(typeof clearedUpdatedAt.result).toBe("string");
    expect(clearedUpdatedAt.result).toBeTruthy();

    const settings = await getAdminSettings();
    expect(settings.paused).toBe(false);
  });
});
