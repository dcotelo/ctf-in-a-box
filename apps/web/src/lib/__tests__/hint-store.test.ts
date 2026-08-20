// Unit tests for the hint store — most importantly that a hint purchase
// charges exactly once (the SADD guard precedes the HINCRBY inside the Lua
// script) and that everything is keyed by the server-derived login. Upstash
// is mocked; end-to-end Lua behavior is covered by hint-store.upstash.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upstashEval: vi.fn<(script: string, keys: string[], args: (string | number)[]) => Promise<unknown>>(),
  upstashPipeline: vi.fn<(commands: (string | number)[][]) => Promise<{ result?: unknown; error?: string }[]>>(),
  getAdminSettings: vi.fn(),
  isModuleEnabled: vi.fn<(id: string) => boolean>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({
  upstashEval: mocks.upstashEval,
  upstashPipeline: mocks.upstashPipeline,
}));
vi.mock("@/lib/admin-store", () => ({
  getAdminSettings: mocks.getAdminSettings,
}));
vi.mock("@/lib/modules", () => ({
  isModuleEnabled: mocks.isModuleEnabled,
}));

type HintStore = typeof import("@/lib/hint-store");

/** No admin override set — `hintsEnabled: null` is the "organizer has never
 *  touched the toggle" state, which resolves to HINT_DEFAULT_ENABLED. */
const BASE_SETTINGS = {
  paused: false,
  hintsEnabled: null,
  hintCost: null,
  // Gate off by default here so the purchase-path tests below stay focused
  // on charging; the gate has its own describe block.
  hintsMinSolves: 0,
  hintsUnlockAfterMin: 0,
  scoringStartsAt: null,
  updatedBy: null,
  updatedAt: null,
};

/** `HINTS_AVAILABLE` (Upstash credentials present) is read at module load, so
 *  each test re-imports the store with the env it needs.
 *
 *  `enabled` is NOT an env var any more — hints are switched from /admin, so
 *  it maps to the stored `hintsEnabled` override and these tests exercise the
 *  same path an organizer does. Absent means ON (HINT_DEFAULT_ENABLED). */
async function loadStore(enabled = true, { creds = true }: { creds?: boolean } = {}): Promise<HintStore> {
  vi.resetModules();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", creds ? "https://fake.upstash.io" : "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", creds ? "fake-token" : "");
  if (!enabled) {
    mocks.getAdminSettings.mockResolvedValue({ ...BASE_SETTINGS, hintsEnabled: false });
  }
  return import("@/lib/hint-store");
}

