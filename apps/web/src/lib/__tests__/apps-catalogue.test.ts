import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apps, type AppId } from "@/lib/apps";

// The static counts in apps.ts are a FALLBACK shown when the live /challenges
// fetch fails. A fallback that lies is worse than no fallback, so it is pinned
// to the vendored rubric here.
const repoRoot = join(import.meta.dirname, "..", "..", "..", "..", "..");

function catalogue(id: AppId): Array<{ difficulty?: number }> {
  const path = join(repoRoot, "scorer", "rubric.owasp", id, "tests", "challenges", `catalogue.${id}.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("apps.ts static fallback matches the vendored rubric", () => {
  for (const app of apps) {
    it(`${app.id} advertises its real challenge count and points`, () => {
      const entries = catalogue(app.id);
      const points = entries.reduce((sum, e) => sum + (e.difficulty ?? 1), 0);
      expect(app.challengeCount).toBe(entries.length);
      expect(app.maxPoints).toBe(points);
    });

    it(`${app.id} stars bracket its real difficulty range`, () => {
      const diffs = catalogue(app.id).map((e) => e.difficulty ?? 1);
      expect(app.stars).toEqual([Math.min(...diffs), Math.max(...diffs)]);
    });
  }
});
