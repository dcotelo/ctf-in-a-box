// Generates src/lib/event-config.generated.ts at build time.
// Priority: EVENT_CONFIG yaml file > EVENT_* env vars > neutral defaults.
// Fails the build loudly on invalid config — same rules as the kit's sync loader.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const TARGETS = ["juice-shop", "dvwa", "webgoat", "securityshepherd", "vulnerableapp", "vampi"];

const DEFAULTS = {
  name: "OWASP CTF",
  theme: "",
  dates: "",
  location: "",
  ctfStartsAt: null,
  url: "http://localhost:3000",
  contactEmail: "",
  // Canonical forks live under OWASP-CTF; self-hosted events override via
  // event.yaml's github.org (the same key the kit's sync loader requires).
  githubOrg: "OWASP-CTF",
  discordUrl: "",
  modules: [{ id: "secure-development", targets: TARGETS, scoreIngest: "poll" }],
  targets: TARGETS,
  admins: [],
};

function fail(msg) {
  console.error(`event-config: ${msg}`);
  process.exit(1);
}

function displayDates(startIso, endIso) {
  // Validate ISO strings first
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) fail(`invalid event.start: ${startIso}`);
  const end = endIso ? new Date(endIso) : start;
  if (Number.isNaN(end.getTime())) fail(`invalid event.end: ${endIso}`);

  // Parse wall-clock date textually from ISO string (before timezone offset)
  const parseWallClockDate = (iso) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return { y, m, d };
  };

  const startDate = parseWallClockDate(startIso);
  const endDate = parseWallClockDate(endIso || startIso);

  // Month names from UTC-aware Intl.DateTimeFormat (noon UTC avoids boundaries)
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const formatDate = (y, m, d) => fmt.format(new Date(Date.UTC(y, m - 1, d, 12)));

  // Compare wall-clock dates textually
  const sameDay = startDate.y === endDate.y && startDate.m === endDate.m && startDate.d === endDate.d;
  if (sameDay) return `${formatDate(startDate.y, startDate.m, startDate.d)}, ${startDate.y}`;

  const sameMonth = startDate.y === endDate.y && startDate.m === endDate.m;
  if (sameMonth) return `${formatDate(startDate.y, startDate.m, startDate.d)}–${endDate.d}, ${startDate.y}`;

  return `${formatDate(startDate.y, startDate.m, startDate.d)} – ${formatDate(endDate.y, endDate.m, endDate.d)}, ${endDate.y}`;
}

function validateTargets(targets) {
  if (!Array.isArray(targets) || targets.length === 0) fail("targets must be a non-empty list");
  const bad = targets.filter((t) => !TARGETS.includes(t));
  if (bad.length) fail(`unknown target(s): ${bad.join(", ")}`);
  return targets;
}

// Registered modules. A module is code + config: adding a key here is half of
// registering it, the app's src/lib/modules.ts is the other half. An unknown
// id fails loudly rather than being silently ignored.
const MODULE_VALIDATORS = {
  "secure-development": (mod) => ({
    id: "secure-development",
    targets: validateTargets(mod?.targets),
    scoreIngest: mod?.score_ingest === "push" ? "push" : "poll",
  }),
  quiz: () => ({ id: "quiz" }),
};

function validateModules(modules) {
  if (!modules || typeof modules !== "object") fail("event.yaml: modules is required");
  const ids = Object.keys(modules);
  if (ids.length === 0) fail("event.yaml: at least one module is required");
  const unknown = ids.filter((k) => !(k in MODULE_VALIDATORS));
  if (unknown.length) fail(`event.yaml: unknown module: ${unknown.join(", ")}`);
  // Stable order: registry order, not object-key order, so the generated file
  // is deterministic regardless of how the YAML was written.
  return Object.keys(MODULE_VALIDATORS)
    .filter((id) => ids.includes(id))
    .map((id) => MODULE_VALIDATORS[id](modules[id]));
}

/** Back-compat: the flat target list every existing `enabledApps` consumer
 *  still reads. Empty when secure-development is not enabled. */
function derivedTargets(mods) {
  return mods.find((m) => m.id === "secure-development")?.targets ?? [];
}

function fromYaml(path) {
  const doc = parseYaml(readFileSync(path, "utf8"));
  const mods = validateModules(doc?.modules);
  const ev = doc?.event ?? {};
  const startIso = ev.start ? String(ev.start) : null;
  if (startIso !== null && Number.isNaN(new Date(startIso).getTime())) fail(`invalid event.start: ${startIso}`);
  return {
    name: ev.name ?? DEFAULTS.name,
    theme: ev.theme ?? "",
    dates: ev.start ? displayDates(String(ev.start), ev.end && String(ev.end)) : DEFAULTS.dates,
    location: ev.location ?? "",
    ctfStartsAt: startIso,
    url: ev.url ?? DEFAULTS.url,
    contactEmail: ev.contact ? String(ev.contact) : "",
    githubOrg: doc?.github?.org ? String(doc.github.org) : DEFAULTS.githubOrg,
    discordUrl: ev.discord ? String(ev.discord) : "",
    modules: mods,
    targets: derivedTargets(mods),
    admins: Array.isArray(doc?.admins) ? doc.admins.map(String) : [],
  };
}

function fromEnv(env) {
  const envTargets = env.EVENT_TARGETS
    ? validateTargets(env.EVENT_TARGETS.split(",").map((s) => s.trim()))
    : TARGETS;
  return {
    name: env.EVENT_NAME,
    theme: env.EVENT_THEME ?? "",
    dates: env.EVENT_START ? displayDates(env.EVENT_START, env.EVENT_END) : "",
    location: env.EVENT_LOCATION ?? "",
    ctfStartsAt: env.EVENT_START ?? null,
    url: env.EVENT_URL ?? DEFAULTS.url,
    contactEmail: env.EVENT_CONTACT ?? "",
    githubOrg: env.EVENT_GITHUB_ORG ?? DEFAULTS.githubOrg,
    discordUrl: env.EVENT_DISCORD ?? "",
    modules: [{ id: "secure-development", targets: envTargets, scoreIngest: "poll" }],
    targets: envTargets,
    admins: env.EVENT_ADMINS ? env.EVENT_ADMINS.split(",").map((s) => s.trim()) : [],
  };
}

const env = process.env;
let cfg;
if (env.EVENT_CONFIG) cfg = fromYaml(env.EVENT_CONFIG);
else if (env.EVENT_NAME) cfg = fromEnv(env);
else cfg = DEFAULTS;

const here = dirname(fileURLToPath(import.meta.url));
const outPath = env.OUT_PATH ?? join(here, "..", "src", "lib", "event-config.generated.ts");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  `// GENERATED by scripts/generate-event-config.mjs — do not edit; gitignored.\n` +
    `export const eventConfig = ${JSON.stringify(cfg, null, 2)} as const;\n`,
);
console.error(`event-config: wrote ${outPath} (${cfg.name}, ${cfg.targets.length} targets)`);
