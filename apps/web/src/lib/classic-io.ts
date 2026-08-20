// Pure bundle parser, validator and serializer for classic's bulk
// import/export. This file is CLIENT-SAFE ON PURPOSE: the admin panel's
// bulk-import UI is a Client Component that needs to validate a
// pasted/uploaded bundle in the browser before it ever reaches the server, so
// this file must NEVER import classic-store.ts (`server-only`) or anything
// that pulls in Upstash. It may only import from classic-keys.ts and
// markdown.ts, both dependency-free / client-safe for the same reason (see
// classic-keys.ts's and quiz-keys.ts's header comments).
//
// Validation here MIRRORS `upsertChallenge` in classic-store.ts field for
// field: a bundle that parses `ok: true` must contain only challenges the
// single-challenge admin form would also have accepted, or the two authoring
// paths disagree about what is valid. If `upsertChallenge`'s rules ever
// change, these must change with them.
//
// On top of that per-challenge mirror, a bundle carries rules the
// single-challenge path has no equivalent for, because a bundle must be
// SELF-CONTAINED: no duplicate ids within the file, and every challenge's
// `category` must appear in the file's OWN `categories` array — never the
// live store's — so importing a bundle never silently depends on categories
// that happen to already exist in the target event. The `categories` array
// itself is validated with the same shape rules as `setCategories` (max
// count, per-name trim/empty/length), plus one bundle-only addition:
// duplicates are a hard reject here rather than `setCategories`'s silent
// case-insensitive dedupe, because two spellings of the same category
// arriving in one paste is almost certainly a mistake worth surfacing rather
// than quietly fixing.

import {
  CLASSIC_ID_RE,
  CLASSIC_POINTS_MAX,
  CLASSIC_CATEGORY_MAX_LEN,
  CLASSIC_CATEGORIES_MAX,
} from "@/lib/classic-keys";
import { MARKDOWN_MAX } from "@/lib/markdown";

export const CLASSIC_BUNDLE_VERSION = 1;

export type ClassicBundleChallenge = {
  id: string;
  title: string;
  category: string;
  description: string;
  points: number;
  order: number;
  flag: string;
};

export type ClassicBundle = {
  version: number;
  categories: string[];
  challenges: ClassicBundleChallenge[];
};

export type ImportError = { where: string; message: string };

export type ParseResult = { ok: true; bundle: ClassicBundle } | { ok: false; errors: ImportError[] };

const CHALLENGE_KEYS = ["id", "title", "category", "description", "points", "order", "flag"] as const;
const CHALLENGE_KEY_SET = new Set<string>(CHALLENGE_KEYS);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validates and normalizes the top-level `categories` array. Returns the
 *  canonical (trimmed) list to check challenge membership against — entries
 *  that fail their own checks are left out, so a downstream "unknown
 *  category" error on a challenge is possible even when the real problem is
 *  the category entry itself; that cascading is fine under "collect every
 *  error". */
function validateCategories(raw: unknown, errors: ImportError[]): string[] {
  if (!Array.isArray(raw)) {
    errors.push({ where: "categories", message: '"categories" must be an array' });
    return [];
  }
  if (raw.length > CLASSIC_CATEGORIES_MAX) {
    errors.push({ where: "categories", message: `At most ${CLASSIC_CATEGORIES_MAX} categories are allowed` });
  }
  const seen = new Set<string>();
  const out: string[] = [];
  raw.forEach((entry, i) => {
    const where = `categories[${i}]`;
    if (typeof entry !== "string") {
      errors.push({ where, message: "Category must be a string" });
      return;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      errors.push({ where, message: "Category name cannot be empty" });
      return;
    }
    if (trimmed.length > CLASSIC_CATEGORY_MAX_LEN) {
      errors.push({ where, message: `Category name must be at most ${CLASSIC_CATEGORY_MAX_LEN} characters` });
      return;
    }
    const fold = trimmed.toLowerCase();
    if (seen.has(fold)) {
      errors.push({ where, message: `Duplicate category: ${trimmed}` });
      return;
    }
    seen.add(fold);
    out.push(trimmed);
  });
  return out;
}

/** Validates one challenge object against exactly the rules
 *  `upsertChallenge` enforces, plus the bundle-only category-membership rule
 *  (checked against THIS file's own `categories`, never the live store).
 *  Pushes every problem found onto `errors` rather than stopping at the
 *  first — the whole point of a bulk path is one pass over every row. */
