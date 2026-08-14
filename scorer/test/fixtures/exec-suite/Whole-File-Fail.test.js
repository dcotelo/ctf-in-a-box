// One pass, one fail — proves a whole-file run needs ZERO failures, not
// merely at least one pass.
import { test } from "node:test";
import assert from "node:assert/strict";

test("passes", () => assert.ok(true));
test("fails", () => assert.fail("boom"));
