import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
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
  // Each child blocks forever on a top-level await, so none ever reports.
  // With a 300ms safety cap, two bare timeouts arm the abort and the remaining
  // challenges short-circuit — the whole run must finish far under 5 × 300ms.
  const hang = (id) => ({
    id, name: id, points: 1,
    exec: { file: "Hang.test.js", key: "Hang", byName: false, testsDir },
  });
  const started = Date.now();
  const solved = await runExec([hang("a"), hang("b"), hang("c"), hang("d"), hang("e")], {
    concurrency: 1,
    env: { ...process.env, CTF_SCORE_SAFETY_MS: "300" },
  });
  const elapsed = Date.now() - started;
  assert.deepEqual(solved, []);
  assert.ok(elapsed < 1500, `expected early abort, took ${elapsed}ms`);
});
