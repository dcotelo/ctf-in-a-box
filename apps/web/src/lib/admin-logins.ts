// Parses the comma-separated admin-login list that config v2 reads straight
// from the environment (no more event.yaml `admins:` array). Pure and
// client-safe: no `server-only`, no `process.env` — callers own where the
// raw string comes from.

/**
 * "  Alice, bob,,ALICE " -> {"alice","bob"}. Login joins are
 * case-insensitive everywhere in this repo (module-contributions,
 * team-standings, hint-penalties, admin-auth all lowercase both sides), so
 * this lowercases too rather than leaving that to each caller. Empty and
 * whitespace-only entries are dropped; `undefined`/`""` mean nobody.
 */
export function parseAdminLogins(raw: string | undefined): ReadonlySet<string> {
  const logins = new Set<string>();
  if (!raw) return logins;
  for (const part of raw.split(",")) {
    const login = part.trim().toLowerCase();
    if (login) logins.add(login);
  }
  return logins;
}
