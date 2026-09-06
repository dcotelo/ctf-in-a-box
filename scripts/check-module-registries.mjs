#!/usr/bin/env node
// This is a CHECK, not a source of truth (ADR 10: module registration is
// deliberate and duplicated). It parses the independently-maintained
// KNOWN_MODULES/TARGETS lists this repo already carries and fails if any two
// disagree — it never generates or edits any of them.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRel(relPath) {
  return readFileSync(join(root, relPath), "utf8");
}

function fail(msg) {
  console.error(`registry-check: ${msg}`);
  process.exit(1);
}

function extractQuoted(text) {
  const out = [];
  const re = /"([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

function extractOrFail(label, arr) {
  if (!arr || arr.length === 0) {
    fail(
      `${label}: parser extracted nothing (fail closed — an empty set would ` +
        `vacuously agree with any other set, which defeats the check)`,
    );
  }
  return new Set(arr);
}

function fmtSet(set) {
  return `[${[...set].sort().join(", ")}]`;
}

// Fails on the first disagreement, naming both sides, per the "Modules" /
// "Targets" tables in the PR brief: entries.length is always small (3-4), so
// comparing everything against entries[0] is enough to catch any pairwise
// mismatch.
function compareAll(label, entries) {
  const [first, ...rest] = entries;
  for (const other of rest) {
    if (first.set.size !== other.set.size || [...first.set].some((v) => !other.set.has(v))) {
      fail(
        `${label} mismatch: ${first.name}: ${fmtSet(first.set)} vs ${other.name}: ${fmtSet(other.set)}`,
      );
    }
  }
}

// --- modules ---

function parseSyncModules() {
  const text = readRel("sync/src/config.js");
  const m = text.match(/export const KNOWN_MODULES\s*=\s*\[([^\]]*)\]/);
  return extractQuoted(m ? m[1] : "");
}

function parseSetupModules() {
  const text = readRel("setup/ctf-setup.sh");
  // Not the first mention of the words KNOWN_MODULES (those are comments) —
  // only the actual assignment, a single double-quoted string on its own line.
  const m = text.match(/^KNOWN_MODULES="([^"]*)"$/m);
  const inner = m ? m[1].trim() : "";
  return inner ? inner.split(/\s+/) : [];
}

function parseGenModules() {
  const text = readRel("apps/web/scripts/generate-event-config.mjs");
  const block = text.match(/const MODULE_VALIDATORS\s*=\s*\{([\s\S]*?)\n\};/);
  const inner = block ? block[1] : "";
  // Only the top-level "<key>: (...) => " entries — quoted ("secure-development")
  // or bare (quiz, classic, ai) — never a nested key inside a returned object.
  const re = /^\s*"?([A-Za-z0-9_-]+)"?\s*:\s*\([^)]*\)\s*=>/gm;
  const keys = [];
  let m;
  while ((m = re.exec(inner))) keys.push(m[1]);
  return keys;
}

function parseModuleIdUnion() {
  const text = readRel("apps/web/src/lib/modules.ts");
  // The union can wrap across lines, so capture everything from the `=` up to
  // the next `;` rather than assuming one line.
  const m = text.match(/export type ModuleId\s*=([\s\S]*?);/);
  return extractQuoted(m ? m[1] : "");
}

// --- targets ---

function parseSyncTargets() {
  const text = readRel("sync/src/config.js");
  const m = text.match(/export const TARGETS\s*=\s*\[([^\]]*)\]/);
  return extractQuoted(m ? m[1] : "");
}

function parseAppIdUnion() {
  const text = readRel("apps/web/src/lib/apps.ts");
  const m = text.match(/export type AppId\s*=([\s\S]*?);/);
  return extractQuoted(m ? m[1] : "");
}

function parseScorerTargets() {
  const text = readRel("scorer/src/targets.js");
  const names = [];
  const re = /\bname:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) names.push(m[1]);
  if (names.length) return names;
  // Fallback: no per-target `name:` field found — try quoted strings in an
  // exported array shape instead.
  const arr = text.match(/export const TARGETS\s*=\s*\[([^\]]*)\]/);
  return arr ? extractQuoted(arr[1]) : [];
}

// --- event.yaml.example: subset, not equality ---

function parseExampleModules() {
  const text = readRel("event.yaml.example");
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === "modules:");
  // A missing modules: block entirely is not "nothing enabled" — every
  // event.yaml reader (e.g. sync/src/config.js) rejects that shape outright,
  // so the example must always declare the key, even with nothing under it.
  if (start === -1) fail("event.yaml.example: modules block is required");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    // The next top-level (unindented) YAML key ends the modules: mapping.
    // Column-0 comment lines belong to it and must not end the block early.
    if (/^[A-Za-z0-9_-]+:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const keys = [];
  for (const line of lines.slice(start + 1, end)) {
    const m = line.match(/^ {2}(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+)):/);
    // Any other module-level (2-space) line that is not a comment is a key the
    // parser can't read — refuse it rather than skip it, or an entry such as
    // `secure_development:` passes the known-module check by being invisible.
    if (!m && /^ {2}\S/.test(line) && !/^ {2}#/.test(line)) {
      fail(`event.yaml.example: unparseable module entry: ${line.trim()}`);
    }
    if (m) keys.push(m[1] ?? m[2] ?? m[3]);
  }
  return keys;
}

const modules = [
  { name: "sync/src/config.js", set: extractOrFail("sync/src/config.js KNOWN_MODULES", parseSyncModules()) },
  { name: "setup/ctf-setup.sh", set: extractOrFail("setup/ctf-setup.sh KNOWN_MODULES", parseSetupModules()) },
  {
    name: "apps/web/scripts/generate-event-config.mjs",
    set: extractOrFail("apps/web/scripts/generate-event-config.mjs MODULE_VALIDATORS", parseGenModules()),
  },
  { name: "apps/web/src/lib/modules.ts", set: extractOrFail("apps/web/src/lib/modules.ts ModuleId", parseModuleIdUnion()) },
];
compareAll("modules", modules);

const targets = [
  { name: "sync/src/config.js", set: extractOrFail("sync/src/config.js TARGETS", parseSyncTargets()) },
  { name: "apps/web/src/lib/apps.ts", set: extractOrFail("apps/web/src/lib/apps.ts AppId", parseAppIdUnion()) },
  { name: "scorer/src/targets.js", set: extractOrFail("scorer/src/targets.js names", parseScorerTargets()) },
];
compareAll("targets", targets);

// Same fail-closed guard as the registries above: a modules: block the parser
// can't read (renamed, re-indented) must not pass as "nothing invented".
const exampleModules = extractOrFail("event.yaml.example modules block", parseExampleModules());
const knownModules = modules[0].set;
const invented = [...exampleModules].filter((k) => !knownModules.has(k));
if (invented.length) {
  fail(
    `event.yaml.example: modules block names ${fmtSet(new Set(invented))}, not in the registry ` +
      `${fmtSet(knownModules)} — the example may omit a known module, but must not invent one`,
  );
}

console.log(`registry-check: ok modules=${fmtSet(knownModules)} targets=${fmtSet(targets[0].set)}`);
