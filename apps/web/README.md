# OWASP CTF

The contestant-facing web app for the OWASP Capture The Flag competition. Event name, dates, location, and theme are configured per-deployment via the kit's `event.yaml` (see below) rather than hardcoded here.

Contestants patch real vulnerabilities in six deliberately-insecure OWASP training apps and submit the fix as a GitHub pull request. A CI scorer validates each patch and pushes results to the leaderboard — no manual grading. (That is the `secure-development` module; the classic module scores flag submissions instead.)

## Status

Pre-event, backend wired up. Core site, GitHub sign-in, leaderboard, profile, and teams are built. Production reads live scoring data from the Lambda (`LEADERBOARD_SOURCE=lambda`) and team membership persists to Upstash Redis when `TEAM_WRITES_ENABLED=true`; without those env vars everything falls back to mock data so the site stays fully demoable with zero backend.

## Features

- **GitHub sign-in** ([better-auth](https://www.better-auth.com/)) — contestants authenticate with the same GitHub account they open pull requests from.
- **Leaderboard** (`/leaderboard`) — public standings; sign in to highlight your own row. Backed by a swappable data-source adapter (see below).
- **Profile** (`/profile`) — gated per-app progress across all six target apps.
- **Teams** — join, create, or leave a team of up to **4 players**. Writes go to Upstash Redis and are entirely server-side (see below); without `TEAM_WRITES_ENABLED` they fall back to a per-browser cookie mock (flagged with a "mock mode" badge).
- **Paid hints** (`/challenges`) — signed-in contestants can reveal a hint for any challenge at a fixed cost (**−10 points** by default, set per-event from the admin panel), deducted from their leaderboard score (see below). Signed-out visitors see a locked teaser. Hints are **on by default**; the switch that works on the composed stack is `/admin`'s hint controls, since `docker-compose.yml` does not forward `HINTS_ENABLED` to the `app` container.
- **Six real targets** — Juice Shop, DVWA, WebGoat, Security Shepherd, VulnerableApp, and VAmPI, covering the OWASP Web and API Top 10.

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) 16 (App Router, TypeScript)
- **Auth**: [better-auth](https://www.better-auth.com/) (stateless/cookie sessions, GitHub OAuth)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) 4 — see `DESIGN_SYSTEM.md` for tokens and component patterns
- **Fonts**: Poppins (headings) + Barlow (body) per [OWASP brand guidelines](https://policy.owasp.org/operational/branding)
- **Package manager**: [pnpm](https://pnpm.io/)
- **Hosting**: self-hosted Docker, built and run by the kit — see the kit's
  [hosting Quickstart](../../docs/hosting.md#quickstart-zero-to-a-scored-event) and
  [Rebuilding the app after a config change](../../docs/hosting.md#rebuilding-the-app-after-a-config-change)
  for how `event.yaml` is baked into the image via `EVENT_CONFIG_B64`

## Getting Started

This app is normally built and run as part of the kit (see the links above);
the commands below are for iterating on the app itself.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to view the site.

### Environment variables

Copy `.env.example` to `.env.local` and fill in real values — none of these should ever be committed.

| Variable | Required | Purpose |
|---|---|---|
| `BETTER_AUTH_SECRET` | Yes | Session cookie signing/encryption key (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | Yes | Base URL of the app (e.g. `http://localhost:3000`) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth app credentials — create one under the org's GitHub settings with callback `<BETTER_AUTH_URL>/api/auth/callback/github` |
| `LEADERBOARD_SOURCE` | No | `mock` (default) \| `lambda` \| `upstash` — selects the leaderboard data adapter |
| `LEADERBOARD_API_URL` | Only if `LEADERBOARD_SOURCE=lambda` | Base URL of the scoring API — serves `/leaderboard` (used by the lambda source) and `/challenges` (live challenge catalogue on the challenges page; without it the page shows static fallback cards) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Only if `LEADERBOARD_SOURCE=upstash`, `TEAM_WRITES_ENABLED=true`, `HINTS_ENABLED=true`, or `CHALLENGES_GATE_ENABLED=true` | Upstash Redis REST credentials (leaderboard reads work with a read-only token; team writes, hint purchases, and the gate throttle need a **read/write** token) |
| `TEAM_WRITES_ENABLED` | No | `true` persists team join/create/leave to Upstash Redis; unset uses the per-browser cookie mock |
| `HINTS_ENABLED` | No | Paid hints on `/challenges` are **on** unless this is set to `false` (needs the Upstash vars). Note `docker-compose.yml` does not pass this through to the `app` service, so it has no effect on the composed stack — use `/admin`'s hint controls there |
| `CHALLENGES_GATE_ENABLED` | No | `true` locks every enabled module's page (`/challenges`, `/quiz`, `/flags`) behind the pre-event password gate — the proxy covers pages, and the module APIs that bank points run their own check; see [Pre-event challenges gate](#pre-event-challenges-gate) |
| `CHALLENGES_GATE_PASSWORD` | Only if `CHALLENGES_GATE_ENABLED=true` | The shared access password. Server-side only; the gate stays open if this is unset |

> Env var changes only take effect on the **next build/restart** of the container — rebuild the image (see [Rebuilding the app after a config change](../../docs/hosting.md#rebuilding-the-app-after-a-config-change)) or restart the `app` service after adding or changing one.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start development server |
| `pnpm build` | Production build |
| `pnpm start` | Serve production build |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run the vitest suite (team + hint store unit tests; the live-Upstash integration suite auto-skips without `UPSTASH_REDIS_REST_*` credentials) |

## Project Structure

```
src/
  app/
    page.tsx                 # Homepage: hero, countdown, "what to expect", targets
    layout.tsx                # Root layout, fonts, metadata
    (site)/
      how-to-play/            # Contestant workflow guide
      challenges/              # Target app browser
      rules/                   # Competition rules
      leaderboard/              # Public standings
      profile/                  # Gated per-contestant dossier
      faq/                      # FAQ
    api/
      auth/[...all]/            # better-auth route handler
      team/                     # Join/create/leave team routes
      hints/                    # Viewer hint state + paid reveal routes
  components/                 # Site header/footer, leaderboard, team card,
                               # event countdown, challenge lists, etc.
  lib/
    auth.ts / auth-client.ts  # better-auth server + client config
    apps.ts                   # Metadata for the six target apps (static fallback counts)
    challenges.ts              # Live challenge catalogue from the scoring API
    site.ts                   # Event dates, nav links
    leaderboard/               # Data-source adapters (mock/lambda/upstash) + types
    upstash.ts                 # Shared Upstash Redis REST client (pipeline + EVAL)
    team-store.ts              # Team reads/writes (Lua scripts, cookie mock)
    hint-store.ts              # Paid hint purchases + penalty reads
    gate-store.ts              # Challenges-gate brute-force throttle (atomic Lua EVAL)
    stats-store.ts             # Aggregate per-country reach counter
    __tests__/                 # vitest: team + hint rules (unit + live integration)
public/
  owasp-logo.png              # OWASP logo (rendered inverted on dark backgrounds)
```

## Authentication surface

Sign-in is GitHub OAuth through better-auth, with **no `database`** configured: sessions live entirely in a JWE-encrypted cookie, and that cookie is therefore the identity. There is no server-side session store to check it against.

That matters because better-auth mounts its **entire default endpoint set** behind the catch-all at `src/app/api/auth/[...all]`, whether or not the app uses any of it. This app calls exactly four: `/sign-in/social`, `/callback/:id`, `/get-session`, `/sign-out`. Everything else is closed with `disabledPaths` in `src/lib/auth.ts`.

The one that mattered was `POST /update-user`. It takes an arbitrary JSON body behind nothing but `sessionMiddleware`, runs it through `parseUserInput` — which accepts any additional field not marked `input: false`, i.e. `login` — and with no database falls through to a `?? { ...session.user, ...additionalFields }` fallback that re-signs the session cookie. Any signed-in contestant could `POST {"login":"someone-else"}` and thereafter be treated as that person by all six handlers that key writes off `session.user.login`: hint purchases would bill their points, team joins and leaves would move them around.

Three things to know before touching that config:

- **Do not "harden" `login` to `input: false`.** better-auth's `parseAdditionalUserInputFromProviderProfile` skips `input: false` fields when mapping the OAuth profile, which leaves `session.user.login` undefined and breaks the `/profile` gate. The protection comes from the path being closed, not from the flag.
- **`disabledPaths` matches literal pathnames**, not route patterns. `/reset-password/:token` can never be closed this way; a real request arrives as `/reset-password/abc123`. Listing the pattern would look like protection and be none.
- **It guards HTTP only.** A server-side `auth.api.updateUser()` call bypasses it. No app code makes one; that is an invariant, not something the setting enforces.

`src/lib/__tests__/auth.test.ts` fails if a better-auth upgrade or a new plugin introduces a default endpoint that is neither in use nor closed, which is the failure a hand-maintained list cannot catch on its own.

## Leaderboard Data Sources

`LEADERBOARD_SOURCE` swaps the backend without touching any UI code:

- **`mock`** (default) — local fixture shaped like the target production API. Used everywhere until the real backend is ready.
- **`lambda`** — reads the deployed scoring Lambda's `/leaderboard` endpoint (per-app solved/total; unsolved challenges count as *remaining*, not *failed*).
- **`upstash`** — reads directly from Upstash Redis via its REST API.

A fourth mode, **`empty`**, is never configured: an event with `secure-development` disabled has no scorer to read, so `getLeaderboardSourceMode` (`src/lib/leaderboard/source.ts`) forces it regardless of what `LEADERBOARD_SOURCE` says, and the board is built entirely from the module overlays on top of it. On a quiz-only or classic-only event it is the only mode that runs.

## Teams

Team membership lives in Upstash Redis when `TEAM_WRITES_ENABLED=true`. All writes are server-side only: the `/api/team*` route handlers derive the player's GitHub login from the better-auth session, and the only client input (team name/slug) is slugified and length-capped before touching Redis — nothing client-side can forge identity or bypass the rules.

Rules, enforced atomically (each mutation is a single Lua `EVAL`, so they can't be raced):

- **Max 4 players per team** — the fifth join is rejected with "team is full".
- **One team per player** — joining or creating while already on a team is rejected until you leave.
- Duplicate team slugs are rejected; joining a nonexistent team is rejected; a team's keys are deleted when its last member leaves.

Schema:

```
HSET ctf:team:<slug> name <name> captain <login> createdAt <iso> joinCode <code>
SADD ctf:team:<slug>:members <login>     # capped at 4
HSET ctf:user:<login> team <slug>
SET ctf:joincode:<code> <slug>           # reverse index for join-by-code
```

These rules are covered by `pnpm test` — unit tests with Upstash mocked, plus an integration suite that runs the real Lua scripts against live Upstash using throwaway keys.

## Hints

Hint text lives in the scorer-owned Upstash hashes `hints:<app>` (field = challenge catalogue id, value = hint text). When `HINTS_ENABLED=true` (and the `UPSTASH_REDIS_REST_*` vars are set), each challenge row on `/challenges` with a hint gets a reveal control: signed-out visitors see a locked teaser, signed-in contestants confirm and pay the configured hint cost (`hintCost` in the admin settings, **10 points** if unset). Re-viewing a bought hint is always free — charging is idempotent inside a single Lua `EVAL` (a double-click or race can't charge twice), and it's keyed by the server-derived session login, so nothing client-side can spend someone else's points.

Purchases are recorded under the site's `ctf:` namespace, which the scorer never rewrites — penalties survive re-scores:

```
SADD ctf:user:<login>:hints "<app>/<challengeId>"   # what the user bought
HINCRBY ctf:hints:spent <login> <cost>              # running penalty total
```

The scorer's `leaderboard` ZSET is never decremented. Instead, displayed scores subtract the penalty as an overlay (`withHintPenalties`, floored at 0) applied **before** `withTeamStandings`, so leaderboard rows, team totals, and the profile all show the same net numbers. Penalized rows carry a small "−N hints" marker for transparency.

## Pre-event challenges gate

Until the conference starts, each enabled module's own page — `/challenges`, `/quiz`, `/flags` — can be locked behind a shared password: set `CHALLENGES_GATE_ENABLED=true` and `CHALLENGES_GATE_PASSWORD` (both, plus the always-required `BETTER_AUTH_SECRET`, which signs the unlock cookie). A half-configured gate (flag without password) stays open rather than locking everyone out. Only those module pages are gated; the leaderboard, rules, and the rest of the site stay public, and the homepage keeps showing catalogue totals.

How it works: the proxy (`src/proxy.ts`) redirects visitors without a valid signed cookie to `/gate`, which POSTs the password to `/api/gate`. Verification is entirely server-side (constant-time compare; the password never reaches the client bundle), and success sets an HMAC-signed, httpOnly cookie good for 30 days. The gated set is derived from the module registry (`enabledModuleRoutes`), so a module is gated by being enabled rather than by being remembered.

**Scope, precisely:** enforcement is deliberately split in two. The proxy's block is exact-match and **pages only** — its matcher does not widen over `/api/*` on purpose, because that would put the gate in front of `/api/auth/*` and break the sign-in a contestant needs in order to pass the gate in the first place (and would answer API calls with a page redirect an API client can't act on). The module API routes that bank points or return challenge content — `POST /api/quiz/answer`, `POST /api/classic/submit`, `POST /api/hints/reveal` — therefore run **their own** server-side check instead: each calls `requireGatePassed()` (`src/lib/gate-request.ts`) after authentication and before any store call, and refuses with **403 `{ error: "gate" }`** while the lock screen is up.

Read the gate for what it is even so: a "the board opens at the keynote" curtain, **not** an authorization boundary. Every API route still enforces its own rules independently of it — a session is required, the admin pause and the scheduled scoring window are checked on every write, and attempt caps and cooldowns apply — and the schedule/pause pair remains the control that actually shuts scoring until a moment in time. See "Known limitations" in [docs/operations.md](../../docs/operations.md#known-limitations).

Brute-force throttle: five attempts from one IP, then that IP is locked for 24 hours (`gate:attempts:<ip>` in Upstash Redis). Locked attempts are rejected before the password is even compared, so the right password won't unlock a locked IP either. If Upstash is unreachable the gate fails closed.

The attempt is **charged before the password is compared**, as one atomic Lua `EVAL`. That ordering is the point: reading the counter, deciding, comparing, and only then writing would leave nothing serialising concurrent same-IP requests, so a burst of parallel POSTs would all see the same pre-burst counter and all reach the compare. The throttle bounded sequential guessing and nothing else. Two consequences of the fix worth knowing:

- **A successful attempt spends budget too**, and gets it back only when the post-success delete lands (retried once). If that delete fails, the caller still receives their 30-day unlock cookie and is through — but a *second* unlock from that IP may be refused until the window lapses.
- **Concurrent successful unlocks from one IP can contend.** Six people behind one NAT unlocking in the same instant can drive the counter to the cap before any of their refunds land, and the last of them sees a spurious 429. Retrying works, because the refunds delete the key.

Caveat that predates all of this: everyone behind one NAT (an office, a hotel, a conference) shares an IP, so five collective failures lock them all, and there is no self-service recovery. To clear one IP by hand, delete its key from Upstash (e.g. via the console, or `redis-cli DEL gate:attempts:203.0.113.9` against the underlying Redis).

The fastest fix during the event is not that command, though — it is turning the gate off (see Rollout below), which is the plan anyway once doors open.

Retention: each key holds a client IP, so it carries a 30-day `EXPIRE`, refreshed on every charged attempt. Unlike the DynamoDB TTL this design replaced, Redis expiry is exact rather than best-effort, so the retention promise on `/privacy` is literal.

## Reach counters

`stats:countries` is a Redis hash with one integer field per country (`HINCRBY stats:countries <iso2> 1`), incremented once per browser session via `POST /api/stats/visit`. The country comes from a geo header (`cf-ipcountry` or `x-geo-country`) and is validated as ISO-3166 alpha-2 before it is used as a hash field — the request body is ignored entirely. No login, IP, timestamp, or session id is stored alongside it, deliberately: `/privacy` makes a specific promise that this is a bare tally. Counts are approximate and unauthenticated — a measure of reach, not a headcount.

**Self-hosted note**: that header is only as trustworthy as whatever sits in front of the app. The kit's own Caddy config doesn't set, strip, or validate either header, so on a bare `docker compose` deployment a client can send one directly and the tally can be gamed — an accepted trade-off for an approximate, no-PII counter, not a security boundary. If you want the counter to reflect real geography instead, put a real edge/CDN in front (e.g. Cloudflare, which sets `cf-ipcountry` and strips client-supplied values) so the header can't be spoofed before it reaches the app.

Rollout: set the two gate env vars and rebuild/restart the `app` service (see [Rebuilding the app after a config change](../../docs/hosting.md#rebuilding-the-app-after-a-config-change)). At conference start, flip `CHALLENGES_GATE_ENABLED` to `false` (or remove it) and rebuild/restart — outstanding unlock cookies become inert. Rotating the password is the same edit + rebuild; cookies issued earlier stay valid because they are signed by `BETTER_AUTH_SECRET`, not the password.

## Branding

- **OWASP**: Logo and favicon sourced from the official mark at [owasp.org](https://owasp.org); typography follows the [OWASP Brand Guidelines 2024](https://policy.owasp.org/operational/branding)
- **Event theme**: Dark blue-gray palette (`#1a1a2e`), accent colors (red, yellow, blue, teal) — see `DESIGN_SYSTEM.md` for the full token set and rationale
