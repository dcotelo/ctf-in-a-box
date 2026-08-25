// The target -> fork-repo-name contract, sync half.
//
// `setup/targets.tsv` is the ONLY authoritative source of a fork's name:
// `ctf-setup.sh` creates each one with `--fork-name "$(prov_repo_name "$t")"`,
// and `prov_repo_name` is the basename of that file's `upstream_repo` column.
// Everything else that names a fork is a copy of it.
//
// `sync`'s copy decides which repos the poller reads score comments from, and
// `apps/web/src/lib/apps.ts`'s copy builds the fork links contestants click.
// Both used to be pinned only by a literal in their own test file, so the two
// could drift apart — or drift together, away from what is actually forked —
// with both suites green. Issue #149.
//
// Neither side imports the other: each reads the SAME tsv, the way
// setup/test/corpus/ is read from both the sync and bash module-key readers.
// Agreeing with the artefact is agreeing with each other, and it is the
// artefact that is true. The app half is
// apps/web/src/lib/__tests__/apps-repo-names.differential.test.ts.
//
// FAILURE MODE THIS PREVENTS: contestants get fork links that 404, or — worse
// and quieter — the poller watches a repo nobody opens PRs against, so scoring
// stops for that target while every service looks healthy.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REPO_NAMES, TARGETS } from "../src/config.js";

/** `setup/targets.tsv` as `{ target: forkRepoName }`, exactly as
 *  `prov_repo_name` derives it: column 2's basename. */
function repoNamesFromTargetsTsv(url = new URL("../../setup/targets.tsv", import.meta.url)) {
  const out = {};
  for (const line of readFileSync(url, "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [target, upstream] = line.split("\t");
    if (!target || !upstream) continue;
    out[target] = upstream.slice(upstream.lastIndexOf("/") + 1);
  }
  return out;
}

test("REPO_NAMES matches the fork names ctf-setup.sh actually creates", () => {
  // Deep equality both ways at once: a target missing here, an extra one, or
  // one whose CASING differs (github.com/<org>/dvwa is not the DVWA fork) all
  // fail this single assertion.
  assert.deepEqual(REPO_NAMES, repoNamesFromTargetsTsv());
});

test("TARGETS covers exactly the targets in targets.tsv", () => {
  assert.deepEqual([...TARGETS].sort(), Object.keys(repoNamesFromTargetsTsv()).sort());
});

test("the tsv actually parsed — the reader is asserted, not just its output", () => {
  // A file whose columns stopped being TAB-separated parses to `{}`. The two
  // assertions above would still fail, but they would fail pointing at
  // REPO_NAMES, sending the next reader to the wrong file. This one names the
  // real cause, and pins the count so a target silently dropped from the tsv
  // is a failure here rather than a quietly smaller comparison up there.
  assert.equal(Object.keys(repoNamesFromTargetsTsv()).length, 6);
});
