import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";
import { loadConfig, KNOWN_MODULES } from "../src/config.js";

const APP_KEY_B64 = Buffer.from(
  crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey
).toString("base64");
const ENV = { GITHUB_APP_ID: "42", GITHUB_APP_PRIVATE_KEY: APP_KEY_B64, SCORER_TOKEN: "s3cret" };

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
  assert.throws(() => loadConfig(writeYaml(`github: { org: o }\nmodules:\n  secure-development:\n    targets: [dvwa]\n`), { SCORER_TOKEN: "t" }), /GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required/);
});

// REPO_NAMES is pinned in repo-names.differential.test.js, against
// setup/targets.tsv — the file ctf-setup.sh actually derives fork names from.
// The literal that used to sit here proved only that REPO_NAMES equalled a
// copy of itself (issue #149).

test("rejects unknown module key", () => {
  const p = writeYaml(`github: { org: my-org }\nmodules:\n  forensics: {}\n`);
  assert.throws(() => loadConfig(p, ENV), /unknown module: forensics/);
});

// The app and sync mount the SAME event.yaml. `quiz` is a registered id the
// app's generator accepts, so sync must tolerate it rather than crash-loop the
// poller (which would silently freeze the leaderboard) — while still scoring
// only secure-development.
test("tolerates a registered module key it does not score (quiz)", () => {
  const p = writeYaml(`github: { org: my-org }\nmodules:\n  secure-development:\n    targets: [dvwa]\n  quiz: {}\n`);
  const cfg = loadConfig(p, ENV);
  assert.deepEqual(cfg.targets, ["dvwa"]);
});

test("returns null when no polled module is enabled (quiz-only)", () => {
  const p = writeYaml(`github: { org: my-org }\nmodules:\n  quiz: {}\n`);
  assert.equal(loadConfig(p, ENV), null);
});

// classic is a registered id (the app's generator accepts it) but is not a
// polled module — same contract as quiz-only: nothing for sync to score, a
// clean null rather than a throw.
test("returns null when no polled module is enabled (classic-only)", () => {
  const p = writeYaml(`github: { org: my-org }\nmodules:\n  classic: {}\n`);
  assert.equal(loadConfig(p, ENV), null);
});

test("still rejects a genuinely unknown module key", () => {
  const p = writeYaml(`github: { org: my-org }\nmodules:\n  forensics: {}\n`);
  assert.throws(() => loadConfig(p, ENV), /unknown module: forensics/);
});

test("a typo'd secure-development key is rejected, not treated as satisfied", () => {
  const p = writeYaml(`github: { org: my-org }\nmodules:\n  secure-develpment:\n    targets: [dvwa]\n`);
  assert.throws(() => loadConfig(p, ENV), /unknown module: secure-develpment/);
});

test("KNOWN_MODULES lists the ids sync tolerates", () => {
  assert.deepEqual(KNOWN_MODULES, ["secure-development", "quiz", "classic", "ai"]);
});

test("rejects a missing modules section entirely (not the same as an empty one)", () => {
  assert.throws(() => loadConfig(writeYaml(`github: { org: my-org }\n`), ENV), /modules.secure-development/);
});

test("returns null when modules is present but empty", () => {
  assert.equal(loadConfig(writeYaml(`github: { org: my-org }\nmodules: {}\n`), ENV), null);
});

const YAML = `github: { org: o }\nmodules:\n  secure-development:\n    targets: [dvwa]\n`;

test("app mode: App creds yield authMode app and a functional getToken", () => {
  const cfg = loadConfig(writeYaml(YAML), { GITHUB_APP_ID: "42", GITHUB_APP_PRIVATE_KEY: APP_KEY_B64, SCORER_TOKEN: "s" });
  assert.equal(cfg.authMode, "app");
  assert.equal(typeof cfg.getToken, "function");
});

test("rejects a non-PEM base64 private key", () => {
  const notPem = Buffer.from("not a pem").toString("base64");
  assert.throws(() => loadConfig(writeYaml(YAML), { GITHUB_APP_ID: "42", GITHUB_APP_PRIVATE_KEY: notPem, SCORER_TOKEN: "s" }), /PEM private key/);
});

