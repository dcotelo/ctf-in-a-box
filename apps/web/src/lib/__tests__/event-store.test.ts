import { beforeEach, describe, expect, it, vi } from "vitest";
import * as classicStore from "@/lib/classic-store";
import * as quizStore from "@/lib/quiz-store";
import * as adminStore from "@/lib/admin-store";

const m = vi.hoisted(() => ({
  exportClassic: vi.fn(), exportQuiz: vi.fn(),
  getAdminSettings: vi.fn(), effectivePaused: vi.fn(),
  // A plain, mutated-in-place array (never reassigned) so `vi.mock`'s
  // captured reference below stays live across tests — a test that wants a
  // different baked set mutates its contents rather than pointing the mock
  // at a new array.
  bakedModuleIds: ["classic", "quiz"] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/classic-store", () => ({ exportBundle: m.exportClassic, clearChallenges: vi.fn(), importBundle: vi.fn() }));
vi.mock("@/lib/quiz-store", () => ({ exportBundle: m.exportQuiz, clearQuestions: vi.fn(), importBundle: vi.fn() }));
vi.mock("@/lib/admin-store", () => ({ getAdminSettings: m.getAdminSettings, effectivePaused: m.effectivePaused, updateAdminSettings: vi.fn(), resetEvent: vi.fn() }));
vi.mock("@/lib/event-config", () => ({ eventConfig: {
  name: "Demo CTF", theme: "web", dates: "2026", location: "online", ctfStartsAt: null,
  contactEmail: "org@example.com", admins: ["alice"], githubOrg: "org", discordUrl: "d",
  targets: [], modules: [{ id: "quiz" }],
} }));
// event-store.ts's own Finding-A reconciliation (`reconcileEnabledModuleIds`)
// reads `bakedModuleIds` from `@/lib/modules`. Mocked directly (rather than
// relying on the real modules.ts derived from the `@/lib/event-config` mock
// above) so individual tests can set exactly which ids this "box" was built
// with, independent of the unrelated eventConfig fixture other tests share.
vi.mock("@/lib/modules", () => ({
  bakedModuleIds: m.bakedModuleIds,
  isModuleId: (v: unknown) => typeof v === "string" && ["classic", "quiz", "secure-development"].includes(v),
}));

import { exportEventBundle, importEventBundle, EventLiveError } from "@/lib/event-store";

beforeEach(() => {
  vi.clearAllMocks();
  m.exportClassic.mockResolvedValue({ version: 1, categories: ["Web"], challenges: [{ id: "web-one-ab12cd", title: "One", category: "Web", description: "hi", points: 50, order: 0, flag: "ctfbox{One}" }] });
  m.exportQuiz.mockResolvedValue({ version: 1, questions: [] });
  m.getAdminSettings.mockResolvedValue({
    hintCost: 50, teamMaxMembers: 4, enabledModuleIds: ["classic", "quiz"],
    scoringStartsAt: "2026-01-01T00:00:00Z", paused: true, updatedBy: "alice", updatedAt: "x",
  });
  m.effectivePaused.mockReturnValue(true);
});

describe("exportEventBundle", () => {
  it("carries content but drops schedule/run settings and org PII", async () => {
    const { bundle } = await exportEventBundle(new Date("2026-06-01T00:00:00Z"));
    expect(bundle.version).toBe(1);
    expect(bundle.kind).toBe("archive");
    expect(bundle.settings.hintCost).toBe(50);
    expect("scoringStartsAt" in bundle.settings).toBe(false);
    expect("paused" in bundle.settings).toBe(false);
    expect("updatedBy" in bundle.settings).toBe(false);
    expect(bundle.event.name).toBe("Demo CTF");
    const s = JSON.stringify(bundle);
    expect(s).not.toContain("org@example.com");
    expect(s).not.toContain('"admins"');
  });

  it("warns when the event is live", async () => {
    m.effectivePaused.mockReturnValue(false);
    const { warnings } = await exportEventBundle(new Date());
    expect(warnings.some((w) => /live/i.test(w))).toBe(true);
  });

  it("names Secure Development as not archivable when enabled", async () => {
    m.getAdminSettings.mockResolvedValue({ enabledModuleIds: ["secure-development", "classic"], paused: true });
    const { warnings } = await exportEventBundle(new Date());
    expect(warnings.some((w) => /secure development/i.test(w))).toBe(true);
  });

  it("exports the RESOLVED enabledModuleIds, not the raw possibly-undefined settings field (fixture's box falls back to eventConfig's baked modules)", async () => {
    m.getAdminSettings.mockResolvedValue({ hintCost: 50, paused: true, enabledModuleIds: undefined });
    const { bundle } = await exportEventBundle(new Date());
    // The mocked eventConfig fixture bakes only `quiz` — with no runtime
    // override, exportEventBundle falls back to that baked set to decide
    // which modules to include, and bundle.settings.enabledModuleIds must
    // carry that SAME resolved array rather than dropping the key.
    expect(bundle.settings.enabledModuleIds).toEqual(["quiz"]);
  });

  // aiCooldownSec rides EVENT_POLICY_FIELDS beside classicCooldownSec (see
  // event-io.ts) — pinned by name here since neither cooldown field was
  // previously asserted anywhere in this suite.
  it("carries both modules' cooldown overrides — classicCooldownSec and aiCooldownSec — through export", async () => {
    m.getAdminSettings.mockResolvedValue({
      hintCost: 50, teamMaxMembers: 4, enabledModuleIds: ["classic", "quiz"],
      classicCooldownSec: 45, aiCooldownSec: 12,
      scoringStartsAt: "2026-01-01T00:00:00Z", paused: true, updatedBy: "alice", updatedAt: "x",
    });
    const { bundle } = await exportEventBundle(new Date("2026-06-01T00:00:00Z"));
    expect(bundle.settings.classicCooldownSec).toBe(45);
    expect(bundle.settings.aiCooldownSec).toBe(12);
  });

  it("THE LEAK TEST: run-state tokens seeded into excluded settings fields never survive the allowlist", async () => {
    // exportEventBundle's ONLY allowlist decision for `settings` is the fixed
    // loop over EVENT_POLICY_FIELDS in the function body — it never reads any
    // other AdminSettings field, and never spreads the settings object
    // wholesale. The previous version of this test scanned the serialized
    // bundle for tokens that were never present anywhere in the mocked
    // return values in the first place, so it passed just as well with the
    // allowlist deleted (a naive `{...settings}` spread would have passed
    // too, trivially — nothing in the fixture ever held those strings).
    //
    // Fix: seed canary tokens into AdminSettings fields that are real
    // (readable off the mocked getAdminSettings() return value) but EXCLUDED
    // from EVENT_POLICY_FIELDS — schedule/actor bookkeeping fields
    // (`updatedBy`, `updatedAt`, `scoringStartsAt`, `scoringEndsAt`) that
    // event-io.ts's header says must never round-trip through an archive. A
    // naive `{...settings}` spread WOULD surface these; assert they still
    // don't appear, which now genuinely exercises the field-by-field
    // allowlist instead of an absence of test data.
    //
    // "ctf:admin:audit" and "solvedAt" are dropped from the original token
    // list: neither is introducible through anything exportEventBundle
    // actually reads (getAdminSettings(), eventConfig, or the content
    // modules' own exportBundle()). The audit log lives under a wholly
    // separate Redis key (`ctf:admin:audit`) this function's call graph never
    // touches, and solve timestamps are guarded by classic-store's/
    // quiz-store's own exportBundle() never reading solves/attempts
    // (asserted in classic-store.test.ts/quiz-store.test.ts) rather than by
    // anything in this function. Keeping them here would be an assertion
    // that can never fail no matter what this file's allowlist logic does.
    m.getAdminSettings.mockResolvedValue({
      hintCost: 50,
      teamMaxMembers: 4,
      enabledModuleIds: ["classic", "quiz"],
      paused: true,
      updatedBy: "contestant-login",
      updatedAt: "team-slug-owner",
      scoringStartsAt: "ctf:team:owl-squad",
      scoringEndsAt: "ctf:user:42-marker",
    });
    const { bundle } = await exportEventBundle(new Date());
    const s = JSON.stringify(bundle);
    for (const token of ["contestant-login", "team-slug", "ctf:team:", "ctf:user:"]) {
      expect(s).not.toContain(token);
    }
  });
});

const bundleFixture = () => ({
  version: 1, kind: "archive" as const,
  event: { name: "Demo CTF" },
  settings: { hintCost: 25, moduleOverrides: { classic: { title: "T" } }, enabledModuleIds: ["classic", "quiz"] },
  classic: { version: 1 as const, categories: ["Web"], challenges: [] },
  quiz: { version: 1 as const, questions: [] },
});

describe("importEventBundle", () => {
  beforeEach(() => {
    m.getAdminSettings.mockResolvedValue({ paused: true });
    m.effectivePaused.mockReturnValue(true);
    m.bakedModuleIds.length = 0;
    m.bakedModuleIds.push("classic", "quiz");
    vi.mocked(classicStore.importBundle).mockResolvedValue({ created: 0, updated: 0, categories: 1 });
    vi.mocked(quizStore.importBundle).mockResolvedValue({ created: 0, updated: 0 });
    vi.mocked(adminStore.resetEvent).mockResolvedValue({ cleared: {}, resetAt: "x" });
    vi.mocked(adminStore.updateAdminSettings).mockResolvedValue({} as Awaited<ReturnType<typeof adminStore.updateAdminSettings>>);
  });

  it("refuses to import into a live event", async () => {
    m.effectivePaused.mockReturnValue(false);
    await expect(importEventBundle(bundleFixture(), "alice")).rejects.toBeInstanceOf(EventLiveError);
    expect(adminStore.resetEvent).not.toHaveBeenCalled();
    expect(classicStore.clearChallenges).not.toHaveBeenCalled();
  });

  it("clears content before importing (true replace), then sweeps run state", async () => {
    await importEventBundle(bundleFixture(), "alice");
    expect(adminStore.resetEvent).toHaveBeenCalledWith("alice");
    expect(classicStore.clearChallenges).toHaveBeenCalled();
    expect(classicStore.importBundle).toHaveBeenCalled();
    // clear must precede import
    const clearOrder = vi.mocked(classicStore.clearChallenges).mock.invocationCallOrder[0];
    const importOrder = vi.mocked(classicStore.importBundle).mock.invocationCallOrder[0];
    expect(clearOrder).toBeLessThan(importOrder);
  });

  it("clears BOTH content stores on replace, even when the bundle carries only one module (a quiz-only archive must still wipe stale classic content already on the target)", async () => {
    const quizOnly = bundleFixture();
    delete (quizOnly as { classic?: unknown }).classic;
    await importEventBundle(quizOnly, "alice");
    expect(classicStore.clearChallenges).toHaveBeenCalled();
    expect(classicStore.importBundle).not.toHaveBeenCalled();
    expect(quizStore.clearQuestions).toHaveBeenCalled();
    expect(quizStore.importBundle).toHaveBeenCalled();
  });

  it("applies only policy settings, never schedule fields", async () => {
    await importEventBundle(bundleFixture(), "alice");
    const patch = vi.mocked(adminStore.updateAdminSettings).mock.calls[0][0];
    expect(patch.hintCost).toBe(25);
    expect("scoringStartsAt" in patch).toBe(false);
    expect("paused" in patch).toBe(false);
  });

  // Mirrors the export-side coverage above, for the same reason: neither
  // cooldown field was previously pinned by name on the import path either.
  it("applies both cooldown overrides — classicCooldownSec and aiCooldownSec — to the settings patch", async () => {
    await importEventBundle(
      { ...bundleFixture(), settings: { ...bundleFixture().settings, classicCooldownSec: 45, aiCooldownSec: 12 } },
      "alice",
    );
    const patch = vi.mocked(adminStore.updateAdminSettings).mock.calls[0][0];
    expect(patch.classicCooldownSec).toBe(45);
    expect(patch.aiCooldownSec).toBe(12);
  });

  // Fail-fast ordering, the point of Finding 1: the settings patch is
  // validated and applied BEFORE anything destructive runs, so a bad bundle
  // (updateAdminSettings throwing AdminValidationError) is rejected with
  // nothing wiped or half-replaced yet.
  it("applies the settings patch before resetEvent/clear (fail-fast order)", async () => {
    await importEventBundle(bundleFixture(), "alice");
    const settingsOrder = vi.mocked(adminStore.updateAdminSettings).mock.invocationCallOrder[0];
    const resetOrder = vi.mocked(adminStore.resetEvent).mock.invocationCallOrder[0];
    const clearOrder = vi.mocked(classicStore.clearChallenges).mock.invocationCallOrder[0];
    expect(settingsOrder).toBeLessThan(resetOrder);
    expect(settingsOrder).toBeLessThan(clearOrder);
  });

  it("rejects a bad bundle before anything destructive runs, when updateAdminSettings throws", async () => {
    vi.mocked(adminStore.updateAdminSettings).mockRejectedValueOnce(new Error("AdminValidationError: bad module id"));
    await expect(importEventBundle(bundleFixture(), "alice")).rejects.toThrow(/bad module id/);
    expect(adminStore.resetEvent).not.toHaveBeenCalled();
    expect(classicStore.clearChallenges).not.toHaveBeenCalled();
    expect(classicStore.importBundle).not.toHaveBeenCalled();
    expect(quizStore.clearQuestions).not.toHaveBeenCalled();
    expect(quizStore.importBundle).not.toHaveBeenCalled();
  });

  it("names build-time branding in skipped", async () => {
    const { skipped } = await importEventBundle(bundleFixture(), "alice");
    expect(skipped.some((s) => /baked at build time|rebuild/i.test(s))).toBe(true);
  });

  it("drops a null scalar policy field instead of forwarding it (a fresh export round-trip carries these)", async () => {
    await importEventBundle(
      { ...bundleFixture(), settings: { ...bundleFixture().settings, hintCost: null, teamMaxMembers: 6 } },
      "alice",
    );
    const patch = vi.mocked(adminStore.updateAdminSettings).mock.calls[0][0];
    expect("hintCost" in patch).toBe(false);
    expect(patch.teamMaxMembers).toBe(6);
  });

  // Finding A: reconcile enabledModuleIds against the box's baked module set
  // before it ever reaches updateAdminSettings, instead of letting a
  // cross-SD import throw AdminValidationError (a 500 at the route).
  it("reconciles a bundle's secure-development against a box that wasn't built with it, and names it in skipped", async () => {
    // Baked set deliberately excludes secure-development — mirrors admin-store's
    // own SD-refusal check, which is keyed only off secure-development
    // membership, not the other module ids.
    m.bakedModuleIds.length = 0;
    m.bakedModuleIds.push("classic", "quiz");
    const { skipped } = await importEventBundle(
      {
        ...bundleFixture(),
        settings: { ...bundleFixture().settings, enabledModuleIds: ["classic", "quiz", "secure-development"] },
      },
      "alice",
    );
    const patch = vi.mocked(adminStore.updateAdminSettings).mock.calls[0][0];
    expect(patch.enabledModules).toEqual(["classic", "quiz"]);
    expect(skipped.some((s) => /secure.development/i.test(s))).toBe(true);
  });

  it("passes a set that already matches the box's baked modules through unchanged, with no extra skipped entry", async () => {
    m.bakedModuleIds.length = 0;
    m.bakedModuleIds.push("classic", "quiz");
    const { skipped } = await importEventBundle(bundleFixture(), "alice");
    const patch = vi.mocked(adminStore.updateAdminSettings).mock.calls[0][0];
    expect(patch.enabledModules).toEqual(["classic", "quiz"]);
    // Only the always-present branding notice — nothing module-related.
    expect(skipped).toEqual([expect.stringMatching(/baked at build time|rebuild/i)]);
  });

  it("keeps secure-development enabled when the box is baked with it but the bundle's set omits it", async () => {
    m.bakedModuleIds.length = 0;
    m.bakedModuleIds.push("classic", "quiz", "secure-development");
    const { skipped } = await importEventBundle(bundleFixture(), "alice");
    const patch = vi.mocked(adminStore.updateAdminSettings).mock.calls[0][0];
    expect(patch.enabledModules).toEqual(expect.arrayContaining(["classic", "quiz", "secure-development"]));
    expect(skipped.some((s) => /secure development/i.test(s))).toBe(true);
  });
});
