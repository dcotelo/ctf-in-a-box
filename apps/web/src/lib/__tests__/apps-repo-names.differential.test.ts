// The target -> fork-repo-name contract, app half. Issue #149.
//
// `setup/targets.tsv` is the ONLY authoritative source of a fork's name:
// `ctf-setup.sh` creates each one with `--fork-name "$(prov_repo_name "$t")"`,
// and `prov_repo_name` is the basename of that file's `upstream_repo` column.
// The map in `apps/web/src/lib/apps.ts` — which builds the fork links
// contestants click — is a copy of it, as is `sync/src/config.js`'s, which
// decides which repos the poller reads score comments from.
//
// Each side reads the SAME tsv rather than importing the other (they are
// separate packages), the way setup/test/corpus/ is read from both module-key
// readers: agreeing with the artefact is agreeing with each other, and it is
// the artefact that is true. The sync half is
// sync/test/repo-names.differential.test.js.
//
// This replaces a literal in apps.test.ts that compared apps.ts against a copy
// of itself — green whether or not either matched what is actually forked.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apps } from "@/lib/apps";
import { eventConfig } from "@/lib/event-config";

/** `setup/targets.tsv` as `{ target: forkRepoName }`, exactly as
 *  `prov_repo_name` derives it: column 2's basename. */
function repoNamesFromTargetsTsv(): Record<string, string> {
  const url = new URL("../../../../../setup/targets.tsv", import.meta.url);
  const out: Record<string, string> = {};
  for (const line of readFileSync(url, "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [target, upstream] = line.split("\t");
    if (!target || !upstream) continue;
    out[target] = upstream.slice(upstream.lastIndexOf("/") + 1);
  }
  return out;
}

describe("fork links vs setup/targets.tsv", () => {
  it("reads the tsv — the reader is asserted, not just its output", () => {
    // A file whose columns stopped being TAB-separated parses to `{}`, and an
    // empty expectation makes every assertion below vacuous: `apps` would be
    // compared against nothing and the suite would stay green.
    expect(Object.keys(repoNamesFromTargetsTsv())).toHaveLength(6);
  });

  it("points every fork link at the repo ctf-setup.sh actually creates", () => {
    const expected = repoNamesFromTargetsTsv();
    expect(apps.length).toBeGreaterThan(0);
    for (const app of apps) {
      // Casing is part of the assertion: github.com/<org>/dvwa is not the DVWA
      // fork, and the whole URL is compared so the org half stays pinned to
      // the event's configured org rather than a hardcoded one.
      expect(app.repo, app.id).toBe(`https://github.com/${eventConfig.githubOrg}/${expected[app.id]}`);
    }
  });

  it("covers exactly the targets in the tsv, in both directions", () => {
    // One-way coverage is the gap that lets a target be added to the tsv,
    // forked by ctf-setup.sh, and never linked from the app — or listed in the
    // app and never forked at all.
    expect(apps.map((a) => a.id).sort()).toEqual(Object.keys(repoNamesFromTargetsTsv()).sort());
  });
});
