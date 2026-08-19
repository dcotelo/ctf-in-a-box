// The modules: reader contract, sync half.
//
// event.yaml's `modules:` block is read by THREE independent parsers in three
// languages with no shared code (sync/src/config.js, setup/ctf-setup.sh,
// apps/web/scripts/generate-event-config.mjs). They must agree on which files
// they ACCEPT and which they REJECT — a file one half of the stack provisions
// and the other refuses is exactly how a valid event silently half-boots.
//
// setup/test/corpus/ is the shared corpus that pins this down: each fixture
// records its expected verdict in its FILENAME (accept-*.yaml /
// reject-*.yaml) and, for accepted ones, the targets both readers must
// extract in a leading `# targets: a,b` comment (empty for a quiz-only
// event). This file runs the corpus through loadConfig;
// setup/test/module_readers.bats runs the SAME files through the bash reader.
// Both assert against the same recorded verdicts, so agreeing with the corpus
// is agreeing with each other.
//
// Note on "accept": loadConfig returning `null` is an ACCEPT (a valid config
// with no polled module — the quiz-only case), not a rejection. Only a throw
// is a rejection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";

const CORPUS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "setup", "test", "corpus");

// Enough env for loadConfig to get PAST its non-module checks, so a fixture's
// verdict is decided by its modules:/targets shape and nothing else.
const ENV = {
  SCORER_TOKEN: "corpus-token",
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: Buffer.from("-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n").toString("base64"),
};

const fixtures = readdirSync(CORPUS)
  .filter((f) => f.endsWith(".yaml"))
  .sort();

// The `# targets: a,b` header a fixture records (empty when there are none).
function recordedTargets(file) {
  const line = readFileSync(join(CORPUS, file), "utf8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .find((l) => l.startsWith("# targets:"));
  if (!line) return [];
  return line.slice("# targets:".length).split(",").map((t) => t.trim()).filter(Boolean);
}

function verdict(file) {
  try {
    return { verdict: "accept", cfg: loadConfig(join(CORPUS, file), ENV) };
  } catch (err) {
    return { verdict: "reject", error: err.message };
  }
}

test("corpus is big enough and covers both verdicts", () => {
  const accept = fixtures.filter((f) => f.startsWith("accept-"));
  const reject = fixtures.filter((f) => f.startsWith("reject-"));
  assert.equal(accept.length + reject.length, fixtures.length, "every fixture must be named accept-* or reject-*");
  assert.ok(fixtures.length >= 30, `corpus has only ${fixtures.length} fixtures`);
  assert.ok(accept.length >= 12, `only ${accept.length} accept fixtures`);
  assert.ok(reject.length >= 12, `only ${reject.length} reject fixtures`);
});

test("loadConfig's verdict matches every fixture's recorded verdict", () => {
  const mismatches = [];
  for (const f of fixtures) {
    const want = f.startsWith("accept-") ? "accept" : "reject";
    const got = verdict(f);
    if (got.verdict !== want) mismatches.push(`${f}: want ${want}, got ${got.verdict}${got.error ? ` (${got.error})` : ""}`);
  }
  assert.deepEqual(mismatches, []);
});

test("loadConfig extracts each accepted fixture's recorded targets", () => {
  const mismatches = [];
  for (const f of fixtures.filter((x) => x.startsWith("accept-"))) {
    const want = recordedTargets(f);
    const got = verdict(f);
    const targets = got.cfg ? got.cfg.targets : [];
    if (JSON.stringify(targets) !== JSON.stringify(want)) {
      mismatches.push(`${f}: want [${want}], got [${targets}]`);
    }
  }
  assert.deepEqual(mismatches, []);
});

test("a quiz-only fixture is an accept that yields no config to poll", () => {
  const cfg = loadConfig(join(CORPUS, "accept-flow-quiz-only.yaml"), ENV);
  assert.equal(cfg, null);
});

test("a sequence where the modules mapping belongs is rejected, not read as empty", () => {
  // typeof [] === "object" and [] is truthy: without an explicit Array check
  // this parsed as "no modules enabled" while ctf-setup.sh rejected the file.
  assert.throws(() => loadConfig(join(CORPUS, "reject-modules-empty-sequence.yaml"), ENV), /modules\.secure-development is required/);
  assert.throws(() => loadConfig(join(CORPUS, "reject-modules-sequence-items.yaml"), ENV), /modules\.secure-development is required/);
});

test("the shipped event.yaml.example is accepted", () => {
  const cfg = loadConfig(resolve(CORPUS, "..", "..", "..", "event.yaml.example"), ENV);
  assert.deepEqual(cfg.targets, ["juice-shop", "dvwa"]);
});
