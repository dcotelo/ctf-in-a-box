import "server-only";
import { countInvalidAdminLogins, parseAdminLogins } from "@/lib/admin-logins";

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
 *  comment.
 *
 *  When one or more entries didn't parse as a GitHub login (a typo'd email
 *  address, a stray colon), this logs ONE `console.warn` naming only the
 *  COUNT — never the raw entries, which might be something the organizer
 *  would not want echoed into a log. This module is called once, at
 *  `admin-auth.ts`'s module load, so the warning fires at most once per
 *  process rather than once per request. */
export function envAdmins(env: Record<string, string | undefined> = process.env): ReadonlySet<string> {
  const raw = env.ADMIN_LOGINS;
  const dropped = countInvalidAdminLogins(raw);
  if (dropped > 0) {
    console.warn(
      `[bootstrap-env] ADMIN_LOGINS dropped ${dropped} entr${dropped === 1 ? "y" : "ies"} that did not parse as a GitHub login`,
    );
  }
  return parseAdminLogins(raw);
}
