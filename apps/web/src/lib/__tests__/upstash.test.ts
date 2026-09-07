// The pipeline client is the one place every Redis-backed read and write in
// the app funnels through. A backend that accepts the connection and never
// answers must surface as an error the callers' fail-open/fail-closed logic
// can act on, not as a request that hangs until the platform kills it.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseScanPage, upstashPipeline } from "@/lib/upstash";

/** A fake fetch that settles only when its signal aborts; the timer fails the
 *  test fast if the abort never arrives instead of waiting for vitest's own
 *  timeout. */
const hangUntilAborted = (_url: string, init: RequestInit) =>
  new Promise<Response>((_, reject) => {
    const signal = init.signal;
    if (!signal) return reject(new Error("fake backend: no signal was passed to fetch"));
    if (signal.aborted) return reject(signal.reason);
    const giveUp = setTimeout(() => reject(new Error("fake backend: abort never arrived")), 2_000);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(giveUp);
        reject(signal.reason);
      },
      { once: true },
    );
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("upstashPipeline", () => {
  it("times out a hung backend instead of hanging the request", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "http://srh:80");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    vi.stubGlobal("fetch", vi.fn(hangUntilAborted));
    await expect(upstashPipeline([["PING"]], { timeoutMs: 20 })).rejects.toThrow(/timeout/i);
  });
});

// Issue #358. Every SCAN walk in the app used to read a failed page through a
// `["0", []]` fallback, and "0" is the cursor meaning ITERATION COMPLETE — so
// a failure silently ended the walk and handed the caller the pages gathered
// so far as though it had swept the whole keyspace.
describe("parseScanPage", () => {
  it("returns the cursor and keys of a good page", () => {
    expect(parseScanPage({ result: ["7", ["ctf:team:red:members"]] }, "t")).toEqual([
      "7",
      ["ctf:team:red:members"],
    ]);
  });

  it("stringifies a numeric cursor, so the loop's non-'0' comparison still ends", () => {
    // A raw number would make `cursor !== "0"` true forever at the end of a
    // walk, since 0 !== "0". That is an infinite loop rather than a short
    // read, which is why the cursor is normalised rather than trusted.
    expect(parseScanPage({ result: [0, []] }, "t")).toEqual(["0", []]);
  });

  it("throws on a per-command error instead of reporting the walk complete", () => {
    expect(() => parseScanPage({ error: "NOAUTH" }, "listTeams")).toThrow(
      /SCAN failed \(listTeams\): NOAUTH/,
    );
  });

  it.each([
    ["a non-array result", { result: "nope" }],
    ["a truncated page", { result: ["0"] }],
    ["keys that are not a list", { result: ["0", "ctf:team:red:members"] }],
    ["an empty result", { result: undefined }],
    // Element types, not just the outer shape. Without these two the guard
    // accepts `[{}, [1]]`: the next SCAN is then issued with the cursor
    // "[object Object]", and a numeric key is returned as a string and
    // interpolated into a key name — both failing somewhere else entirely.
    ["a cursor that is not a string or number", { result: [{}, []] }],
    ["a key that is not a string", { result: ["0", ["ctf:team:red:members", 1]] }],
  ])("throws on %s", (_label, reply) => {
    expect(() => parseScanPage(reply, "ctx")).toThrow(/unexpected shape \(ctx\)/);
  });
});
