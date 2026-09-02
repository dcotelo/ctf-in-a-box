import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <img {...p} alt="" /> }));
import ModuleDetail from "@/components/module-detail";
import type { LeaderboardEntry, ModuleProgress } from "@/lib/leaderboard/types";

const entry = (): LeaderboardEntry => ({
  rank: 1, login: "ada", team: null, points: 30, patched: 3, failed: 0, total: 3,
  apps: {}, updatedAt: null,
});

describe("ModuleDetail", () => {
  it("renders the quiz shape from a discriminated detail", () => {
    const progress: ModuleProgress = {
      points: 40, completed: 4, lastActivityAt: null,
      detail: { kind: "quiz", answered: 4, total: 6, points: 40 },
    };
    const html = renderToStaticMarkup(<ModuleDetail moduleId="quiz" progress={progress} entry={entry()} />);
    expect(html).toMatch(/4\s*\/\s*6/);
  });

  it("renders the classic shape from a discriminated detail", () => {
    const progress: ModuleProgress = {
      points: 50, completed: 2, lastActivityAt: null,
      detail: { kind: "classic", solved: 2, total: 5, points: 50 },
    };
    const html = renderToStaticMarkup(<ModuleDetail moduleId="classic" progress={progress} entry={entry()} />);
    expect(html).toMatch(/2\s*\/\s*5/);
    expect(html).toContain("flags");
    // The quiz branch used to be an UNGUARDED fallthrough, so a third variant
    // rendered with quiz's noun. Each `kind` now has its own explicit branch.
    expect(html).not.toContain("answered");
  });

  // The narrow is on `detail.kind`, never on `moduleId` — the compiler can
  // only prove the branch's shape from the discriminant, and a mismatched
  // `moduleId` must not be able to steer the render at the wrong data.
  it("renders from detail.kind rather than the moduleId prop", () => {
    const progress: ModuleProgress = {
      points: 50, completed: 2, lastActivityAt: null,
      detail: { kind: "classic", solved: 2, total: 5, points: 50 },
    };
    const html = renderToStaticMarkup(<ModuleDetail moduleId="quiz" progress={progress} entry={entry()} />);
    expect(html).toContain("flags");
    expect(html).not.toContain("answered");
  });

  it("renders the ai shape from a discriminated detail", () => {
    const progress: ModuleProgress = {
      points: 20, completed: 2, lastActivityAt: null,
      detail: { kind: "ai", solved: 2, total: 3, points: 20 },
    };
    const html = renderToStaticMarkup(<ModuleDetail moduleId="ai" progress={progress} entry={entry()} />);
    expect(html).toMatch(/2\s*\/\s*3/);
    expect(html).toContain("challenges");
    expect(html).not.toContain("answered");
    expect(html).not.toContain("flags");
  });

  it("renders the secure-development shape from a discriminated detail", () => {
    const progress: ModuleProgress = {
      points: 30, completed: 3, lastActivityAt: null,
      detail: { kind: "secure-development", apps: {} },
    };
    const html = renderToStaticMarkup(<ModuleDetail moduleId="secure-development" progress={progress} entry={entry()} />);
    expect(html).toContain("No app breakdown reported yet.");
  });
});
