// Integration tests: exercises the REAL Lua script against the live Upstash
// DB, because that's where the atomic settings-write + audit-append is
// actually enforced (a change can never land without its audit record).
// Skips entirely when Upstash credentials are not available (e.g. CI without
// secrets).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Credentials come from the environment, falling back to .env.local locally.
for (const file of [path.resolve(process.cwd(), ".env.local")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1 || line.trimStart().startsWith("#")) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key.startsWith("UPSTASH_REDIS_REST_") && !process.env[key]) process.env[key] = value;
  }
}
const configured = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

describe.skipIf(!configured)("admin-store against a live SRH proxy", () => {
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
});
