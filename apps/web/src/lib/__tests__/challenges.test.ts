// Unit tests for the live challenge catalogue: grouping the flat API list by
// app, and the fetch wrapper's degrade-to-null behavior (missing env, HTTP
// errors, malformed bodies) that keeps the challenges page on its static
// fallback instead of crashing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getChallengeCatalog, groupCatalog, type CatalogChallenge } from "@/lib/challenges";

const owasp = { code: "A01", label: "A01:2025 Broken Access Control", url: "https://owasp.org/Top10/2025/A01" };

function challenge(app: CatalogChallenge["app"], id: string): CatalogChallenge {
  return { app, id, description: id.replace(/-/g, " "), owasp };
}

describe("groupCatalog", () => {
  it("groups the flat list by app and preserves order within each app", () => {
    const challenges = [
      challenge("juice-shop", "Challenge-1"),
      challenge("dvwa", "brute-low"),
      challenge("juice-shop", "Challenge-2"),
    ];
    const catalog = groupCatalog({ challenges, counts: {}, total: 3 });
    expect(catalog.byApp["juice-shop"]?.map((c) => c.id)).toEqual(["Challenge-1", "Challenge-2"]);
    expect(catalog.byApp.dvwa).toHaveLength(1);
    expect(catalog.byApp.webgoat).toBeUndefined();
  });

  it("derives total from the list itself, not the reported fields", () => {
    const challenges = [challenge("vampi", "a"), challenge("vampi", "b")];
    const catalog = groupCatalog({ challenges, counts: { vampi: 99 }, total: 99 });
    expect(catalog.total).toBe(2);
  });
});

describe("getChallengeCatalog", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("LEADERBOARD_API_URL", "https://api.example.test");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  it("fetches /challenges off the leaderboard API base (trailing slash trimmed)", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "https://api.example.test/");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ challenges: [challenge("dvwa", "brute-low")], counts: {}, total: 1 })),
    );
    const catalog = await getChallengeCatalog();
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/challenges", expect.anything());
    expect(catalog?.total).toBe(1);
    expect(catalog?.byApp.dvwa?.[0].id).toBe("brute-low");
  });

  it("returns null when LEADERBOARD_API_URL is not set (mock mode)", async () => {
    vi.stubEnv("LEADERBOARD_API_URL", "");
    expect(await getChallengeCatalog()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null on HTTP errors instead of throwing", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 503 }));
    expect(await getChallengeCatalog()).toBeNull();
  });

  it("returns null when the body has no challenge list", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ challenges: [], counts: {}, total: 0 })));
    expect(await getChallengeCatalog()).toBeNull();
  });

  it("returns null when fetch itself rejects", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect(await getChallengeCatalog()).toBeNull();
  });
});
