// Shared HTTP plumbing for the ai module's three routes.
//
// Not `server-only` and deliberately store-free: this is header and body
// handling, nothing more. Each route composes it with `ai-token.ts` and
// `ai-store.ts` itself, so the security decisions stay visible in the route
// rather than hiding behind a helper.
import { AI_EVENT_BODY_MAX } from "@/lib/ai-defaults";

/** CORS for the ai routes, and ONLY these routes.
 *
 *  `*` with NO `Allow-Credentials`. The two are mutually exclusive in every
 *  browser, and the omission is also the honest description of these
 *  endpoints: they read no cookie, so there is no credential to allow. A
 *  future edit that adds `Access-Control-Allow-Credentials` here would be
 *  claiming a capability the routes deliberately do not have. */
export const AI_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-CTF-Timestamp, X-CTF-Signature",
  "Access-Control-Max-Age": "86400",
};

/** A JSON response carrying the CORS headers. Every response from these
 *  routes goes through here — including refusals, because a 401 a browser
 *  cannot read is a 401 an integrator cannot debug. */
export function aiJson(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...AI_CORS_HEADERS, ...extra },
  });
}

/** The OPTIONS answer. 204 with no body — a preflight carries no payload. */
export function aiPreflight(methods: string): Response {
  return new Response(null, {
    status: 204,
    headers: { ...AI_CORS_HEADERS, "Access-Control-Allow-Methods": methods },
  });
}

export type RawBody =
  | { ok: true; raw: string; parsed: Record<string, unknown> }
  | { ok: false; error: "too-large" | "invalid-json" };

/** Reads the body ONCE, returning both the exact bytes and the parsed object.
 *
 *  The raw string is what the event route HMACs. It must be the bytes that
 *  arrived: re-serializing the parsed object changes whitespace and key order,
 *  so every signature an external system computed would fail while looking
 *  like a wrong key. That is the single most expensive mistake available on
 *  this path, which is why the raw form is returned rather than left to the
 *  caller to re-read (a `Request` body can only be consumed once).
 *
 *  The cap is measured in BYTES and checked BEFORE `JSON.parse`, so an
 *  oversized body is never parsed and never hashed. */
export async function readRawBody(request: Request): Promise<RawBody> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, error: "invalid-json" };
  }
  if (Buffer.byteLength(raw, "utf8") > AI_EVENT_BODY_MAX) return { ok: false, error: "too-large" };

  try {
    const parsed = JSON.parse(raw) as unknown;
    // A JSON body that is a string, a number, an array or null is not a
    // request this API has any shape for.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: "invalid-json" };
    }
    return { ok: true, raw, parsed: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: "invalid-json" };
  }
}
