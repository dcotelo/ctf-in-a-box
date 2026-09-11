// Parses the comma-separated admin-login list that config v2 reads straight
// from the environment (no more event.yaml `admins:` array). Pure and
// client-safe: no `server-only`, no `process.env` — callers own where the
// raw string comes from.

/**
 * The GitHub-login shape: 1-39 chars, alphanumeric or single hyphens, not
 * leading or trailing. A COPY of `LOGIN_RE` in `admin-admins.ts` — the same
 * rule the runtime-grant write path enforces — not an import of it: that
 * module imports `upstash.ts`, which is `server-only`, and this module must
 * stay client-safe. Keep the two definitions in sync if the shape ever
 * changes. */
const LOGIN_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

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
