// Two subtests in one file: the keyed-run fixture. Exercises that
// --test-name-pattern isolates one subtest's result from its sibling's.
import { test } from "node:test";
import assert from "node:assert/strict";

test("Sub-Pass", () => {
  assert.ok(true);
});

test("Sub-Fail", () => {
  assert.fail("this subtest is meant to fail");
});