beforeEach(() => {
  vi.clearAllMocks();
  // Hints belong to the Secure Development module; every test below assumes
  // it is enabled unless it says otherwise.
  mocks.isModuleEnabled.mockReturnValue(true);
  // Default: no admin override present, so every test not exercising the
  // override sees only the baked env default (as before this override existed).
  mocks.getAdminSettings.mockResolvedValue({ ...BASE_SETTINGS });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("revealHint", () => {
  it("charges a new hint and returns the text", async () => {
    const store = await loadStore();
    mocks.upstashEval.mockResolvedValueOnce(["charged", "Check the admin route.", 10]);
    const result = await store.revealHint("octocat", "juice-shop", "Challenge-5-Admin-Section");
    expect(result).toEqual({ ok: true, hint: "Check the admin route.", alreadyOwned: false, spent: 10 });
  });

  it("returns an owned hint for free", async () => {
    const store = await loadStore();
    mocks.upstashEval.mockResolvedValueOnce(["owned", "Check the admin route.", "10"]);
    const result = await store.revealHint("octocat", "juice-shop", "Challenge-5-Admin-Section");
    expect(result).toEqual({ ok: true, hint: "Check the admin route.", alreadyOwned: true, spent: 10 });
  });

  it("checks the hint exists and guards with SADD BEFORE charging (atomic)", async () => {
    const store = await loadStore();
    mocks.upstashEval.mockResolvedValueOnce(["charged", "text", 10]);
    await store.revealHint("octocat", "juice-shop", "Challenge-5-Admin-Section");
    const [script] = mocks.upstashEval.mock.calls[0];
    const hget = script.indexOf("HGET");
    const sadd = script.indexOf("SADD");
    const charge = script.indexOf("HINCRBY");
    expect(hget).toBeGreaterThan(-1);
    expect(hget).toBeLessThan(sadd);
    expect(sadd).toBeLessThan(charge);
  });

  it("keys the purchase by the server-derived login and app/id pair", async () => {
    const store = await loadStore();
    mocks.upstashEval.mockResolvedValueOnce(["charged", "text", 10]);
    await store.revealHint("octocat", "juice-shop", "Challenge-5-Admin-Section");
    const [, keys, args] = mocks.upstashEval.mock.calls[0];
    expect(keys).toEqual(["ctf:user:octocat:hints", "ctf:hints:spent", "hints:juice-shop"]);
    expect(args).toEqual([
      "Challenge-5-Admin-Section",
      "juice-shop/Challenge-5-Admin-Section",
      "octocat",
      10,
    ]);
  });

  it("reports a missing hint without charging", async () => {
    const store = await loadStore();
    mocks.upstashEval.mockResolvedValueOnce(["missing"]);
    const result = await store.revealHint("octocat", "juice-shop", "Challenge-999-Nope");
    expect(result).toEqual({ ok: false, missing: true, error: "No hint available for this challenge" });
  });

  it("rejects an unknown app before touching Upstash", async () => {
    const store = await loadStore();
    const result = await store.revealHint("octocat", "not-an-app", "Challenge-1");
    expect(result).toEqual({ ok: false, error: "Unknown app" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("rejects a malformed challenge id before touching Upstash", async () => {
    const store = await loadStore();
    const result = await store.revealHint("octocat", "juice-shop", "nope/../etc");
    expect(result).toEqual({ ok: false, error: "Invalid challenge id" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("refuses when hints are not enabled", async () => {
    const store = await loadStore(false);
    const result = await store.revealHint("octocat", "juice-shop", "Challenge-1");
    expect(result).toEqual({ ok: false, error: "Hints are not enabled" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("is ON when the organizer has never touched the toggle — absent means default", async () => {
    const store = await loadStore();
    expect((await store.resolveHintConfig()).enabled).toBe(true);

    const off = await loadStore(false, { creds: true });
    expect((await off.resolveHintConfig()).enabled).toBe(false);
    const result = await off.revealHint("octocat", "juice-shop", "Challenge-1");
    expect(result).toEqual({ ok: false, error: "Hints are not enabled" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("stays off without Upstash creds even when the organizer switches hints ON — capability beats policy", async () => {
    const store = await loadStore(true, { creds: false });
    expect(store.HINTS_AVAILABLE).toBe(false);
    mocks.getAdminSettings.mockResolvedValue({ ...BASE_SETTINGS, hintsEnabled: true });
    expect((await store.resolveHintConfig()).enabled).toBe(false);
  });

  // The regression this whole change exists for: the /admin toggle used to
  // govern PURCHASING only, while these three read the env constant directly —
  // so switching hints off blocked buying but left the hint buttons on the
  // challenges page and the penalty column on the leaderboard.
  it("turns OFF every read path, not just purchasing, when the organizer switches hints off", async () => {
    // `getHintAvailability` swallows ANY error into `return {}`, and it reads
    // through `fetch` rather than the mocked pipeline — so asserting only on
    // its {} result passes even when the gate is missing and the un-mocked
    // fetch blows up. Spy on fetch and on console.error so the assertions
    // distinguish "refused because hints are off" from "tried and failed".
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not be called"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const off = await loadStore(false, { creds: true });
      expect(await off.getViewerHints("octocat")).toEqual({ purchased: {}, spent: 0, count: 0 });
      expect(await off.getHintPenalties()).toEqual(new Map());
      expect(await off.getHintAvailability()).toEqual({});
      // The decisive assertions: no read was even attempted, by either client.
      expect(mocks.upstashPipeline).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      consoleError.mockRestore();
    }
  });

  // Regression: /challenges called resolveHintConfig directly, which reads
  // admin settings, and upstashPipeline THROWS with no Upstash credentials —
  // so the page 500'd on any deployment without Redis. The unit tests missed
  // it because they mock getAdminSettings; the acceptance run caught it.
  it("getHintNotice never reads settings without Upstash creds — /challenges must not 500", async () => {
    const store = await loadStore(true, { creds: false });
    mocks.getAdminSettings.mockRejectedValue(new Error("UPSTASH_REDIS_REST_URL/TOKEN are not set"));
    await expect(store.getHintNotice()).resolves.toEqual({ active: false, cost: 10 });
    expect(mocks.getAdminSettings).not.toHaveBeenCalled();
  });

  it("keeps every read path ON when the organizer has set no override", async () => {
    const on = await loadStore();
    mocks.upstashPipeline.mockResolvedValue([{ result: [] }, { result: null }]);
    await on.getViewerHints("octocat");
    expect(mocks.upstashPipeline).toHaveBeenCalled();
  });

  it("degrades to a friendly error when Upstash fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = await loadStore();
    mocks.upstashEval.mockRejectedValueOnce(new Error("upstash down"));
    const result = await store.revealHint("octocat", "juice-shop", "Challenge-1");
    expect(result).toEqual({ ok: false, error: "Hint reveal failed. Try again" });
    consoleError.mockRestore();
  });
});

// The anti-burner gate: a throwaway account can eat the hint penalty and relay
// the text, so price alone can't stop hint farming — earned progress can.
describe("hintGate", () => {
  const settings = (over: Record<string, unknown> = {}) => ({
    paused: false,
    hintsEnabled: null,
    hintCost: null,
    hintsMinSolves: 1,
    hintsUnlockAfterMin: 0,
    scoringStartsAt: null,
    updatedBy: null,
    updatedAt: null,
    ...over,
  });
  /** HKEYS reply for ctf:solves:<target>: fields are `<author>:<challengeId>`. */
  const solves = (...fields: string[]) => mocks.upstashPipeline.mockResolvedValueOnce([{ result: fields }]);

  it("refuses outright when the secure-development module is disabled", async () => {
    const store = await loadStore();
    mocks.isModuleEnabled.mockImplementation((id) => id !== "secure-development");
    mocks.getAdminSettings.mockResolvedValue(settings({ hintsMinSolves: 0, hintsEnabled: true }));
    expect(await store.hintGate("octocat", "juice-shop")).toEqual({ allowed: false, reason: "disabled" });
    // Fails closed before any settings or Redis read.
    expect(mocks.getAdminSettings).not.toHaveBeenCalled();
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it("blocks an account with no solves on the target (the burner case)", async () => {
    const store = await loadStore();
    mocks.getAdminSettings.mockResolvedValue(settings());
    solves("someone-else:challenge-1");
    expect(await store.hintGate("burner", "juice-shop")).toEqual({
      allowed: false,
      reason: "no-progress",
      needed: 1,
      have: 0,
    });
  });

  it("allows an account that has earned a solve on that target", async () => {
    const store = await loadStore();
    mocks.getAdminSettings.mockResolvedValue(settings());
    solves("octocat:challenge-1", "other:challenge-2");
    expect(await store.hintGate("octocat", "juice-shop")).toEqual({ allowed: true });
  });

  it("matches the login case-insensitively (GitHub logins are)", async () => {
    const store = await loadStore();
    mocks.getAdminSettings.mockResolvedValue(settings());
    solves("OctoCat:challenge-1");
    expect(await store.hintGate("octocat", "juice-shop")).toEqual({ allowed: true });
  });

  it("counts solves per target, so progress elsewhere does not unlock this one", async () => {
    const store = await loadStore();
    mocks.getAdminSettings.mockResolvedValue(settings({ hintsMinSolves: 2 }));
    solves("octocat:challenge-1"); // only one on this target
    expect(await store.hintGate("octocat", "juice-shop")).toMatchObject({
      allowed: false,
      reason: "no-progress",
      needed: 2,
      have: 1,
    });
  });

  it("locks every hint until the time phase opens", async () => {
    const store = await loadStore();
    const startsAt = new Date(Date.now() - 10 * 60_000).toISOString(); // started 10m ago
    mocks.getAdminSettings.mockResolvedValue(settings({ hintsUnlockAfterMin: 60, scoringStartsAt: startsAt }));
    const gate = await store.hintGate("octocat", "juice-shop");
    expect(gate).toMatchObject({ allowed: false, reason: "locked" });
    // Locked short-circuits before any solve lookup.
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it("opens once the unlock delay has elapsed", async () => {
    const store = await loadStore();
    const startsAt = new Date(Date.now() - 90 * 60_000).toISOString(); // started 90m ago
    mocks.getAdminSettings.mockResolvedValue(settings({ hintsUnlockAfterMin: 60, scoringStartsAt: startsAt }));
    solves("octocat:challenge-1");
    expect(await store.hintGate("octocat", "juice-shop")).toEqual({ allowed: true });
  });

  it("ignores the time phase when no scoring start is configured", async () => {
    const store = await loadStore();
    mocks.getAdminSettings.mockResolvedValue(settings({ hintsUnlockAfterMin: 60, scoringStartsAt: null }));
    solves("octocat:challenge-1");
    expect(await store.hintGate("octocat", "juice-shop")).toEqual({ allowed: true });
  });

  it("skips the progress gate entirely when hintsMinSolves is 0", async () => {
    const store = await loadStore();
    mocks.getAdminSettings.mockResolvedValue(settings({ hintsMinSolves: 0 }));
    expect(await store.hintGate("burner", "juice-shop")).toEqual({ allowed: true });
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it("fails CLOSED when the solve lookup errors — a hint is a paid reveal", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = await loadStore();
    mocks.getAdminSettings.mockResolvedValue(settings());
    mocks.upstashPipeline.mockRejectedValueOnce(new Error("upstash down"));
    expect(await store.hintGate("octocat", "juice-shop")).toMatchObject({ allowed: false, reason: "no-progress" });
    consoleError.mockRestore();
  });

  it("revealHint enforces the gate and never reaches the charge script", async () => {
    const store = await loadStore();
    mocks.getAdminSettings.mockResolvedValue(settings());
    solves("someone-else:challenge-1");
    const result = await store.revealHint("burner", "juice-shop", "Challenge-5-Admin-Section");
    expect(result).toMatchObject({ ok: false, forbidden: true });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });
});

describe("runtime hint override", () => {
  it("charges the overridden cost when set", async () => {
    const store = await loadStore();
    mocks.getAdminSettings.mockResolvedValue({
      paused: false,
      hintsEnabled: null,
      hintCost: 25,
      hintsMinSolves: 0,
      hintsUnlockAfterMin: 0,
      scoringStartsAt: null,
      updatedBy: null,
      updatedAt: null,
    });
    mocks.upstashEval.mockResolvedValue(["charged", "the hint", 25]);
    const r = await store.revealHint("alice", "juice-shop", "Challenge-1-X");
    expect(r).toMatchObject({ ok: true, spent: 25 });
    const [, , args] = mocks.upstashEval.mock.calls[0];
    expect(args).toContain(25);
  });

  it("honors an enabled=false override even when the env default is on", async () => {
    const store = await loadStore();
    mocks.getAdminSettings.mockResolvedValue({
      paused: false,
      hintsEnabled: false,
      hintCost: null,
      updatedBy: null,
      updatedAt: null,
    });
    const r = await store.revealHint("alice", "juice-shop", "Challenge-1-X");
    expect(r).toEqual({ ok: false, error: "Hints are not enabled" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("falls back to the baked default when no override is present", async () => {
    const store = await loadStore();
    mocks.getAdminSettings.mockResolvedValue({
      paused: false,
      hintsEnabled: null,
      hintCost: null,
      hintsMinSolves: 0,
      hintsUnlockAfterMin: 0,
      scoringStartsAt: null,
      updatedBy: null,
      updatedAt: null,
    });
    mocks.upstashEval.mockResolvedValue(["charged", "the hint", 10]);
    const r = await store.revealHint("alice", "juice-shop", "Challenge-1-X");
    expect(r).toMatchObject({ ok: true, spent: 10 });
  });
});

describe("getViewerHints", () => {
  it("resolves bought hints with their texts, grouped by app", async () => {
    const store = await loadStore();
    mocks.upstashPipeline
      .mockResolvedValueOnce([
        { result: ["juice-shop/Challenge-5-Admin-Section", "dvwa/brute-low"] },
        { result: "20" },
      ])
      .mockResolvedValueOnce([{ result: "Admin hint." }, { result: "Brute hint." }]);
    const result = await store.getViewerHints("octocat");
    expect(result).toEqual({
      purchased: {
        "juice-shop": { "Challenge-5-Admin-Section": "Admin hint." },
        dvwa: { "brute-low": "Brute hint." },
      },
      spent: 20,
      count: 2,
    });
  });

  it("still counts a purchase whose hint text was later deleted", async () => {
    const store = await loadStore();
    mocks.upstashPipeline
      .mockResolvedValueOnce([{ result: ["juice-shop/Challenge-Gone"] }, { result: "10" }])
      .mockResolvedValueOnce([{ result: null }]);
    const result = await store.getViewerHints("octocat");
    expect(result).toEqual({ purchased: {}, spent: 10, count: 1 });
  });

  it("skips malformed members and unknown apps", async () => {
    const store = await loadStore();
    mocks.upstashPipeline.mockResolvedValueOnce([
      { result: ["no-slash", "not-an-app/Challenge-1"] },
      { result: null },
    ]);
    const result = await store.getViewerHints("octocat");
    expect(result).toEqual({ purchased: {}, spent: 0, count: 0 });
    expect(mocks.upstashPipeline).toHaveBeenCalledTimes(1);
  });

  it("returns zeros when hints are not enabled", async () => {
    const store = await loadStore(false);
    expect(await store.getViewerHints("octocat")).toEqual({ purchased: {}, spent: 0, count: 0 });
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });
});

describe("getHintPenalties", () => {
  it("parses the spent hash into a login → points map", async () => {
    const store = await loadStore();
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: ["octocat", "30", "dcotelo", "10"] }]);
    const penalties = await store.getHintPenalties();
    expect(penalties).toEqual(new Map([["octocat", 30], ["dcotelo", 10]]));
  });

  it("drops non-numeric and non-positive values", async () => {
    const store = await loadStore();
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: ["a", "oops", "b", "0", "c", "10"] }]);
    expect(await store.getHintPenalties()).toEqual(new Map([["c", 10]]));
  });

  it("returns an empty map when hints are not enabled", async () => {
    const store = await loadStore(false);
    expect(await store.getHintPenalties()).toEqual(new Map());
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });
});

describe("getHintAvailability", () => {
  it("fetches HKEYS per app with ISR caching, never the no-store pipeline", async () => {
    const store = await loadStore();
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
      const url = String(input);
      return {
        ok: true,
        json: async () => ({
          result: url.includes(encodeURIComponent("hints:juice-shop")) ? ["Challenge-1", "Challenge-2"] : [],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const availability = await store.getHintAvailability();
    expect(availability).toEqual({ "juice-shop": ["Challenge-1", "Challenge-2"] });
    // One request per app, all ISR-cached — the challenges page must stay static.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ next: { revalidate: 300 } });
    }
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it("degrades to {} when the fetch fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = await loadStore();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as Response));
    expect(await store.getHintAvailability()).toEqual({});
    consoleError.mockRestore();
  });

  it("returns {} without fetching when hints are not enabled", async () => {
    const store = await loadStore(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await store.getHintAvailability()).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
