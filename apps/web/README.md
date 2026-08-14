# OWASP CTF @ DEF CON 34

The contestant-facing web app for the OWASP Capture The Flag competition at DEF CON 34 (August 7–9, 2026, Las Vegas Convention Center). The DC34 theme is **Agency**.

Contestants patch real vulnerabilities in six deliberately-insecure OWASP training apps and submit the fix as a GitHub pull request. A CI scorer validates each patch and pushes results to the leaderboard — no flag submission, no manual grading.

## Status

Pre-event, backend wired up. Core site, GitHub sign-in, leaderboard, profile, and teams are built. Production reads live scoring data from the Lambda (`LEADERBOARD_SOURCE=lambda`) and team membership persists to Upstash Redis when `TEAM_WRITES_ENABLED=true`; without those env vars everything falls back to mock data so the site stays fully demoable with zero backend.

## Features

- **GitHub sign-in** ([better-auth](https://www.better-auth.com/)) — contestants authenticate with the same GitHub account they open pull requests from.
- **Leaderboard** (`/leaderboard`) — public standings; sign in to highlight your own row. Backed by a swappable data-source adapter (see below).
- **Profile** (`/profile`) — gated per-app progress across all six target apps.
- **Teams** — join, create, or leave a team of up to **4 players**. Writes go to Upstash Redis and are entirely server-side (see below); without `TEAM_WRITES_ENABLED` they fall back to a per-browser cookie mock (flagged with a "mock mode" badge).
- **Paid hints** (`/challenges`) — signed-in contestants can reveal a hint for any challenge at a flat **−10 points**, deducted from their leaderboard score (see below). Signed-out visitors see a locked teaser. Off until `HINTS_ENABLED=true` — flip it when the event starts.
- **Six real targets** — Juice Shop, DVWA, WebGoat, Security Shepherd, VulnerableApp, and VAmPI, covering the OWASP Web and API Top 10.

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) 16 (App Router, TypeScript)
- **Auth**: [better-auth](https://www.better-auth.com/) (stateless/cookie sessions, GitHub OAuth)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) 4 — see `DESIGN_SYSTEM.md` for tokens and component patterns
- **Fonts**: Poppins (headings) + Barlow (body) per [OWASP brand guidelines](https://policy.owasp.org/operational/branding)
- **Package manager**: [pnpm](https://pnpm.io/)
- **Hosting**: self-hosted Docker, built and run by the kit — see the kit's
  [`../../README.md` Quickstart](../../README.md#quickstart) and
  [Rebuilding the app after a config change](../../README.md#rebuilding-the-app-after-a-config-change)
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
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Only if `LEADERBOARD_SOURCE=upstash`, `TEAM_WRITES_ENABLED=true`, or `HINTS_ENABLED=true` (hints skip this requirement when `CTF_DATA_BACKEND=dynamo`) | Upstash Redis REST credentials (leaderboard reads work with a read-only token; team writes and hint purchases need a **read/write** token) |
| `TEAM_WRITES_ENABLED` | No | `true` persists team join/create/leave to Upstash Redis; unset uses the per-browser cookie mock |
| `HINTS_ENABLED` | No | `true` turns on paid hints on `/challenges` (needs the Upstash vars). Leave unset until the event so contestants can't buy hints early |
| `CTF_DATA_BACKEND` | No | Which store backs team + hint state: `dual` (default) writes Upstash as the source of truth and mirrors into DynamoDB, `upstash` disables the DynamoDB side, `dynamo` makes DynamoDB the only store — see [DynamoDB migration](#dynamodb-migration) |
| `CTF_AWS_REGION` / `AWS_ROLE_ARN` / `CTF_DYNAMO_TABLE` | No | DynamoDB overrides — working defaults are hardcoded in `src/lib/dynamo.ts`, normally leave unset. (`CTF_AWS_REGION` on purpose, not `AWS_REGION` — some hosts inject the latter with the function's own execution region, which can silently point requests at the wrong region) |
| `CHALLENGES_GATE_ENABLED` | No | `true` locks `/challenges` behind the pre-event password gate — see [Pre-event challenges gate](#pre-event-challenges-gate) |
| `CHALLENGES_GATE_PASSWORD` | Only if `CHALLENGES_GATE_ENABLED=true` | The shared access password. Server-side only; the gate stays open if this is unset |

> Env var changes only take effect on the **next build/restart** of the container — rebuild the image (see [Rebuilding the app after a config change](../../README.md#rebuilding-the-app-after-a-config-change)) or restart the `app` service after adding or changing one.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start development server |
| `pnpm build` | Production build |
| `pnpm start` | Serve production build |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run the vitest suite (team + hint store unit tests; the live-Upstash and live-DynamoDB integration suites auto-skip without `UPSTASH_REDIS_REST_*` credentials / `AWS_PROFILE`) |
| `pnpm backfill:dynamo` | Copy existing Upstash team/hint state into DynamoDB (dry run; add `--apply` to write) — run once before enabling the mirror in prod |

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
    team-store.ts              # Team reads/writes (backend dispatch, Lua scripts, cookie mock)
    hint-store.ts              # Paid hint purchases + penalty reads (backend dispatch)
    dynamo.ts                  # DynamoDB client/config + the CTF_DATA_BACKEND flag
    dynamo-shapes.ts           # pk/sk builders + item shapes for the shared table
    dynamo-team-store.ts       # Team rules as conditional DynamoDB transactions
    dynamo-hint-store.ts       # Hint charge-once + penalty reads on DynamoDB
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

## Teams

Team membership lives in Upstash Redis when `TEAM_WRITES_ENABLED=true`. All writes are server-side only: the `/api/team*` route handlers derive the player's GitHub login from the better-auth session, and the only client input (team name/slug) is slugified and length-capped before touching Redis — nothing client-side can forge identity or bypass the rules.

Rules, enforced atomically (each mutation is a single Lua `EVAL`, so they can't be raced):

- **Max 4 players per team** — the fifth join is rejected with "team is full".
- **One team per player** — joining or creating while already on a team is rejected until you leave.
- Duplicate team slugs are rejected; joining a nonexistent team is rejected; a team's keys are deleted when its last member leaves.

Schema:

```
HSET ctf:team:<slug> name <name> captain <login> createdAt <iso>
SADD ctf:team:<slug>:members <login>     # capped at 4
HSET ctf:user:<login> team <slug>
```

These rules are covered by `pnpm test` — unit tests with Upstash mocked, plus an integration suite that runs the real Lua scripts against live Upstash using throwaway keys.

## Hints

Hint text lives in the scorer-owned Upstash hashes `hints:<app>` (field = challenge catalogue id, value = hint text). When `HINTS_ENABLED=true` (and the `UPSTASH_REDIS_REST_*` vars are set), each challenge row on `/challenges` with a hint gets a reveal control: signed-out visitors see a locked teaser, signed-in contestants confirm and pay a flat **10 points** per hint. Re-viewing a bought hint is always free — charging is idempotent inside a single Lua `EVAL` (a double-click or race can't charge twice), and it's keyed by the server-derived session login, so nothing client-side can spend someone else's points.

Purchases are recorded under the site's `ctf:` namespace, which the scorer never rewrites — penalties survive re-scores:

```
SADD ctf:user:<login>:hints "<app>/<challengeId>"   # what the user bought
HINCRBY ctf:hints:spent <login> 10                  # running penalty total
```

The scorer's `leaderboard` ZSET is never decremented. Instead, displayed scores subtract the penalty as an overlay (`withHintPenalties`, floored at 0) applied **before** `withTeamStandings`, so leaderboard rows, team totals, and the profile all show the same net numbers. Penalized rows carry a small "−N hints" marker for transparency.

## Pre-event challenges gate

Until the conference starts, `/challenges` can be locked behind a shared password: set `CHALLENGES_GATE_ENABLED=true` and `CHALLENGES_GATE_PASSWORD` (both, plus the always-required `BETTER_AUTH_SECRET`, which signs the unlock cookie). A half-configured gate (flag without password) stays open rather than locking everyone out. Only the challenge board is gated; the leaderboard, rules, and the rest of the site stay public, and the homepage keeps showing catalogue totals.

How it works: the proxy (`src/proxy.ts`) redirects visitors without a valid signed cookie to `/gate`, which POSTs the password to `/api/gate`. Verification is entirely server-side (constant-time compare; the password never reaches the client bundle), and success sets an HMAC-signed, httpOnly cookie good for 30 days.

Brute-force throttle: five attempts from one IP, then that IP is locked for 24 hours (`pk=GATE` items in the DynamoDB table). Locked attempts are rejected before the password is even compared, so the right password won't unlock a locked IP either. If DynamoDB is unreachable the gate fails closed.

The attempt is **charged before the password is compared**, as one conditional write. That ordering is the point: reading the counter, deciding, comparing, and only then writing left four statements with nothing serialising concurrent same-IP requests, so a burst of parallel POSTs all saw the same pre-burst counter and all reached the compare. The throttle bounded sequential guessing and nothing else. Two consequences of the fix worth knowing:

- **A successful attempt spends budget too**, and gets it back only when the post-success delete lands (retried once). If that delete fails, the caller still receives their 30-day unlock cookie and is through — but a *second* unlock from that IP may be refused until the window lapses.
- **Concurrent successful unlocks from one IP can contend.** Six people behind one NAT unlocking in the same instant can drive the counter to the cap before any of their refunds land, and the last of them sees a spurious 429. Retrying works, because the refunds delete the item.

Caveat that predates all of this: everyone behind one NAT (an office, a hotel, a conference) shares an IP, so five collective failures lock them all, and there is no self-service recovery. To clear one IP by hand:

```bash
aws dynamodb delete-item --table-name ctf-leaderboard --region us-west-2 \
  --key '{"pk":{"S":"GATE"},"sk":{"S":"IP#203.0.113.9"}}'
```

The fastest fix during the event is not that command, though — it is turning the gate off (see Rollout below), which is the plan anyway once doors open.

Retention: those items hold a client IP, so each one carries a `ttl` attribute set 30 days out (epoch **seconds**). The 24h lock window is still enforced on read — DynamoDB only reaps expired items on a best-effort basis, typically within 48h, which is far too loose to enforce a lock. The TTL is purely a retention bound; the throttle is correct whether or not the reaper has run.

> **The `ttl` attribute does nothing unless TTL is enabled on the table.** This is table-level config, not something the app can assert. Enable it once (it is codified in the `dc34` repo's Terraform — prefer changing it there; the CLI form is shown for verification):
>
> ```bash
> aws dynamodb describe-time-to-live --table-name ctf-leaderboard --region us-west-2
> # if Status is DISABLED:
> aws dynamodb update-time-to-live --table-name ctf-leaderboard --region us-west-2 \
>   --time-to-live-specification 'Enabled=true,AttributeName=ttl'
> ```
>
> If it stays disabled the items simply persist, which is the behaviour we had before — no breakage, but the retention promise on `/privacy` would not be met.

## Reach counters

`pk=STATS` / `sk=COUNTRY#<iso2>` holds one integer per country, incremented once per browser session via `POST /api/stats/visit`. The country comes from an edge/reverse-proxy-supplied geo header (`cf-ipcountry` or `x-geo-country`) and is validated as ISO-3166 alpha-2 before it is used in a sort key — the request body is ignored entirely. No login, IP, timestamp, or session id is stored alongside it, deliberately: `/privacy` makes a specific promise that this item is a bare tally. Counts are approximate and unauthenticated — a measure of reach, not a headcount.

**Self-hosted note**: a bare `docker compose` deployment with no CDN or reverse proxy setting one of those headers in front of it will never populate this counter — it's inert by default, not broken. If you want it live, put something in front (e.g. Cloudflare, which sets `cf-ipcountry`) that supplies a country header before the request reaches the app.

Rollout: set the two gate env vars and rebuild/restart the `app` service (see [Rebuilding the app after a config change](../../README.md#rebuilding-the-app-after-a-config-change)). At conference start, flip `CHALLENGES_GATE_ENABLED` to `false` (or remove it) and rebuild/restart — outstanding unlock cookies become inert. Rotating the password is the same edit + rebuild; cookies issued earlier stay valid because they are signed by `BETTER_AUTH_SECRET`, not the password.

## DynamoDB migration

Team and hint state is migrating from Upstash to the `ctf-leaderboard` DynamoDB table (the same table the dc34 scorer dual-writes solves into). `CTF_DATA_BACKEND` controls the cutover — the four write routes and all consumers are unchanged; only the store layer dispatches:

| Value | Writes | Reads |
|---|---|---|
| `dual` (default, incl. unset) | Upstash Lua is the source of truth; every success also runs the equivalent conditional DynamoDB mutation as an awaited best-effort mirror that never throws | Upstash |
| `upstash` | Upstash only — zero AWS calls | Upstash |
| `dynamo` | DynamoDB only, with the same rules enforced as conditional transactions (`TransactWriteItems`) | DynamoDB — including hint text and availability from `pk=HINTS`, so hints need no `UPSTASH_REDIS_REST_*` vars in this mode (keep the backfill fresh: re-run it after any scorer hint re-seeding) |

In `dual` mode every mirror outcome is logged as `[dynamo-mirror] …` — a `verdict mismatch` line means the two stores disagree. Soak in `dual`, grep those logs clean, then flip to `dynamo`.

Item shapes in the shared table (scorer partitions `LEADERBOARD` / `AUTHOR#<login>` are never touched):

```
pk=TEAMS          sk=TEAM#<slug>        name, captain, createdAt, members (string set, never empty)
pk=USER#<login>   sk=PROFILE            team (absent = no team)
pk=USER#<login>   sk=HINT#<app>#<id>    one item per hint purchase (the charge-once guard)
pk=HINTSPEND      sk=AUTHOR#<login>     spent — one Query serves the whole leaderboard
pk=HINTS          sk=HINT#<app>#<id>    hint text, copied from the scorer-seeded hints:<app>
                                        hashes by the backfill (read in dynamo mode)
```

**Credentials.** There are no stored keys in the app: credentials come entirely from the AWS SDK's default credential chain — environment variables, a shared config/credentials file, `AWS_PROFILE` / `aws sso login`, or (when the container runs on AWS compute) an ambient instance/task role. Configure whichever fits your deployment; locally that usually looks like:

```
aws sso login --profile AWSAdministratorAccess-942548380662
AWS_PROFILE=AWSAdministratorAccess-942548380662 pnpm dev
```

**Backfill.** Before enabling the mirror in an environment with existing Upstash data, copy it over once so mirrored joins find their team items: `pnpm backfill:dynamo` (dry run), then `pnpm backfill:dynamo --apply`. Idempotent and read-only against Upstash. It also copies the scorer-seeded `hints:<app>` text hashes into `pk=HINTS`, which `dynamo` mode serves hint text and availability from; Upstash remains the authority for hint text, so re-run the backfill after any hint re-seeding (in `dynamo` mode a stale `pk=HINTS` means new hints simply don't show).

## Branding

- **OWASP**: Logo and favicon sourced from the official mark at [owasp.org](https://owasp.org); typography follows the [OWASP Brand Guidelines 2024](https://policy.owasp.org/operational/branding)
- **DEF CON 34**: Dark blue-gray palette (`#1a1a2e`), accent colors (red, yellow, blue, teal) inspired by the [DC34 theme page](https://defcon.org/html/defcon-34/dc-34-theme.html)
