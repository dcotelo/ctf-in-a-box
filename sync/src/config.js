import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { makeAppAuth } from "./appAuth.js";

// The module keys this build TOLERATES in event.yaml, defined once. A new
// vertical is a code change (add its key here + register its content), never
// config alone — the deliberate-registration model in docs/modules.md §1.2.
// This list must stay in step with the app's own registry
// (apps/web/scripts/generate-event-config.mjs's MODULE_VALIDATORS): both read
// the SAME event.yaml, so a key the app accepts but sync rejects crash-loops
// the poller and silently freezes the leaderboard.
export const KNOWN_MODULES = ["secure-development", "quiz", "classic", "ai"];
// The one module sync actually scores. Deliberately a literal, not
// KNOWN_MODULES[0] — tolerating a key is not the same as serving it, and the
// two must not drift if the list is reordered or extended.
const MODULE = "secure-development";

export const TARGETS = ["juice-shop", "dvwa", "webgoat", "securityshepherd", "vulnerableapp", "vampi"];

export const REPO_NAMES = {
  "juice-shop": "juice-shop",
  dvwa: "DVWA",
  webgoat: "WebGoat",
  securityshepherd: "SecurityShepherd",
  vulnerableapp: "VulnerableApp",
  vampi: "VAmPI",
};

// Poll auth: a GitHub App (org-scoped, auto-expiring, revocable installation
// tokens). Returns a uniform async getToken(fetchImpl) seam.
function resolveAuth(env, apiUrl) {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    throw new Error("auth: GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required (GitHub App)");
  }
  const privateKey = Buffer.from(env.GITHUB_APP_PRIVATE_KEY, "base64").toString("utf8");
  if (!privateKey.includes("PRIVATE KEY")) {
    throw new Error("GITHUB_APP_PRIVATE_KEY must be base64-encoded PEM (a PEM private key)");
  }
  const installationId = env.GITHUB_APP_INSTALLATION_ID ? Number(env.GITHUB_APP_INSTALLATION_ID) : undefined;
  const auth = makeAppAuth({ appId: env.GITHUB_APP_ID, privateKey, installationId, apiUrl });
  return { authMode: "app", getToken: (fetchImpl) => auth.getToken(fetchImpl) };
}

// Where the event.yaml TEXT comes from, in precedence order.
//
// EVENT_CONFIG_B64 exists for deployments with no writable host to bind-mount
// from — the single-machine Fly deployment (docs/fly.md) is the reason it was
// added. There, every container shares one machine and there is no host path
// for `./event.yaml:/config/event.yaml:ro` to point at.
//
// It is the SAME variable, in the SAME encoding, that the app already takes as
// a build-arg to bake its config (see apps/web/Dockerfile and ADR 26) — so an
// organizer sets one value and both readers of event.yaml agree by
// construction. The difference is only WHEN each consumes it: the app at build
// time, sync at start-up.
//
// The file path stays the default so nothing about a compose deployment
// changes, and an empty EVENT_CONFIG_B64 is treated as absent rather than as
// an empty config: compose renders an unset `${EVENT_CONFIG_B64:-}` as the
// empty string, and taking that literally would turn "variable not set" into
// "event.yaml is blank" — a parse error blaming the config file for a missing
// environment variable.
function readConfigText(path, env) {
  const b64 = env.EVENT_CONFIG_B64;
  if (b64) {
    const text = Buffer.from(b64, "base64").toString("utf8");
    // base64-decoding junk does not throw — it yields bytes. Catching it here
    // names the variable that is wrong; letting it through produces a YAML
    // error about the *file*, which is the one thing it did not come from.
    if (!text.trim()) throw new Error("EVENT_CONFIG_B64 is set but decodes to nothing (expected base64 of event.yaml)");
    return text;
  }
  return readFileSync(path, "utf8");
}

export function loadConfig(path = process.env.EVENT_CONFIG ?? "/config/event.yaml", env = process.env) {
  const doc = parseYaml(readConfigText(path, env));
  const org = doc?.github?.org;
  if (!org) throw new Error("event.yaml: github.org is required");
  const modules = doc?.modules;
  // Array.isArray is not redundant: `modules: []` (or a `- quiz` sequence) is
  // typeof "object" and truthy, so without it a sequence where a mapping
  // belongs was accepted here as "nothing enabled" while ctf-setup.sh rejected
  // the same file outright — a two-readers divergence the shared corpus in
  // test/module-readers.differential.test.js now pins.
  if (!modules || typeof modules !== "object" || Array.isArray(modules)) {
    throw new Error(`event.yaml: modules.${MODULE} is required`);
  }
  const unknown = Object.keys(modules).filter((k) => !KNOWN_MODULES.includes(k));
  if (unknown.length) throw new Error(`event.yaml: unknown module: ${unknown.join(", ")} (known modules: ${KNOWN_MODULES.join(", ")})`);
  const mod = modules[MODULE];
  // A module this build cannot serve is not an error — it just means there is
  // nothing to poll. Returning null (rather than throwing) is what lets a
  // quiz-only event run: throwing here crash-looped the poller and froze the
  // leaderboard with no signal beyond a restart count.
  if (!mod) return null;
  const targets = mod.targets;
  if (!Array.isArray(targets) || targets.length === 0) throw new Error("event.yaml: targets must be a non-empty list");
  const bad = targets.filter((t) => !TARGETS.includes(t));
  if (bad.length) throw new Error(`event.yaml: unknown targets: ${bad.join(", ")}`);
  if (!env.SCORER_TOKEN) throw new Error("SCORER_TOKEN env var is required");
  const apiUrl = env.GITHUB_API_URL ?? "https://api.github.com";
  const { authMode, getToken } = resolveAuth(env, apiUrl);
  return {
    org,
    targets,
    getToken,
    authMode,
    apiUrl,
    scorerUrl: env.SCORER_URL ?? "http://scorer:4000",
    scorerToken: env.SCORER_TOKEN,
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 30000),
    statePath: env.STATE_PATH ?? "/state/state.json",
    commentAuthor: env.COMMENT_AUTHOR ?? "github-actions[bot]",
  };
}
