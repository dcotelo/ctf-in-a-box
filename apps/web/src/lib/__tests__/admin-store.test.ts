import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upstashEval: vi.fn<(s: string, k: string[], a: (string | number)[]) => Promise<unknown>>(),
  upstashPipeline: vi.fn<(c: (string | number)[][]) => Promise<{ result?: unknown; error?: string }[]>>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({ upstashEval: mocks.upstashEval, upstashPipeline: mocks.upstashPipeline }));

import {
  AdminValidationError,
  getAdminSettings,
  getSyncStatus,
  updateAdminSettings,
} from "@/lib/admin-store";

beforeEach(() => {
  mocks.upstashEval.mockReset();
  mocks.upstashPipeline.mockReset();
});

describe("getAdminSettings", () => {
  it("fills defaults for an empty hash", async () => {
    mocks.upstashPipeline.mockResolvedValue([{ result: [] }]);
    expect(await getAdminSettings()).toEqual({
      paused: false, hintsEnabled: null, hintCost: null, updatedBy: null, updatedAt: null,
    });
  });

  it("decodes a populated hash, treating overrides as present", async () => {
    mocks.upstashPipeline.mockResolvedValue([{
      result: ["paused", "1", "hintsEnabled", "0", "hintCost", "25", "updatedBy", "alice", "updatedAt", "2026-08-14T00:00:00Z"],
    }]);
    expect(await getAdminSettings()).toEqual({
      paused: true, hintsEnabled: false, hintCost: 25, updatedBy: "alice", updatedAt: "2026-08-14T00:00:00Z",
    });
  });
});

describe("updateAdminSettings validation", () => {
  it("rejects a negative hint cost before touching Redis", async () => {
    await expect(updateAdminSettings({ hintCost: -1 }, "alice")).rejects.toBeInstanceOf(AdminValidationError);
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("rejects an out-of-bound hint cost", async () => {
    await expect(updateAdminSettings({ hintCost: 999999 }, "alice")).rejects.toBeInstanceOf(AdminValidationError);
  });

  it("rejects an unknown patch key", async () => {
    await expect(updateAdminSettings({ bogus: true } as never, "alice")).rejects.toBeInstanceOf(AdminValidationError);
  });

  it("rejects an empty patch", async () => {
    await expect(updateAdminSettings({}, "alice")).rejects.toBeInstanceOf(AdminValidationError);
  });
});

describe("updateAdminSettings write", () => {
  it("passes only the changed fields, the actor, and a timestamp into one eval", async () => {
    mocks.upstashEval.mockResolvedValue(["paused", "1", "updatedBy", "alice", "updatedAt", "2026-08-14T00:00:00Z"]);
    const out = await updateAdminSettings({ paused: true }, "alice");
    expect(mocks.upstashEval).toHaveBeenCalledOnce();
    const [, keys, args] = mocks.upstashEval.mock.calls[0];
    expect(keys).toEqual(["ctf:admin:settings", "ctf:admin:audit"]);
    // args carry the actor, the cap, an audit JSON line, and the paused field
    expect(args).toContain("alice");
    expect(args.some((a) => String(a).includes('"paused":true'))).toBe(true);
    expect(out.paused).toBe(true);
  });
});

describe("getSyncStatus", () => {
  it("returns null when the poller has never written", async () => {
    mocks.upstashPipeline.mockResolvedValue([{ result: [] }]);
    expect(await getSyncStatus()).toBeNull();
  });

  it("decodes a heartbeat", async () => {
    mocks.upstashPipeline.mockResolvedValue([{
      result: ["lastPollAt", "2026-08-14T00:00:00Z", "ingested", "12", "reposPolled", "3", "paused", "0"],
    }]);
    expect(await getSyncStatus()).toEqual({
      lastPollAt: "2026-08-14T00:00:00Z", lastError: null, ingested: 12, reposPolled: 3, paused: false,
    });
  });
});