test("throws when App creds are not set", () => {
  assert.throws(() => loadConfig(writeYaml(YAML), { SCORER_TOKEN: "s" }), /GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required/);
});

// ---------------------------------------------------------------------------
// EVENT_CONFIG_B64 — the no-bind-mount path (single-machine Fly deployment).
// ---------------------------------------------------------------------------

test("EVENT_CONFIG_B64 supplies the config with no file on disk at all", () => {
  const cfg = loadConfig("/no/such/event.yaml", {
    ...ENV,
    EVENT_CONFIG_B64: Buffer.from(YAML).toString("base64"),
  });
  assert.equal(cfg.org, "o");
  assert.deepEqual(cfg.targets, ["dvwa"]);
});

// The precedence is what makes one variable safe to set everywhere: an
// organizer who exports EVENT_CONFIG_B64 for the app's build must not thereby
// change which config a compose-mounted sync reads out from under itself.
test("EVENT_CONFIG_B64 wins over the mounted file when both are present", () => {
  const p = writeYaml(`github: { org: from-file }\nmodules:\n  secure-development:\n    targets: [dvwa]\n`);
  const fromEnv = `github: { org: from-env }\nmodules:\n  secure-development:\n    targets: [webgoat]\n`;
  const cfg = loadConfig(p, { ...ENV, EVENT_CONFIG_B64: Buffer.from(fromEnv).toString("base64") });
  assert.equal(cfg.org, "from-env");
  assert.deepEqual(cfg.targets, ["webgoat"]);
});

// compose renders an unset `${EVENT_CONFIG_B64:-}` as "". Treating that as a
// real (empty) config would report a blank event.yaml instead of falling back
// to the file that is actually mounted.
test("an EMPTY EVENT_CONFIG_B64 is absent, not an empty config", () => {
  const p = writeYaml(YAML);
  const cfg = loadConfig(p, { ...ENV, EVENT_CONFIG_B64: "" });
  assert.equal(cfg.org, "o");
});

// Blames the variable, not the file the text never came from.
test("EVENT_CONFIG_B64 that decodes to nothing names the variable", () => {
  assert.throws(
    () => loadConfig("/no/such/event.yaml", { ...ENV, EVENT_CONFIG_B64: Buffer.from("   ").toString("base64") }),
    /EVENT_CONFIG_B64 is set but decodes to nothing/,
  );
});

// Number("abc") is NaN, and setTimeout(NaN) fires immediately — a typo'd
// interval would poll GitHub in a tight loop. Refuse at boot instead.
test("rejects a non-numeric or non-positive POLL_INTERVAL_MS instead of polling unthrottled", () => {
  const p = writeYaml(`github: { org: my-org }\nmodules:\n  secure-development:\n    targets: [dvwa]\n`);
  assert.throws(() => loadConfig(p, { ...ENV, POLL_INTERVAL_MS: "abc" }), /POLL_INTERVAL_MS/);
  assert.throws(() => loadConfig(p, { ...ENV, POLL_INTERVAL_MS: "0" }), /POLL_INTERVAL_MS/);
  assert.equal(loadConfig(p, { ...ENV, POLL_INTERVAL_MS: "5000" }).pollIntervalMs, 5000);
});

// setTimeout caps at 2^31-1 ms and treats anything larger as 1 ms, and main()
// adds up to +20% jitter before sleeping — so the largest interval that stays a
// real timer after jitter is floor((2^31-1) / 1.2) = 1789569705.
test("bounds POLL_INTERVAL_MS so the jittered delay stays inside setTimeout's range", () => {
  const p = writeYaml(`github: { org: my-org }\nmodules:\n  secure-development:\n    targets: [dvwa]\n`);
  assert.equal(loadConfig(p, { ...ENV, POLL_INTERVAL_MS: "1789569705" }).pollIntervalMs, 1789569705);
  assert.throws(() => loadConfig(p, { ...ENV, POLL_INTERVAL_MS: "1789569706" }), /POLL_INTERVAL_MS/);
});
