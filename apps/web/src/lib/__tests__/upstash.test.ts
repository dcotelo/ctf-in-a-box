// The pipeline client is the one place every Redis-backed read and write in
// the app funnels through. A backend that accepts the connection and never
// answers must surface as an error the callers' fail-open/fail-closed logic
// can act on, not as a request that hangs until the platform kills it.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { upstashPipeline } from "@/lib/upstash";

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
