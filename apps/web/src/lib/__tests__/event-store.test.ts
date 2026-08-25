import { beforeEach, describe, expect, it, vi } from "vitest";
import * as classicStore from "@/lib/classic-store";
import * as quizStore from "@/lib/quiz-store";
import * as adminStore from "@/lib/admin-store";

const m = vi.hoisted(() => ({
  exportClassic: vi.fn(), exportQuiz: vi.fn(),
  getAdminSettings: vi.fn(), effectivePaused: vi.fn(),
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

  it("THE LEAK TEST: no contestant login, team, solve, or audit appears anywhere in the serialized bundle", async () => {
    // exportEventBundle only ever calls the content exporters above; assert by
    // scanning the serialized string for seeded run-state tokens.
    const { bundle } = await exportEventBundle(new Date());
    const s = JSON.stringify(bundle);
    for (const token of ["contestant-login", "team-slug", "ctf:team:", "ctf:user:", "ctf:admin:audit", "solvedAt"]) {
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

  it("applies only policy settings, never schedule fields", async () => {
    await importEventBundle(bundleFixture(), "alice");
    const patch = vi.mocked(adminStore.updateAdminSettings).mock.calls[0][0];
    expect(patch.hintCost).toBe(25);
    expect("scoringStartsAt" in patch).toBe(false);
    expect("paused" in patch).toBe(false);
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
});