function validateChallenge(raw: unknown, index: number, categories: readonly string[], errors: ImportError[]): void {
  const base = `challenges[${index}]`;
  if (!isPlainObject(raw)) {
    errors.push({ where: base, message: "Each challenge must be an object" });
    return;
  }

  const unknownKeys = Object.keys(raw).filter((k) => !CHALLENGE_KEY_SET.has(k));
  if (unknownKeys.length > 0) {
    errors.push({ where: base, message: `Unknown key(s): ${unknownKeys.join(", ")}` });
  }

  const id = raw.id;
  if (typeof id !== "string" || !CLASSIC_ID_RE.test(id)) {
    errors.push({ where: `${base}.id`, message: `Invalid challenge id: ${String(id)}` });
  }

  const title = raw.title;
  if (typeof title !== "string" || !title.trim()) {
    errors.push({ where: `${base}.title`, message: "Challenge title is required" });
  }

  // Membership is checked against the bundle's OWN categories (already
  // trimmed/deduped by validateCategories), mirroring upsertChallenge's
  // `categories.includes(c.category)` — but against the file, never the
  // live store's list, so a bundle's validity never depends on what the
  // target event already happens to have.
  const category = raw.category;
  if (typeof category !== "string") {
    errors.push({ where: `${base}.category`, message: "Challenge category must be a string" });
  } else if (!categories.includes(category)) {
    errors.push({ where: `${base}.category`, message: `Unknown category: ${category}` });
  }

  const description = raw.description;
  if (typeof description !== "string" || description.length > MARKDOWN_MAX) {
    errors.push({ where: `${base}.description`, message: `Description must be at most ${MARKDOWN_MAX} characters` });
  }

  // Mirrors upsertChallenge's points check verbatim: points get written
  // verbatim into the challenge hash and read back INSIDE SUBMIT_SCRIPT by
  // pattern-matching a plain integer, so a non-integer or out-of-range value
  // here is not cosmetic — see CLASSIC_POINTS_MAX's doc comment.
  const points = raw.points;
  if (typeof points !== "number" || !Number.isInteger(points) || points < 0 || points > CLASSIC_POINTS_MAX) {
    errors.push({
      where: `${base}.points`,
      message: `Challenge points must be an integer in [0, ${CLASSIC_POINTS_MAX}]`,
    });
  }

  const order = raw.order;
  if (typeof order !== "number" || !Number.isInteger(order)) {
    errors.push({ where: `${base}.order`, message: "Challenge order must be an integer" });
  }

  const flag = raw.flag;
  if (typeof flag !== "string" || !flag.trim()) {
    errors.push({ where: `${base}.flag`, message: "Flag is required" });
  }
}

/** Cross-row rule with no single-challenge equivalent: a repeated id within
 *  one file is always a mistake (it would silently overwrite the earlier
 *  challenge, inheriting its solves), never something to resolve with
 *  "last one wins". */
function checkDuplicateIds(challenges: readonly unknown[], errors: ImportError[]): void {
  const seen = new Set<string>();
  challenges.forEach((raw, i) => {
    if (!isPlainObject(raw) || typeof raw.id !== "string") return;
    if (seen.has(raw.id)) {
      errors.push({ where: `challenges[${i}].id`, message: `Duplicate challenge id: ${raw.id}` });
      return;
    }
    seen.add(raw.id);
  });
}

/** Parses and validates a bundle document, accumulating EVERY problem found
 *  rather than stopping at the first — an organizer pasting a 40-row file
 *  needs every issue in one pass, not forty round trips.
 *
 *  Validated in order: JSON parse -> top-level shape -> `version` ->
 *  `categories` -> each challenge (unknown keys, then each field) -> cross-row
 *  rules (duplicate ids, category membership). Returns `{ ok: true, bundle }`
 *  only when zero errors were collected across the whole pass. */
export function parseBundle(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Deliberately generic, with NO part of the underlying SyntaxError or the
    // raw input echoed back: V8's own JSON.parse error message embeds a
    // ~10-20 character excerpt of the offending text verbatim (e.g.
    // `Unexpected token 'c', "{"a": ctfbox{Sec"... is not valid JSON`), and on
    // a malformed bundle that excerpt can contain flag text. This response is
    // admin-only (route + body both behind `requireAdmin`, and the pasted
    // text is the admin's own), so no privilege boundary is crossed, but it
    // can still land on a screen-shared admin panel mid-event — and the
    // excerpt can't be safely truncated out after the fact, either: V8 wraps
    // it in quotes without escaping quotes that occur WITHIN the excerpt, so
    // a regex expecting balanced quoting can stop early and still leave part
    // of the secret text in the "trimmed" message. Not echoing anything at
    // all avoids that failure mode entirely.
    return {
      ok: false,
      errors: [{ where: "(document)", message: "Invalid JSON" }],
    };
  }

  if (!isPlainObject(parsed) || !Array.isArray(parsed.challenges)) {
    return {
      ok: false,
      errors: [{ where: "(document)", message: 'Bundle must be an object with a "challenges" array' }],
    };
  }

  const errors: ImportError[] = [];

  if (parsed.version !== CLASSIC_BUNDLE_VERSION) {
    errors.push({ where: "version", message: `Unsupported bundle version: expected ${CLASSIC_BUNDLE_VERSION}` });
  }

  const categories = validateCategories(parsed.categories, errors);

  const rawChallenges = parsed.challenges;
  rawChallenges.forEach((c, i) => validateChallenge(c, i, categories, errors));
  checkDuplicateIds(rawChallenges, errors);

  if (errors.length > 0) return { ok: false, errors };

  // Every challenge passed validation above (errors.length === 0), so this
  // cast is sound: each entry has exactly the required keys and types.
  const challenges = rawChallenges as ClassicBundleChallenge[];
  return { ok: true, bundle: { version: CLASSIC_BUNDLE_VERSION, categories, challenges } };
}

/** Indented, not minified — an organizer edits this file by hand. Ends in a
 *  trailing newline, like every other text file in the repo. */
export function serializeBundle(bundle: ClassicBundle): string {
  return JSON.stringify(bundle, null, 2) + "\n";
}
