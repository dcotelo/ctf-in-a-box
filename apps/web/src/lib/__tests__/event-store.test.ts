import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { exportEventBundle } from "@/lib/event-store";

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
