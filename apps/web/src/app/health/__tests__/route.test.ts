// `GET /health`.
//
// The assertion that earns its keep is the LAST one: an exact key set. This
// endpoint is public and unauthenticated, so the risk it carries is not that
// it breaks — it is that it quietly grows. Someone adds a Redis ping "while
// they're in here", or the configured event URL "for debugging", and the
// disclosure is world-readable from that commit on. Pinning the key set makes
// that a test failure with a reason attached rather than a review someone has
// to catch.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "@/app/health/route";
import { resetAppVersionCache } from "@/lib/app-version";

beforeEach(() => {
  vi.unstubAllEnvs();
  resetAppVersionCache();
});

describe("GET /health", () => {
  it("answers 200 with the build stamp", async () => {
    vi.stubEnv("APP_BUILD_REV", "d3399e9");
    vi.stubEnv("APP_BUILT_AT", "2026-09-07T02:01:49Z");
    resetAppVersionCache();

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "ok",
      revision: "d3399e9",
      builtAt: "2026-09-07T02:01:49.000Z",
    });
  });

  it("answers 200 even when the build passed no stamp — liveness must not depend on it", async () => {
    vi.stubEnv("APP_BUILD_REV", "");
    vi.stubEnv("APP_BUILT_AT", "");
    resetAppVersionCache();

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", revision: "unknown", builtAt: null });
  });

  it("is never cached — a cached build stamp reports the previous deploy", async () => {
    const res = await GET();
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("discloses exactly four fields, and nothing else", async () => {
    const body = (await (await GET()).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["builtAt", "revision", "status", "version"]);
  });
});
