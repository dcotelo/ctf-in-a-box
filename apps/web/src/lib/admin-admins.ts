import { upstashPipeline } from "@/lib/upstash";

/**
 * The READ half of runtime admin grants (issue #147), deliberately in its own
 * module.
 *
 * `admin-auth.ts` is on the authorization path for every gated route and Server
 * Component, so what it imports matters. Putting this in `admin-store.ts` made
 * it pull in the whole admin surface — and through it `modules.ts`, the module
 * registry, and `eventConfig.modules` — for a one-line SMEMBERS. That showed up
 * first as a test blowing up on an unrelated mock, which was the cheap warning;
 * the expensive version is an import cycle discovered later.
 *
 * The WRITE half stays in `admin-store.ts`, where the audit log and
 * `AdminValidationError` already live.
 */

/** Logins granted admin at RUNTIME, on top of the ones baked into the image
 *  from `event.yaml`. A Redis set, not a settings field: it is a collection
 *  with add/remove semantics, and membership is the whole value. */
export const ADMIN_ADMINS_KEY = "ctf:admin:admins";

/** A GitHub login: 1-39 chars, alphanumeric or single hyphens, not leading or
 *  trailing. Validated at the write boundary so the set cannot accumulate junk
 *  that no one can ever match against — an add is refused loudly rather than
 *  stored and silently ineffective. */
export const LOGIN_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/** Stored admins, lowercased. THROWS if Redis is unreachable — callers on the
 *  authorization path must let that propagate so the failure denies rather
 *  than resolving to an empty list, which would read as "not an admin" but
 *  for the wrong reason. `requireAdmin` catches it explicitly. */
export async function listStoredAdmins(): Promise<string[]> {
  const [res] = await upstashPipeline([["SMEMBERS", ADMIN_ADMINS_KEY]]);
  const arr = Array.isArray(res.result) ? (res.result as string[]) : [];
  return arr.map((a) => String(a).toLowerCase()).sort();
}
