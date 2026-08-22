// Shared `ctf:user:*` / `ctf:team:*` / `ctf:joincode:*` key builders.
// Dependency-free ON PURPOSE — no imports at all — exactly like
// classic-keys.ts and quiz-keys.ts, and for the same reason: modules that
// must not pull in `team-store.ts` (which carries `server-only` and the whole
// Lua write surface) still need to name the keys.
//
// These lived as module-private consts in team-store.ts, which is why every
// other reader open-coded the strings instead: admin-store.ts's reset prefixes,
// and profile/page.tsx, whose comment admits it —
//   "team-store.ts is owned by another task, so this reads the same
//    ctf:team:<slug> hash fields directly instead of extending its exports."
// Open-coded key strings are how two readers of the same data drift apart, so
// the names live here now and team-store re-exports them.

/** A contestant's own record. Field `team` holds their team slug, if any. */
export const userKey = (login: string) => `ctf:user:${login}`;

/** The team hash: `name`, `captain`, `createdAt`, `joinCode`. */
export const teamKey = (slug: string) => `ctf:team:${slug}`;

/** The team's member set (logins). */
export const membersKey = (slug: string) => `ctf:team:${slug}:members`;

/** Reverse index: join code -> team slug. Codes are stored lowercased. */
export const joinCodeKey = (code: string) => `ctf:joincode:${code}`;

/** A contestant's purchased hints — a SET of `"<app>/<challengeId>"`, not a
 *  hash. See hint-store.ts, which SADDs into it. */
export const userHintsKey = (login: string) => `ctf:user:${login}:hints`;

/** Hash of login -> points spent on hints, read by the leaderboard's
 *  per-team penalty fold. */
export const HINTS_SPENT_KEY = "ctf:hints:spent";
