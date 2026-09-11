import "server-only";
import { parseAdminLogins } from "@/lib/admin-logins";

/**
 * The two bootstrap identities config v2 reads straight from the process
 * environment rather than the (now-dead) `event.yaml` bake: the GitHub org
 * contestants fork under, and the admin allowlist. `server-only` because
 * `process.env` on the client bundle would be empty/misleading (same reason
 * `module-defaults.ts` gates `secureDevAvailable` on a caller-supplied env),
 * and because a client bundle must never see who the admins are.
 *
 * Both take an `env` param (default `process.env`) rather than reading
 * `process.env` directly in the body, so tests can pass a fixture without a
 * `vi.stubEnv` dance. Typed as `Record<string, string | undefined>`, not
 * Next's `ProcessEnv` — that type requires `NODE_ENV`, which a test fixture
 * has no reason to supply (PR 1a's lesson).
 */

/** The GitHub org contestants fork the target repos under. Trimmed; `""`
 *  when unset — callers decide what an empty org means for them (there is
 *  no baked default to fall back to any more). */
export function getGithubOrg(env: Record<string, string | undefined> = process.env): string {
  return (env.GITHUB_ORG ?? "").trim();
}

/** The admin allowlist, lowercased. Delegates all the parsing (trim, drop
 *  empties, lowercase, case-insensitive dedupe) to `parseAdminLogins` — see
 *  that module for why logins are lowercased. `ADMIN_LOGINS` unset or empty
 *  means the same thing: nobody. `admin-auth.ts` treats an empty result as
 *  FAIL CLOSED, not "no allowlist configured, allow everyone" — see its
 *  comment. */
export function envAdmins(env: Record<string, string | undefined> = process.env): ReadonlySet<string> {
  return parseAdminLogins(env.ADMIN_LOGINS);
}
