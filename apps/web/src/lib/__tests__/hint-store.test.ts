// Unit tests for the hint store — most importantly that a hint purchase
// charges exactly once (the SADD guard precedes the HINCRBY inside the Lua
// script) and that everything is keyed by the server-derived login. Upstash
// is mocked; end-to-end Lua behavior is covered by hint-store.upstash.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upstashEval: vi.fn<(script: string, keys: string[], args: (string | number)[]) => Promise<unknown>>(),
  upstashPipeline: vi.fn<(commands: (string | number)[][]) => Promise<{ result?: unknown; error?: string }[]>>(),
}));

// The DynamoDB half is mocked as a module so these tests stay hermetic; its
// own behavior is covered by dynamo-hint-store.test.ts.
const dynamoMocks = vi.hoisted(() => ({
  dynamoChargeHint: vi
    .fn<(...args: unknown[]) => Promise<{ status: string; spent?: number }>>()
    .mockResolvedValue({ status: "charged", spent: 10 }),
  dynamoGetViewerPurchases: vi
    .fn<(login: string) => Promise<{ purchases: { app: string; id: string }[]; spent: number }>>()
    .mockResolvedValue({ purchases: [], spent: 0 }),
  dynamoGetHintPenalties: vi.fn<() => Promise<Map<string, number>>>().mockResolvedValue(new Map()),
  dynamoGetHintText: vi.fn<(app: string, id: string) => Promise<string | null>>().mockResolvedValue(null),
  dynamoGetHintTexts: vi.fn<(refs: { app: string; id: string }[]) => Promise<(string | null)[]>>().mockResolvedValue([]),
  dynamoGetHintAvailability: vi.fn<() => Promise<Record<string, string[]>>>().mockResolvedValue({}),
  mirrorHintCharge: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({
  upstashEval: mocks.upstashEval,
  upstashPipeline: mocks.upstashPipeline,
}));
vi.mock("@/lib/dynamo-hint-store", () => dynamoMocks);

type HintStore = typeof import("@/lib/hint-store");

/** HINTS_ENABLED and CTF_DATA_BACKEND are read at module load, so each test
 *  re-imports the store with the env it needs. Enabled = the explicit flag AND
 *  (dynamo mode OR Upstash creds). No backend = "dual". */
async function loadStore(
  enabled = true,
  { creds = enabled, backend }: { creds?: boolean; backend?: "dual" | "upstash" | "dynamo" } = {},
): Promise<HintStore> {
  vi.resetModules();
  vi.stubEnv("HINTS_ENABLED", enabled ? "true" : "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", creds ? "https://fake.upstash.io" : "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", creds ? "fake-token" : "");
  if (backend) vi.stubEnv("CTF_DATA_BACKEND", backend);
  return import("@/lib/hint-store");
}

beforeEach(() => {
  vi.clearAllMocks();
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

  it("stays off with Upstash creds but no HINTS_ENABLED flag (pre-event state)", async () => {
    const store = await loadStore(false, { creds: true });
    expect(store.HINTS_ENABLED).toBe(false);
    const result = await store.revealHint("octocat", "juice-shop", "Challenge-1");
    expect(result).toEqual({ ok: false, error: "Hints are not enabled" });
    expect(mocks.upstashEval).not.toHaveBeenCalled();
  });

  it("stays off with the flag but no Upstash creds (dual mode needs them for text)", async () => {
    const store = await loadStore(true, { creds: false });
    expect(store.HINTS_ENABLED).toBe(false);
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

describe("data backend dispatch (CTF_DATA_BACKEND)", () => {
  it("dual (default) mirrors a fresh charge into DynamoDB", async () => {
    const store = await loadStore(); // no backend env = dual
    mocks.upstashEval.mockResolvedValueOnce(["charged", "text", 10]);
    await store.revealHint("octocat", "juice-shop", "Challenge-5-Admin-Section");
    expect(dynamoMocks.mirrorHintCharge).toHaveBeenCalledWith("octocat", "juice-shop", "Challenge-5-Admin-Section", 10);
  });

  it("dual does NOT mirror a re-view (owned) — only fresh charges are writes", async () => {
    const store = await loadStore();
    mocks.upstashEval.mockResolvedValueOnce(["owned", "text", "10"]);
    await store.revealHint("octocat", "juice-shop", "Challenge-5-Admin-Section");
    expect(dynamoMocks.mirrorHintCharge).not.toHaveBeenCalled();
  });

  it("upstash mode never touches DynamoDB", async () => {
    const store = await loadStore(true, { backend: "upstash" });
    mocks.upstashEval.mockResolvedValueOnce(["charged", "text", 10]);
    await store.revealHint("octocat", "juice-shop", "Challenge-5-Admin-Section");
    expect(dynamoMocks.mirrorHintCharge).not.toHaveBeenCalled();
  });

  it("dynamo mode reads the text and charges in DynamoDB — no Upstash at all", async () => {
    const store = await loadStore(true, { backend: "dynamo" });
    dynamoMocks.dynamoGetHintText.mockResolvedValueOnce("Check the admin route.");
    dynamoMocks.dynamoChargeHint.mockResolvedValueOnce({ status: "charged", spent: 10 });
    const result = await store.revealHint("octocat", "juice-shop", "Challenge-5-Admin-Section");
    expect(result).toEqual({ ok: true, hint: "Check the admin route.", alreadyOwned: false, spent: 10 });
    expect(dynamoMocks.dynamoGetHintText).toHaveBeenCalledWith("juice-shop", "Challenge-5-Admin-Section");
    expect(dynamoMocks.dynamoChargeHint).toHaveBeenCalledWith("octocat", "juice-shop", "Challenge-5-Admin-Section", 10);
    expect(mocks.upstashEval).not.toHaveBeenCalled();
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it("dynamo mode enables hints without Upstash credentials", async () => {
    const store = await loadStore(true, { creds: false, backend: "dynamo" });
    expect(store.HINTS_ENABLED).toBe(true);
  });

  it("dynamo mode returns an owned hint for free", async () => {
    const store = await loadStore(true, { backend: "dynamo" });
    dynamoMocks.dynamoGetHintText.mockResolvedValueOnce("text");
    dynamoMocks.dynamoChargeHint.mockResolvedValueOnce({ status: "owned", spent: 30 });
    const result = await store.revealHint("octocat", "juice-shop", "Challenge-5-Admin-Section");
    expect(result).toEqual({ ok: true, hint: "text", alreadyOwned: true, spent: 30 });
  });

  it("dynamo mode reports a missing hint without charging", async () => {
    const store = await loadStore(true, { backend: "dynamo" });
    dynamoMocks.dynamoGetHintText.mockResolvedValueOnce(null);
    const result = await store.revealHint("octocat", "juice-shop", "Challenge-999-Nope");
    expect(result).toEqual({ ok: false, missing: true, error: "No hint available for this challenge" });
    expect(dynamoMocks.dynamoChargeHint).not.toHaveBeenCalled();
  });

  it("dynamo mode degrades to a friendly error when the charge fails", async () => {
    const store = await loadStore(true, { backend: "dynamo" });
    dynamoMocks.dynamoGetHintText.mockResolvedValueOnce("text");
    dynamoMocks.dynamoChargeHint.mockResolvedValueOnce({ status: "error" });
    const result = await store.revealHint("octocat", "juice-shop", "Challenge-1");
    expect(result).toEqual({ ok: false, error: "Hint reveal failed. Try again" });
  });

  it("dynamo mode degrades to a friendly error when the text lookup fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = await loadStore(true, { backend: "dynamo" });
    dynamoMocks.dynamoGetHintText.mockRejectedValueOnce(new Error("dynamo down"));
    const result = await store.revealHint("octocat", "juice-shop", "Challenge-1");
    expect(result).toEqual({ ok: false, error: "Hint reveal failed. Try again" });
    expect(dynamoMocks.dynamoChargeHint).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("dynamo mode lists purchases and hydrates texts from DynamoDB", async () => {
    const store = await loadStore(true, { backend: "dynamo" });
    dynamoMocks.dynamoGetViewerPurchases.mockResolvedValueOnce({
      purchases: [
        { app: "juice-shop", id: "Challenge-5-Admin-Section" },
        { app: "not-an-app", id: "Challenge-1" }, // dropped like the upstash path drops unknown apps
      ],
      spent: 20,
    });
    dynamoMocks.dynamoGetHintTexts.mockResolvedValueOnce(["Admin hint."]);
    const result = await store.getViewerHints("octocat");
    expect(result).toEqual({
      purchased: { "juice-shop": { "Challenge-5-Admin-Section": "Admin hint." } },
      spent: 20,
      count: 1,
    });
    // Unknown apps are filtered BEFORE hydration, and Upstash is never touched.
    expect(dynamoMocks.dynamoGetHintTexts).toHaveBeenCalledWith([
      { app: "juice-shop", id: "Challenge-5-Admin-Section" },
    ]);
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });

  it("dynamo mode serves availability from one pk=HINTS query, filtered to known apps", async () => {
    const store = await loadStore(true, { backend: "dynamo" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    dynamoMocks.dynamoGetHintAvailability.mockResolvedValueOnce({
      "juice-shop": ["Challenge-1", "Challenge-2"],
      "not-an-app": ["Challenge-1"], // stale/foreign rows never reach the public shape
    });
    expect(await store.getHintAvailability()).toEqual({ "juice-shop": ["Challenge-1", "Challenge-2"] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dynamo mode availability degrades to {} when the query fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = await loadStore(true, { backend: "dynamo" });
    dynamoMocks.dynamoGetHintAvailability.mockRejectedValueOnce(new Error("dynamo down"));
    expect(await store.getHintAvailability()).toEqual({});
    consoleError.mockRestore();
  });

  it("dynamo mode serves the leaderboard penalties from DynamoDB", async () => {
    const store = await loadStore(true, { backend: "dynamo" });
    dynamoMocks.dynamoGetHintPenalties.mockResolvedValueOnce(new Map([["octocat", 30]]));
    expect(await store.getHintPenalties()).toEqual(new Map([["octocat", 30]]));
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
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
