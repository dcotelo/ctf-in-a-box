#!/usr/bin/env node
// This is a CHECK, not a source of truth (ADR 10: target registration is
// deliberate and duplicated). It parses the independently-maintained TARGETS
// lists this repo already carries and fails if any two disagree — it never
// generates or edits any of them.
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

const targets = [
  { name: "sync/src/config.js", set: extractOrFail("sync/src/config.js TARGETS", parseSyncTargets()) },
  { name: "apps/web/src/lib/apps.ts", set: extractOrFail("apps/web/src/lib/apps.ts AppId", parseAppIdUnion()) },
  { name: "scorer/src/targets.js", set: extractOrFail("scorer/src/targets.js names", parseScorerTargets()) },
];
compareAll("targets", targets);

console.log(`registry-check: ok targets=${fmtSet(targets[0].set)}`);
