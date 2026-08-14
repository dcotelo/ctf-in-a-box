// The file a catalogue-fixture entry points at. Nothing runs it — loadCatalogue
// never stats `entry.file` (only exec.js does, at run time) — it is here so the
// fixture directory mirrors a real rubric's shape. Deliberately trivial;
// exec.test.js supplies its own richer fixtures.
import { test } from "node:test";

test("Challenge-1-Excessive-Data-Exposure", () => {});
