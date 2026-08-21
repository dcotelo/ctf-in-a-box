// The public scoring-config endpoint (issue #46).
//
// It exists so a fork's Action — which cannot reach the event's Redis — can
// read the organizer's current cooldown. Two properties matter: it answers
// with the DEFAULT rather than an error when the store is down, and it
// discloses nothing beyond scoring policy.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminSettings } = vi.hoisted(() => ({ getAdminSettings: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-store", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-store")>()),
  getAdminSettings,
}));

import { GET } from "@/app/api/public/scoring/route";
import { SCORE_COOLDOWN_MIN } from "@/lib/scoring-defaults";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/public/scoring", () => {
  it("returns the organizer's override", async () => {
    getAdminSettings.mockResolvedValue({ scoreCooldownMin: 15 });
    expect(await (await GET()).json()).toEqual({ cooldownMinutes: 15 });
  });

  it("returns the default when no override is set", async () => {
    getAdminSettings.mockResolvedValue({ scoreCooldownMin: null });
    expect(await (await GET()).json()).toEqual({ cooldownMinutes: SCORE_COOLDOWN_MIN });
  });

  it("returns 0 when the organizer disabled the cooldown", async () => {
    // 0 is a real setting, not "unset" — the null check has to distinguish
    // them or turning the cooldown off would silently restore the default.
    getAdminSettings.mockResolvedValue({ scoreCooldownMin: 0 });
    expect(await (await GET()).json()).toEqual({ cooldownMinutes: 0 });
  });

  it("answers with the DEFAULT, not an error, when the store is unreachable", async () => {
    // A scoring run must never fail because a config lookup did. Answering
    // with the baked default keeps this path agreeing with the workflow's own
    // fallback, instead of making a Redis blip look like "no cooldown".
    getAdminSettings.mockRejectedValue(new Error("redis down"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cooldownMinutes: SCORE_COOLDOWN_MIN });
  });

  it("discloses nothing but the cooldown", async () => {
    // The payload is world-readable by definition. Scoring POLICY belongs
    // here; anything about tokens, rubrics or who solved what does not.
    getAdminSettings.mockResolvedValue({
      scoreCooldownMin: 5,
      paused: true,
      hintCost: 42,
      updatedBy: "alice",
      moduleOverrides: { quiz: { title: "secret" } },
    });
    expect(Object.keys(await (await GET()).json())).toEqual(["cooldownMinutes"]);
  });
});
