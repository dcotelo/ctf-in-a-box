import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RUBRIC_ID } from "./rubric-id.js";
import { getTarget } from "./targets.js";

// Loads catalogue.<target>.json — the price list for an exec rubric. Returns
// null when the file is absent (the caller falls back to the YAML path); throws
// on content that is present but malformed, matching loadRubric's "invalid
// content fails loudly" contract.
//
// The catalogue's `key` is CamelCase (`Challenge-1-Excessive-Data-Exposure`)
// because it must match a node:test subtest name verbatim. The challenge `id`
// is that key lowercased, because ids become Redis field segments and are
// pinned to RUBRIC_ID. Both travel together: `key` drives --test-name-pattern,
// `id` drives scoring, the report, and the sync marker.
export function loadCatalogue(dir, targetName) {
  const target = getTarget(targetName);
  if (!target) throw new Error(`catalogue: unknown target: ${targetName}`);

  const path = join(dir, target.catalogueFile);
  if (!existsSync(path)) return null;

  const fail = (msg) => {
    throw new Error(`catalogue ${target.catalogueFile}: ${msg}`);
  };

  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    fail(`invalid JSON: ${err.message}`);
  }
  if (!Array.isArray(raw) || raw.length === 0) fail("expected a non-empty array of entries");

  const seen = new Set();
  return raw.map((entry, i) => {
    const where = `entry[${i}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`${where}: expected an object`);
    if (typeof entry.key !== "string" || entry.key.length === 0) fail(`${where}: key is required`);
    if (typeof entry.file !== "string" || entry.file.length === 0) fail(`${entry.key}: file is required`);

    const id = entry.key.toLowerCase();
    if (!RUBRIC_ID.test(id)) {
      fail(`${entry.key}: lowercased key "${id}" must match ${RUBRIC_ID} (it becomes a Redis field segment)`);
    }
    if (seen.has(id)) fail(`duplicate challenge id: ${id}`);
    seen.add(id);

    const points = entry.difficulty ?? 1;
    if (!Number.isInteger(points) || points < 1) fail(`${entry.key}: difficulty must be an integer >= 1`);

    const owasp = typeof entry.owasp === "string" && entry.owasp.length > 0 ? entry.owasp : null;
    return { id, key: entry.key, file: entry.file, name: entry.name ?? entry.key, points, owasp };
  });
}
