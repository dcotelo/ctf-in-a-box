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

  it("renders the secure-development shape from a discriminated detail", () => {
    const progress: ModuleProgress = {
      points: 30, completed: 3, lastActivityAt: null,
      detail: { kind: "secure-development", apps: {} },
    };
    const html = renderToStaticMarkup(<ModuleDetail moduleId="secure-development" progress={progress} entry={entry()} />);
    expect(html).toContain("No app breakdown reported yet.");
  });
});
