// Parses the comma-separated admin-login list that config v2 reads straight
// from the environment (no more event.yaml `admins:` array). Pure and
// client-safe: no `server-only`, no `process.env` — callers own where the
// raw string comes from.

/**
 * The GitHub-login shape: 1-39 chars, alphanumeric or single hyphens, not
 * leading or trailing. Exported as the canonical, client-safe home for this
 * rule — `admin-admins.ts` (the runtime-grant write path) imports it from
 * here rather than keeping its own copy, since this module carries no
 * `server-only`/`upstash.ts` dependency for it to collide with. */
export const LOGIN_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/**
 * "  Alice, bob,,ALICE " -> {"alice","bob"}. Login joins are
 * case-insensitive everywhere in this repo (module-contributions,
 * team-standings, hint-penalties, admin-auth all lowercase both sides), so
 * this lowercases too rather than leaving that to each caller. Empty,
 * whitespace-only, and not-shaped-like-a-GitHub-login entries (an email
 * address, a stray colon, anything `LOGIN_RE` refuses) are all dropped —
 * they can never match a real session login, so keeping them around is only
 * a way to mistake "configured" for "correctly configured". `undefined`,
 * `""`, and an allowlist of nothing-but-junk all mean the same thing:
 * nobody — which is what makes `isAdminLogin`'s fail-closed empty-set check
 * (admin-auth.ts) fire for a typo'd `ADMIN_LOGINS` exactly as it does for an
 * unset one.
 */
export function parseAdminLogins(raw: string | undefined): ReadonlySet<string> {
  const logins = new Set<string>();
  if (!raw) return logins;
  for (const part of raw.split(",")) {
    const login = part.trim().toLowerCase();
    if (login && LOGIN_RE.test(login)) logins.add(login);
  }
  return logins;
}

/**
 * Count of non-empty, non-login-shaped entries in `raw` — a typo'd
 * `ADMIN_LOGINS=alice@example.com` counts as 1, but a blank entry from a
 * stray comma (`"alice,,bob"`) does not: that is formatting, not a mistake
 * worth a warning. Used only to report HOW MANY entries were dropped —
 * never the entries themselves, which may contain something an organizer
 * would not want echoed into a log (an email address, a pasted secret).
 */
export function countInvalidAdminLogins(raw: string | undefined): number {
  if (!raw) return 0;
  let dropped = 0;
  for (const part of raw.split(",")) {
    const login = part.trim();
    if (login && !LOGIN_RE.test(login)) dropped++;
  }
  return dropped;
}
