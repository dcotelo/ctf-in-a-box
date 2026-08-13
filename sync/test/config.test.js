import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, REPO_NAMES } from "../src/config.js";

const ENV = { GITHUB_PAT: "ghp_x", SCORER_TOKEN: "s3cret" };

function writeYaml(text) {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const p = join(dir, "event.yaml");
  writeFileSync(p, text);
  return p;
}

test("loads org, targets and defaults", () => {
  const p = writeYaml(`github: { org: my-org }\ntargets: [dvwa, juice-shop]\n`);
  const cfg = loadConfig(p, ENV);
  assert.equal(cfg.org, "my-org");
  assert.deepEqual(cfg.targets, ["dvwa", "juice-shop"]);
  assert.equal(cfg.apiUrl, "https://api.github.com");
  assert.equal(cfg.scorerUrl, "http://scorer:4000");
  assert.equal(cfg.commentAuthor, "github-actions[bot]");
  assert.equal(cfg.pollIntervalMs, 30000);
});

test("rejects unknown target", () => {
  const p = writeYaml(`github: { org: o }\ntargets: [dvwa, nope]\n`);
  assert.throws(() => loadConfig(p, ENV), /unknown targets: nope/);
});

test("rejects missing org, empty targets, missing secrets", () => {
  assert.throws(() => loadConfig(writeYaml(`targets: [dvwa]\n`), ENV), /github.org/);
  assert.throws(() => loadConfig(writeYaml(`github: { org: o }\ntargets: []\n`), ENV), /targets/);
  assert.throws(() => loadConfig(writeYaml(`github: { org: o }\ntargets: [dvwa]\n`), { SCORER_TOKEN: "t" }), /GITHUB_PAT/);
});

test("REPO_NAMES maps every valid target", () => {
  assert.deepEqual(REPO_NAMES, {
    "juice-shop": "juice-shop", dvwa: "DVWA", webgoat: "WebGoat",
    securityshepherd: "SecurityShepherd", vulnerableapp: "VulnerableApp", vampi: "VAmPI",
  });
});
