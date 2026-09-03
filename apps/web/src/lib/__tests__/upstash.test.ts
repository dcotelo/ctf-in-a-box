// The pipeline client is the one place every Redis-backed read and write in
// the app funnels through. A backend that accepts the connection and never
// answers must surface as an error the callers' fail-open/fail-closed logic
// can act on, not as a request that hangs until the platform kills it.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { upstashPipeline } from "@/lib/upstash";

const hangUntilAborted = (_url: string, init: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
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
