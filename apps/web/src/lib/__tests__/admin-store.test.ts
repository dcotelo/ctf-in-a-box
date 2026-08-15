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
      paused: false, hintsEnabled: null, hintCost: null, teamRegistrationOpen: true, updatedBy: null, updatedAt: null,
    });
  });

  it("decodes a populated hash, treating overrides as present", async () => {
    mocks.upstashPipeline.mockResolvedValue([{
      result: ["paused", "1", "hintsEnabled", "0", "hintCost", "25", "updatedBy", "alice", "updatedAt", "2026-08-14T00:00:00Z"],
    }]);
    expect(await getAdminSettings()).toEqual({
      paused: true, hintsEnabled: false, hintCost: 25, teamRegistrationOpen: true, updatedBy: "alice", updatedAt: "2026-08-14T00:00:00Z",
    });
  });

  it("decodes a stored \"0\" for teamRegistrationOpen as closed", async () => {
    mocks.upstashPipeline.mockResolvedValue([{ result: ["teamRegistrationOpen", "0"] }]);
    expect((await getAdminSettings()).teamRegistrationOpen).toBe(false);
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

  it("clears paused via HDEL instead of writing the string \"0\" when unpausing", async () => {
    // paused is a two-state field (\"1\" or absent) — false must mean absent,
    // not the string "0", so the sync poller and scorer's presence checks
    // don't misread an un-pause as still-paused.
    mocks.upstashEval.mockResolvedValue(["updatedBy", "alice", "updatedAt", "2026-08-14T00:00:00Z"]);
    const out = await updateAdminSettings({ paused: false }, "alice");
    expect(mocks.upstashEval).toHaveBeenCalledOnce();
    const [script, , args] = mocks.upstashEval.mock.calls[0];

    // updatedBy/updatedAt and the audit line are still written — unpausing is
    // a real audited change.
    expect(args).toContain("alice");
    expect(args.some((a) => String(a).includes('"paused":false'))).toBe(true);

    // "paused" must appear only as a field slated for deletion, never as an
    // HSET pair with value "0" or "1".
    const strArgs = args.map(String);
    const pausedIdx = strArgs.indexOf("paused");
    expect(pausedIdx).toBeGreaterThan(-1);
    expect(strArgs[pausedIdx + 1]).not.toBe("0");
    expect(strArgs[pausedIdx + 1]).not.toBe("1");

    // The script itself must HDEL, not just HSET, the settings hash.
    expect(String(script)).toContain("HDEL");

    expect(out.paused).toBe(false);
  });

  it("closing teamRegistrationOpen writes \"0\" (HSET), never HDEL", async () => {
    mocks.upstashEval.mockResolvedValue([
      "teamRegistrationOpen", "0", "updatedBy", "alice", "updatedAt", "2026-08-14T00:00:00Z",
    ]);
    const out = await updateAdminSettings({ teamRegistrationOpen: false }, "alice");
    const [, , args] = mocks.upstashEval.mock.calls[0];
    const strArgs = args.map(String);
    const idx = strArgs.indexOf("teamRegistrationOpen");
    expect(idx).toBeGreaterThan(-1);
    expect(strArgs[idx + 1]).toBe("0"); // written as an HSET pair, value "0"
    // numDels (args[4]) is 0 — nothing is HDEL'd when closing.
    expect(strArgs[4]).toBe("0");
    expect(out.teamRegistrationOpen).toBe(false);
  });

  it("opening teamRegistrationOpen HDELs the field instead of writing \"1\"", async () => {
    mocks.upstashEval.mockResolvedValue(["updatedBy", "alice", "updatedAt", "2026-08-14T00:00:00Z"]);
    const out = await updateAdminSettings({ teamRegistrationOpen: true }, "alice");
    const [, , args] = mocks.upstashEval.mock.calls[0];
    const strArgs = args.map(String);
    // numDels is 1 and the sole del target is teamRegistrationOpen.
    expect(strArgs[4]).toBe("1");
    expect(strArgs[5]).toBe("teamRegistrationOpen");
    // It never appears as an HSET pair with "1"/"0".
    const idx = strArgs.indexOf("teamRegistrationOpen");
    expect(strArgs[idx + 1]).not.toBe("1");
    expect(strArgs[idx + 1]).not.toBe("0");
    expect(out.teamRegistrationOpen).toBe(true);
  });

  it("rejects a non-boolean teamRegistrationOpen", async () => {
    await expect(
      updateAdminSettings({ teamRegistrationOpen: "nope" as never }, "alice"),
    ).rejects.toBeInstanceOf(AdminValidationError);
    expect(mocks.upstashEval).not.toHaveBeenCalled();
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
