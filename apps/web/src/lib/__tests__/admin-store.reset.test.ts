import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upstashEval: vi.fn<(s: string, k: string[], a: (string | number)[]) => Promise<unknown>>(),
  upstashPipeline: vi.fn<(c: (string | number)[][]) => Promise<{ result?: unknown; error?: string }[]>>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({ upstashEval: mocks.upstashEval, upstashPipeline: mocks.upstashPipeline }));

import { resetEvent } from "@/lib/admin-store";

beforeEach(() => {
  mocks.upstashEval.mockReset();
  mocks.upstashPipeline.mockReset();
  mocks.upstashEval.mockResolvedValue([]);
});

// Route each pipeline command: SCAN returns [cursor, keys], DEL returns a count.
function pipelineImpl(scanKeys: (pattern: string) => string[][]) {
  const pages = new Map<string, string[][]>();
  return async (cmds: (string | number)[][]) => {
    const cmd = cmds[0];
    const verb = String(cmd[0]);
    if (verb === "SCAN") {
      const pattern = String(cmd[3]);
      if (!pages.has(pattern)) pages.set(pattern, scanKeys(pattern));
      const remaining = pages.get(pattern)!;
      const batch = remaining.shift() ?? [];
      const cursor = remaining.length > 0 ? "7" : "0";
      return [{ result: [cursor, batch] }];
    }
    if (verb === "DEL") return [{ result: cmd.length - 1 }];
    return [{ result: null }];
  };
}

describe("resetEvent", () => {
  it("wipes every event-data prefix, then freezes + audits in one eval", async () => {
    // two keys for every prefix, single SCAN page each
    mocks.upstashPipeline.mockImplementation(pipelineImpl(() => [["k1", "k2"]]));

    const out = await resetEvent("alice");

    expect(out.cleared).toEqual({ solves: 2, teams: 2, users: 2, joinCodes: 2, hints: 2 });
    expect(out.resetAt).toMatch(/^\d+$/);

    // one SCAN + one DEL per prefix (5 prefixes) = 10 pipeline calls
    const verbs = mocks.upstashPipeline.mock.calls.map((c) => c[0][0][0]);
    expect(verbs.filter((v) => v === "SCAN").length).toBe(5);
    expect(verbs.filter((v) => v === "DEL").length).toBe(5);
    // every wiped prefix, and NOT settings/audit/sync
    const patterns = mocks.upstashPipeline.mock.calls
      .filter((c) => c[0][0][0] === "SCAN")
      .map((c) => c[0][0][3]);
    expect(patterns).toEqual(["ctf:solves:*", "ctf:team:*", "ctf:user:*", "ctf:joincode:*", "ctf:hints:*"]);

    // the freeze + audit eval: settings + audit keys, and a reset audit line
    expect(mocks.upstashEval).toHaveBeenCalledTimes(1);
    const [script, keys, args] = mocks.upstashEval.mock.calls[0];
    expect(script).toContain("'paused', '1'");
    expect(keys).toEqual(["ctf:admin:settings", "ctf:admin:audit"]);
    expect(args[0]).toBe("alice"); // actor
    const auditLine = JSON.parse(String(args[3]));
    expect(auditLine).toMatchObject({ by: "alice", action: "reset", cleared: { solves: 2, teams: 2 } });
  });

  it("skips DEL for an empty prefix and paginates a multi-page prefix", async () => {
    mocks.upstashPipeline.mockImplementation(
      pipelineImpl((pattern) =>
        pattern === "ctf:solves:*" ? [["a"], ["b", "c"]] : pattern === "ctf:team:*" ? [[]] : [["x"]],
      ),
    );

    const out = await resetEvent("bob");

    expect(out.cleared.solves).toBe(3); // 1 + 2 across two SCAN pages
    expect(out.cleared.teams).toBe(0); // empty -> no DEL
    // teams issued a SCAN but no DEL
    const teamDels = mocks.upstashPipeline.mock.calls.filter(
      (c) => c[0][0][0] === "DEL" && (c[0][0] as unknown[]).includes("ctf:team:*"),
    );
    expect(teamDels.length).toBe(0);
  });
});
