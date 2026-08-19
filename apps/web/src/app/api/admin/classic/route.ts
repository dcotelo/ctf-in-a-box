import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { ADMIN_AUDIT_KEY, AUDIT_CAP } from "@/lib/admin-store";
import {
  ClassicValidationError,
  deleteChallenge,
  listCategories,
  listChallengesForAdmin,
  setCategories,
  upsertChallenge,
  type AdminChallenge,
  type Challenge,
} from "@/lib/classic-store";
import { upstashPipeline } from "@/lib/upstash";

/**
 * Organizer authoring surface for the classic (flag) module: list (GET),
 * create-or-update a challenge or replace the category list (POST), and
 * delete a challenge (DELETE). Gated by `requireAdmin` throughout; every
 * write appends a line to the same `ctf:admin:audit` trail `admin-store`'s
 * settings/reset/seed writers and the quiz admin route use.
 *
 * This is the one surface that may return a challenge's flag. GET calls
 * `listChallengesForAdmin()`, so each row carries `{ challenge, flag }` and
 * the edit form can prefill the flag an organizer is editing — an organizer
 * fixing a typo must not have to retype the whole flag from memory and risk
 * silently redefining what counts as solved. That is sound precisely because
 * `requireAdmin` runs FIRST, before any store read: anyone past it can
 * already rewrite or delete the flag outright. The contestant path is
 * untouched and stays flagless — `/flags` calls `listChallenges()`, which
 * never reads `ctf:classic:flag`/`ctf:classic:flagnorm` at all.
 *
 * The POST payload is runtime-shape-checked field by field, rejecting any key
 * it doesn't explicitly allow, BEFORE it ever reaches `upsertChallenge` or
 * `setCategories`. This matters because TypeScript only rejects excess
 * properties on object LITERALS, not on parsed JSON — without this check, a
 * crafted request body could smuggle an extra key straight through to the
 * store. `parseChallengePayload` / `parseCategoriesPayload` below are the
 * guard: unknown keys, wrong types, or a missing field all fail closed with a
 * 400, never a partially-trusted write.
 *
 * POST carries two distinct payload shapes on the SAME route rather than a
 * separate endpoint per resource: a body with exactly one key, `categories`
 * (an array), replaces the category list; anything else is parsed as a
 * challenge-plus-flag upsert. The two key sets never overlap, so the shape
 * alone is enough to dispatch — no extra discriminator field for a caller to
 * get wrong.
 */

type ChallengePayload = Challenge & { flag: string };

/** The two POST shapes' allowed key sets. Exported (not just module-private)
 *  so a test can assert, structurally, that they stay disjoint — see the
 *  route test file's "categories/challenge key sets never overlap" case.
 *  Asserting this in code rather than trusting the two parsers to agree by
 *  construction is what catches a future optional challenge field, or a
 *  challenge field literally named `categories`, before it reintroduces the
 *  ambiguity this route's shape-only dispatch depends on there being none
 *  of. */
