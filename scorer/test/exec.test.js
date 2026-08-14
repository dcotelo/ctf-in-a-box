import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { runExec } from "../src/exec.js";

const testsDir = join(import.meta.dirname, "fixtures", "exec-suite");
const keyed = (key, id) => ({ id, name: key, points: 1, exec: { file: "Mixed.test.js", key, byName: true, testsDir } });
const whole = (file, id) => ({ id, name: file, points: 1, exec: { file, key: file, byName: false, testsDir } });

test("a keyed subtest that passes is solved", async () => {
  assert.deepEqual(await runExec([keyed("Sub-Pass", "sub-pass")], { concurrency: 1 }), ["sub-pass"]);
});

test("a keyed subtest that fails is not solved", async () => {
  assert.deepEqual(await runExec([keyed("Sub-Fail", "sub-fail")], { concurrency: 1 }), []);
});

test("a keyed subtest isolates its sibling — one file, independent results", async () => {
  const solved = await runExec(
    [keyed("Sub-Pass", "sub-pass"), keyed("Sub-Fail", "sub-fail")],
    { concurrency: 1 },
  );
  assert.deepEqual(solved, ["sub-pass"]);
});

test("a key matching no subtest is not solved", async () => {
  assert.deepEqual(await runExec([keyed("Sub-Absent", "sub-absent")], { concurrency: 1 }), []);
});

test("a whole-file run is solved only when every test in it passes", async () => {
  assert.deepEqual(await runExec([whole("Whole-File-Pass.test.js", "wf-pass")], { concurrency: 1 }), ["wf-pass"]);
  assert.deepEqual(await runExec([whole("Whole-File-Fail.test.js", "wf-fail")], { concurrency: 1 }), []);
});

test("a missing test file is not solved and does not throw", async () => {
  const missing = { id: "gone", name: "gone", points: 1, exec: { file: "Nope.test.js", key: "Nope", byName: false, testsDir } };
  assert.deepEqual(await runExec([missing], { concurrency: 1 }), []);
});

test("results keep catalogue order regardless of concurrency", async () => {
  const solved = await runExec(
    [keyed("Sub-Pass", "a-pass"), keyed("Sub-Fail", "b-fail"), keyed("Sub-Pass", "c-pass")],
    { concurrency: 3 },
  );
  assert.deepEqual(solved, ["a-pass", "c-pass"]);
});

test("stops spawning once the target proves unreachable", async () => {
  // Each child blocks forever on a real timer (see Hang.test.js — a bare
  // unsettled top-level await does NOT hold the event loop open), so none
  // ever reports. With a 300ms safety cap and concurrency 1, the first two
  // children each burn one full safety window before the second arms the
  // abort; the remaining three must be short-circuited before ever spawning.
  //
  // The direct proof of that is HANG_SPAWN_MARKER: Hang.test.js appends to it
  // on start, so counting appends tells us exactly how many children were
  // spawned — independent of wall-clock speed. The elapsed-time assertion is
  // kept only as a secondary sanity net (expressed as a multiple of the
  // injected safety window, not a bare literal) against total wedging.
  const markerDir = mkdtempSync(join(tmpdir(), "ctf-score-hang-"));
  const marker = join(markerDir, "spawns");
  const hang = (id) => ({
    id, name: id, points: 1,
    exec: { file: "Hang.test.js", key: "Hang", byName: false, testsDir },
  });
  const safetyMs = 300;
  const started = Date.now();
  const solved = await runExec([hang("a"), hang("b"), hang("c"), hang("d"), hang("e")], {
    concurrency: 1,
    env: { ...process.env, CTF_SCORE_SAFETY_MS: String(safetyMs), HANG_SPAWN_MARKER: marker },
  });
  const elapsed = Date.now() - started;
  const spawnCount = existsSync(marker) ? readFileSync(marker, "utf8").length : 0;
  rmSync(markerDir, { recursive: true, force: true });

  assert.deepEqual(solved, []);
  // Effect-based proof: exactly the two children that armed the abort ever
  // spawned; c, d, and e were short-circuited by the abort gate.
  assert.equal(spawnCount, 2, `expected exactly 2 children spawned before abort armed, got ${spawnCount}`);
  // Sanity net only — a generous multiple of the injected safety window, well
  // clear of the ~2× cost the effect assertion above already proves.
  assert.ok(elapsed < 6 * safetyMs, `expected early abort, took ${elapsed}ms (bound ${6 * safetyMs}ms)`);
});
