import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

// The modules this build knows how to score, defined once. A new vertical is a
// code change (add its key here + register its content), never config alone —
// the deliberate-registration model in docs/modules.md §1.2. v1 ships one module.
export const KNOWN_MODULES = ["secure-development"];
const MODULE = KNOWN_MODULES[0];

export const TARGETS = ["juice-shop", "dvwa", "webgoat", "securityshepherd", "vulnerableapp", "vampi"];

export const REPO_NAMES = {
  "juice-shop": "juice-shop",
  dvwa: "DVWA",
  webgoat: "WebGoat",
  securityshepherd: "SecurityShepherd",
  vulnerableapp: "VulnerableApp",
  vampi: "VAmPI",
};

export function loadConfig(path = process.env.EVENT_CONFIG ?? "/config/event.yaml", env = process.env) {
  const doc = parseYaml(readFileSync(path, "utf8"));
  const org = doc?.github?.org;
  if (!org) throw new Error("event.yaml: github.org is required");
  const modules = doc?.modules;
  if (!modules || typeof modules !== "object") throw new Error(`event.yaml: modules.${MODULE} is required`);
  const unknown = Object.keys(modules).filter((k) => !KNOWN_MODULES.includes(k));
  if (unknown.length) throw new Error(`event.yaml: unknown module: ${unknown.join(", ")} (v1 supports only ${KNOWN_MODULES.join(", ")})`);
  const mod = modules[MODULE];
  if (!mod) throw new Error(`event.yaml: modules.${MODULE} is required`);
  const targets = mod.targets;
  if (!Array.isArray(targets) || targets.length === 0) throw new Error("event.yaml: targets must be a non-empty list");
  const bad = targets.filter((t) => !TARGETS.includes(t));
  if (bad.length) throw new Error(`event.yaml: unknown targets: ${bad.join(", ")}`);
  if (!env.GITHUB_PAT) throw new Error("GITHUB_PAT env var is required");
  if (!env.SCORER_TOKEN) throw new Error("SCORER_TOKEN env var is required");
  return {
    org,
    targets,
    pat: env.GITHUB_PAT,
    apiUrl: env.GITHUB_API_URL ?? "https://api.github.com",
    scorerUrl: env.SCORER_URL ?? "http://scorer:4000",
    scorerToken: env.SCORER_TOKEN,
    pollIntervalMs: Number(env.POLL_INTERVAL_MS ?? 30000),
    statePath: env.STATE_PATH ?? "/state/state.json",
    commentAuthor: env.COMMENT_AUTHOR ?? "github-actions[bot]",
  };
}