export const CHALLENGE_KEYS = new Set(["id", "title", "category", "description", "points", "order", "flag"]);
export const CATEGORIES_KEYS = new Set(["categories"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasOnlyKeys(obj: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(obj).every((k) => allowed.has(k));
}

function parseChallengePayload(body: unknown): ChallengePayload | null {
  if (!isPlainObject(body) || !hasOnlyKeys(body, CHALLENGE_KEYS)) return null;
  if (typeof body.id !== "string" || body.id.length === 0) return null;
  // TRIMMED, not merely non-empty, mirroring the quiz admin route's prompt
  // check: a whitespace-only title is empty for every consumer that trims it
  // later, including the delete confirmation's required typed phrase.
  if (typeof body.title !== "string" || body.title.trim().length === 0) return null;
  if (typeof body.category !== "string" || body.category.length === 0) return null;
  if (typeof body.description !== "string") return null;
  if (typeof body.points !== "number" || !Number.isInteger(body.points) || body.points < 0) return null;
  if (typeof body.order !== "number" || !Number.isInteger(body.order)) return null;
  if (typeof body.flag !== "string" || body.flag.trim().length === 0) return null;
  return {
    id: body.id,
    title: body.title.trim(),
    category: body.category,
    description: body.description,
    points: body.points,
    order: body.order,
    flag: body.flag,
  };
}

/** Recognizes the OTHER POST shape: a body carrying exactly one key,
 *  `categories`, an array of strings. Deliberately exact (`hasOnlyKeys` PLUS
 *  requiring the key present, not merely "no other keys") rather than merely
 *  "has a categories key" — that is what keeps this shape and the challenge
 *  shape mutually exclusive without a discriminator field. A body carrying
 *  BOTH `categories` and any challenge key fails `hasOnlyKeys` here (an
 *  unrecognized key for this shape) and also fails `parseChallengePayload`'s
 *  own `hasOnlyKeys` (an unrecognized key there), so it falls through to the
 *  400 catch-all rather than being silently treated as either shape. */
function parseCategoriesPayload(body: unknown): string[] | null {
  if (!isPlainObject(body) || !hasOnlyKeys(body, CATEGORIES_KEYS)) return null;
  if (!Array.isArray(body.categories)) return null;
  if (!body.categories.every((c) => typeof c === "string")) return null;
  return body.categories as string[];
}

/** Maps an error thrown by `upsertChallenge`/`deleteChallenge`/`setCategories`
 *  to a response: a `ClassicValidationError` means the caller's payload was
 *  genuinely bad (bad id, unknown category, non-integer points, empty flag,
 *  too many categories, ...) -> 400 with the message and field. Anything else
 *  is the store's own plain `Error` for a real Upstash/infra failure -> 503,
 *  so an organizer is never told "bad request" for a problem that was never
 *  theirs to fix. */
function errorResponse(err: unknown): Response {
  if (err instanceof ClassicValidationError) {
    return NextResponse.json({ error: err.message, field: err.field }, { status: 400 });
  }
  console.error("[admin/classic] store write failed", err);
  return NextResponse.json({ error: "classic store write failed" }, { status: 503 });
}

/** Appends one audit line, mirroring admin-store's / the quiz admin route's
 *  LPUSH+LTRIM pattern. Best-effort: an audit-write failure is logged but
 *  never fails a request whose actual data write already succeeded. */
async function writeAudit(actor: string, action: string, detail: Record<string, unknown>): Promise<void> {
  const audit = JSON.stringify({ at: new Date().toISOString(), by: actor, action, ...detail });
  try {
    await upstashPipeline([
      ["LPUSH", ADMIN_AUDIT_KEY, audit],
      ["LTRIM", ADMIN_AUDIT_KEY, 0, AUDIT_CAP - 1],
    ]);
  } catch (err) {
    console.error("[admin/classic] audit write failed", err);
  }
}

export async function GET(request: Request) {
  const gate = await requireAdmin(request.headers);
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  // Admin-gated, so this may carry each challenge's flag — see the header
  // comment. The `requireAdmin` check above must stay the first statement in
  // this handler: with flags in the payload, an early store read on an
  // unauthenticated request is no longer merely wasted work.
  let challenges: AdminChallenge[];
  let categories: string[];
  try {
    [challenges, categories] = await Promise.all([listChallengesForAdmin(), listCategories()]);
  } catch (err) {
    return errorResponse(err);
  }
  return NextResponse.json({ challenges, categories });
}

export async function POST(request: Request) {
  const gate = await requireAdmin(request.headers);
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  const body = await request.json().catch(() => null);

  const categoriesPayload = parseCategoriesPayload(body);
  if (categoriesPayload) {
    let categories: string[];
    try {
      categories = await setCategories(categoriesPayload);
    } catch (err) {
      return errorResponse(err);
    }
    await writeAudit(gate.login, "classic-categories", { count: categories.length });
    return NextResponse.json({ categories });
  }

  const parsed = parseChallengePayload(body);
  if (!parsed) return NextResponse.json({ error: "invalid request payload" }, { status: 400 });

  const { flag, ...challenge } = parsed;
  const c: Challenge = challenge;
  let saved: AdminChallenge;
  try {
    saved = await upsertChallenge(c, flag);
  } catch (err) {
    return errorResponse(err);
  }

  await writeAudit(gate.login, "classic-upsert", { challengeId: c.id });
  // Echoes the STORED record (flag trimmed by `upsertChallenge`), not the raw
  // payload, so the authoring client's state matches what a subsequent GET
  // would return rather than drifting from it.
  return NextResponse.json({ challenge: saved.challenge, flag: saved.flag });
}

export async function DELETE(request: Request) {
  const gate = await requireAdmin(request.headers);
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  const body = await request.json().catch(() => ({}));
  const id = typeof (body as { id?: unknown }).id === "string" ? (body as { id: string }).id : "";
  if (!id) return NextResponse.json({ error: "invalid challenge id" }, { status: 400 });

  try {
    await deleteChallenge(id);
  } catch (err) {
    return errorResponse(err);
  }

  await writeAudit(gate.login, "classic-delete", { challengeId: id });
  return NextResponse.json({ ok: true });
}
