import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";
import { loadConfig, REPO_NAMES } from "../src/config.js";

const ENV = { GITHUB_PAT: "ghp_x", SCORER_TOKEN: "s3cret" };

function writeYaml(text) {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const p = join(dir, "event.yaml");
  writeFileSync(p, text);
  return p;
}

test("loads org, targets and defaults", () => {
  const p = writeYaml(`github: { org: my-org }\nmodules:\n  secure-development:\n    targets: [dvwa, juice-shop]\n`);
  const cfg = loadConfig(p, ENV);
  assert.equal(cfg.org, "my-org");
  assert.deepEqual(cfg.targets, ["dvwa", "juice-shop"]);
  assert.equal(cfg.apiUrl, "https://api.github.com");
  assert.equal(cfg.scorerUrl, "http://scorer:4000");
  assert.equal(cfg.commentAuthor, "github-actions[bot]");
  assert.equal(cfg.pollIntervalMs, 30000);
});

test("rejects unknown target", () => {
  const p = writeYaml(`github: { org: o }\nmodules:\n  secure-development:\n    targets: [dvwa, nope]\n`);
  assert.throws(() => loadConfig(p, ENV), /unknown targets: nope/);
});

test("rejects missing org, empty targets, missing secrets", () => {
  assert.throws(() => loadConfig(writeYaml(`modules:\n  secure-development:\n    targets: [dvwa]\n`), ENV), /github.org/);
  assert.throws(() => loadConfig(writeYaml(`github: { org: o }\nmodules:\n  secure-development:\n    targets: []\n`), ENV), /targets/);
  assert.throws(() => loadConfig(writeYaml(`github: { org: o }\nmodules:\n  secure-development:\n    targets: [dvwa]\n`), { SCORER_TOKEN: "t" }), /GITHUB_PAT/);
});

test("REPO_NAMES maps every valid target", () => {
  assert.deepEqual(REPO_NAMES, {
    "juice-shop": "juice-shop", dvwa: "DVWA", webgoat: "WebGoat",
    securityshepherd: "SecurityShepherd", vulnerableapp: "VulnerableApp", vampi: "VAmPI",
  });
});

test("rejects unknown module key", () => {
  const p = writeYaml(`github: { org: my-org }\nmodules:\n  forensics: {}\n`);
  assert.throws(() => loadConfig(p, ENV), /unknown module: forensics/);
});

test("rejects missing modules section or missing secure-development", () => {
  assert.throws(() => loadConfig(writeYaml(`github: { org: my-org }\n`), ENV), /modules.secure-development/);
  assert.throws(() => loadConfig(writeYaml(`github: { org: my-org }\nmodules: {}\n`), ENV), /modules.secure-development/);
});

const YAML = `github: { org: o }\nmodules:\n  secure-development:\n    targets: [dvwa]\n`;
const b64Pem = () => Buffer.from(
  crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey
).toString("base64");

test("pat mode: GITHUB_PAT yields authMode pat and a getToken returning the PAT", async () => {
  const cfg = loadConfig(writeYaml(YAML), { GITHUB_PAT: "ghp_x", SCORER_TOKEN: "s" });
  assert.equal(cfg.authMode, "pat");
  assert.equal(await cfg.getToken(), "ghp_x");
  assert.equal(cfg.pat, undefined); // pat is no longer surfaced
});

test("app mode: App creds win over an also-present PAT", () => {
  const cfg = loadConfig(writeYaml(YAML), { GITHUB_APP_ID: "42", GITHUB_APP_PRIVATE_KEY: b64Pem(), GITHUB_PAT: "ghp_x", SCORER_TOKEN: "s" });
  assert.equal(cfg.authMode, "app");
  assert.equal(typeof cfg.getToken, "function");
});

test("rejects a non-PEM base64 private key", () => {
  const notPem = Buffer.from("not a pem").toString("base64");
  assert.throws(() => loadConfig(writeYaml(YAML), { GITHUB_APP_ID: "42", GITHUB_APP_PRIVATE_KEY: notPem, SCORER_TOKEN: "s" }), /PEM private key/);
});

test("throws when neither App creds nor PAT are set", () => {
  assert.throws(() => loadConfig(writeYaml(YAML), { SCORER_TOKEN: "s" }), /GITHUB_APP_ID .* or GITHUB_PAT/);
});
