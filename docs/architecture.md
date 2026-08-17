---
title: Architecture
---

# Architecture

What runs where, how a score gets from a contestant's PR to the leaderboard,
how an organizer's `event.yaml` becomes the app's branding, and what the
security model actually rests on. For *why* these choices were made instead
of alternatives, see [docs/decisions.md](decisions.md). For the contract a
new CTF vertical must satisfy, see [docs/modules.md](modules.md). For
day-to-day operation, see
[README.md](https://github.com/dcotelo/ctf-in-a-box/blob/main/README.md).

## Platform and modules

CTF-in-a-box is a **control plane** with **modules** plugged into it. The split
is deliberate: the platform never knows what a challenge *is*, only how a score
arrives and how a leaderboard renders; a module never re-implements org
provisioning, teams, ingestion, or ranking. v1 ships one module,
`secure-development`; the boundary is the [module contract](modules.md).

| The platform (control plane) owns | A module provides |
|---|---|
| The disposable per-event GitHub **org** and its lifecycle (`setup/ctf-setup.sh`). | The **targets** it forks/provisions per event, and its teardown equivalents (contract §7). |
| **Auth** (GitHub OAuth sign-in) and the **admins** allowlist. | — (uses the platform's identity). |
| **Team** registration, roster, join codes, dedupe rollup (`apps/web`, `ctf:team:*`). | — (scores are per `author`; the platform maps authors to teams). |
| The **scoring pipeline**: the single audited writer `POST /score`, poll/push transports, the `github-actions[bot]` trust filter (`sync/`, `scorer/`). | Its **scoring workflow** and the score payloads it submits through that one writer (contract §2–3, §6). |
| **Leaderboard** ranking, points aggregation, the score-over-time series, and rendering (`scorer/src/serve.js`, `apps/web`). | Its **challenge catalogue** — stable target/challenge IDs with totals — plus display metadata and progress semantics (contract §4–5). |
| The **admin panel** runtime overrides (freeze, hints, registration) (`ctf:admin:settings`). | — (inherits the controls). |
| **Event config** schema, top-level (`event`, `github`, `teams`, `hints`, `admins`) baked into the app (build-time flow below). | Its `modules.<name>` config block and the loader/validator entry that recognizes it (contract §1). |

Everything below — the services, the score data flow, the security model — is
the platform. Where `secure-development` fills a module slot (its targets, its
`pull_request_target` scoring workflow, its catalogue), it is called out as the
worked example, exactly as the module contract does.

## System overview

Everything runs as one `docker-compose.yml` stack (see
[decisions.md #2](decisions.md#2-single-docker-compose-box-no-kubernetes-in-v1)).
Two independent things happen in parallel: contestants browsing the app, and
scores flowing in from GitHub.

```
                         contestant browser
                                 |
                                 | HTTPS
                                 v
                          +-------------+
                          |    caddy    |   reverse proxy; Caddyfile chosen
                          +------+------+   by SCORE_INGEST (poll|push)
                                 |
                 poll: only "/" |  push: "/" and "/score"
                                 v
                          +-------------+
                          |     app     |   Next.js contestant UI
                          |  apps/web/  |
                          +--+-------+--+
           UPSTASH_REDIS_REST_URL   LEADERBOARD_API_URL
                          |               |
                          v               v
                    +-----------+   +-----------+
                    |    srh    |<--|  scorer   |   private image; judges PRs;
                    | (Upstash- |   | (bearer-  |   GET /leaderboard, POST /score
                    |  REST     |   |  token    |
                    |  proxy;   |   |  authed)  |
                    |  POST-cmd |   +-----+-----+
                    |  subset)  |         ^
                    +-----+-----+         | POST /score (bearer token)
                          v               |
                    +-----------+    +----+-------------------+
                    |   redis   |    |                        |
                    +-----------+  push mode:              poll mode:
                                  scoring Action        sync polls the event
                                  POSTs to scorer        org's forked repos'
                                  via caddy /score        issue comments via
                                  (public URL needed)     a GitHub App token,
                                                           then POSTs to scorer
                                                           directly (no public
                                                           URL needed)
```

`app` reaches `srh` directly (team/hint data plus the leaderboard read
adapter can go through it) and reaches `scorer` directly for
`LEADERBOARD_API_URL` reads (`docker-compose.yml`'s `app` service sets both
`UPSTASH_REDIS_REST_URL: http://srh:80` and `LEADERBOARD_API_URL:
http://scorer:4000`). `scorer` is the only writer to Redis-backed score
state; everything else that touches scores goes through it.

## Components

| Service | Source | Responsibility |
|---|---|---|
| `caddy` | `caddy:2-alpine` image; `caddy/Caddyfile.poll` or `caddy/Caddyfile.push` selected by `SCORE_INGEST` | Reverse proxy in front of `app`. Push mode adds a `/score` route to `scorer`; poll mode has no `/score` route at all — zero inbound scoring surface. |
| `app` | `apps/web/` (vendored Next.js app, built from local source via `apps/web/Dockerfile`) | Contestant-facing UI: GitHub sign-in, challenge browser, leaderboard, rules/FAQ/how-to-play pages. Event name/dates/targets are baked in at build time (see below). |
| `scorer` | `${SCORE_IMAGE:-ghcr.io/owasp-ctf/score:latest}` — private image, mirrored into the event org by `setup/ctf-setup.sh org`. The kit ships its own engine at `scorer/` to build this image from (see [docs/scorer.md](scorer.md)). | Judges submitted PRs against the private rubric; exposes `POST /score` (bearer-token authed write) and `GET /leaderboard`. The one score writer in the system. |
| `srh` | `hiett/serverless-redis-http` | Upstash-REST-compatible HTTP proxy in front of `redis`, so the app's `@upstash/redis` client works unchanged against local Redis. Implements only the POST-command-array subset of Upstash's REST API (no path-style `GET /get/<key>` shortcut — see `scripts/smoke.sh`). |
| `redis` | `redis:7-alpine`, `--appendonly yes` | Durable state: scores, team/hint data. Named volume `redis-data` survives box reboots. |
| `sync` | `sync/` (Node, `sync/src/*.js`) | Poll-mode only (`profiles: ["poll"]`). Polls the event org's forked target repos' issue comments with a GitHub App installation token, validates them, and forwards trusted score payloads to `scorer`. Also reads the organizer's pause flag and master-reset epoch every tick and writes a heartbeat (see "Organizer admin panel" below). |

## Data flow for a score

1. A contestant forks a target repo in the event org, patches a
   vulnerability, and opens a PR back to the org's copy.
2. A `pull_request_target` GitHub Action (rendered per target from the
   in-repo template `scorer/consumer-workflow.example.yml` by
   `setup/ctf-setup.sh org`, which commits it to each fork automatically, see
   [docs/modules.md §6.1](modules.md#6-security-requirements-non-negotiable))
   runs in the *base* repo's context — where org secrets live — and scores
   the patch using the private `scorer` image, while the contestant's PR
   code runs sandboxed with no access to those secrets.
3. The Action reports the result one of two ways, depending on
   `SCORE_INGEST`:
   - **push**: POSTs the score directly to `${scorerUrl}/score` (through
     `caddy`'s `/score` route) with a bearer token.
   - **poll** (default): posts a PR comment authored as
     `github-actions[bot]` containing a machine-readable marker,
     `<!-- ctf-score: {...} -->` (`sync/src/parse.js`'s `MARKER`).

   `score-action`'s `leaderboard-url`/`leaderboard-token` inputs, which
   push mode needs to know where and how to POST, are still an unlanded
   upstream change (README's [Status / upstream
   dependencies](https://github.com/dcotelo/ctf-in-a-box/blob/main/README.md#status--upstream-dependencies),
   item 2).
4. In poll mode, `sync`'s next tick (`sync/src/index.js`'s `tick()`) calls
   `fetchNewScoreComments` (`sync/src/github.js`), which fetches issue
   comments since the last cursor and **filters by comment author
   (`cfg.commentAuthor`, default `github-actions[bot]`) before anything else
   runs** — a forged comment from any other login is dropped at this step,
   never reaching JSON parsing.
5. `parseScoreComment` (`sync/src/parse.js`) extracts the JSON block and
   validates `author` against the GitHub-login grammar
   (`GITHUB_LOGIN`), `target` against the configured target list, and
   `solved` as a string array, before returning a payload.
6. `submitScore` (`sync/src/submit.js`) POSTs the validated payload to
   `POST /score` on `scorer` with a bearer token
   (`Authorization: Bearer ${cfg.scorerToken}`). A `2xx` is success; a
   `4xx` is treated as a permanent rejection (dropped, logged); anything
   else throws and the poller un-marks the comment as seen so it retries
   next tick.
7. `scorer` writes the score to Redis (via `srh`) as a monotonic,
   idempotent-on-replay update — the write model is described in
   [docs/decisions.md #5](decisions.md#5-single-score-writer-monotonic-writes-at-least-once-delivery).
8. `app` reads `GET ${LEADERBOARD_API_URL}/leaderboard` and renders the
   result on the contestant-facing leaderboard page.

## Organizer admin panel (runtime overrides)

`event.yaml`'s `admins` allowlist (checked case-insensitively against the
signed-in GitHub login, `apps/web/src/lib/admin-auth.ts`'s `requireAdmin`)
gates a small runtime-override layer that sits alongside the build-time
config above — this one *is* readable/writable while the stack is running,
without a rebuild:

- **`ctf:admin:settings`** (Redis hash, `apps/web/src/lib/admin-store.ts`) —
  `paused` (two-state: `"1"` or absent — absent means false), `hintsEnabled`
  and `hintCost` (three-state: `"1"`/`"0"`/absent — absent means "no
  override, use the build-time default"), plus `updatedBy`/`updatedAt` and
  `resetAt` (the master-reset epoch `sync` honours — see below). Every
  reader applies **override-else-default** precedence (`s.hintsEnabled ??
  HINTS_ENABLED`, `hint-store.ts`'s `resolveHintConfig`), never the reverse.
- **`ctf:admin:audit`** — a capped list (`AUDIT_CAP` = 500, `LPUSH`+`LTRIM`)
  of every settings change, written atomically with the change itself (one
  Lua script, so a change can never land without its audit line).
- **`ctf:sync:status`** (Redis hash, written by `sync/src/redis.js`'s
  `writeStatus()` every tick) — `lastPollAt`, `ingested`, `reposPolled`,
  `paused`, `lastError`. This is `sync`'s heartbeat; the admin dashboard's
  `GET /api/admin/status` reads it alongside `ctf:admin:settings` and a
  best-effort leaderboard-freshness read.

**Freeze = hold ingestion, not stop execution.** Setting `paused` does not
touch fork Actions or GitHub — PRs keep getting judged and commented on;
poll mode's cursor just holds in place. `sync/src/index.js`'s `tick()`
checks `redis.isPaused()` first; while paused it skips the whole
fetch/parse/submit loop (the per-repo cursor and ETag are untouched, so
nothing is lost, just deferred) and still writes a `paused: true`
heartbeat. Push mode's `scorer` checks the same key on every `POST /score`
and returns `503` while paused (`scorer/src/serve.js`), so a contestant's
Action gets a retryable failure instead of a silently dropped submission.
Both sides **fail open** on a Redis error — a Redis blip must never freeze
ingestion by accident (`sync/src/redis.js`'s `isPaused()` catches and
returns `false`; `scorer/src/store.js` does the same).

**Master reset + the reset epoch.** `resetEvent()` (`admin-store.ts`, behind
`POST /api/admin/reset`, `requireAdmin` + server-side type-to-confirm) wipes
all event data — `SCAN`+`DEL` of `ctf:solves:*`, `ctf:team:*`, `ctf:user:*`,
`ctf:joincode:*`, `ctf:hints:*` — keeps `ctf:admin:settings`, and appends a
reset audit line. On its own that isn't enough in **poll mode**: `sync` would
re-ingest the same PR comments within a cycle and undo the wipe. So the reset
also freezes scoring **and bumps a `resetAt` epoch field in the settings hash**.
`sync/src/index.js`'s `tick()` reads it (`redis.getResetAt()`) *before* the
pause check and, when it advances, drops its per-repo cursor/seen state — so the
wipe sticks even while frozen, and an unfreeze re-polls from scratch. This
`resetAt` signal is the app→sync coordination that lets a wipe cross the
container boundary without the app touching sync's state-file volume. A
post-event wipe also needs the source PR comments gone (there is no way to
un-post them from here). Every disruptive control prompts for confirmation
(type-to-confirm for the reset; one-click for the freeze/registration toggles).

**Demo seed (dev only).** `seedDemoData()` + `POST /api/admin/seed` populate a
demo leaderboard (bundled fixture of real challenge-ids so the scorer scores
them, timestamps spread for a rising graph, plus teams). The route and its
`/admin` button exist only when the app runs with `DEMO_MODE=1`
(`scripts/dev-stack` sets it) — a real event build has neither, so a live
leaderboard can't be polluted by accident.

**Known limitation: the hint toggle is only live at the reveal boundary.**
`resolveHintConfig()` (and therefore `revealHint`, which the `/api/hints`
reveal route calls) resolves the admin override live, so flipping
`hintsEnabled` mid-event immediately changes whether a hint **can be
bought**. But `getViewerHints`, `getHintPenalties`, and
`getHintAvailability` — which drive the challenges-page hint button, the
hint-notice banner, and the read-time leaderboard penalty — all gate on
the module-level `HINTS_ENABLED` constant, resolved once from the
build-time env var, not the live override. An organizer toggling hints
mid-event changes purchasability instantly; the UI's offer and the
leaderboard's penalty display still reflect whatever `HINTS_ENABLED` was
baked in at build time. This is a deliberate v1 cut, not an oversight —
see [docs/decisions.md #19](decisions.md#19-organizer-admin-panel-runtime-override-layer).

## Build-time config flow

Event identity (name, dates, URL, enabled targets, admins) is not runtime
config — it's baked into the `app` image at build time:

1. The organizer edits `event.yaml` (see `event.yaml.example`).
2. `EVENT_CONFIG_B64=$(base64 < event.yaml | tr -d '\n')` is passed as the
   `EVENT_CONFIG_B64` build arg to `docker compose --profile app build app`
   (`docker-compose.yml`'s `app.build.args`).
3. `apps/web/Dockerfile` decodes it: `echo "$EVENT_CONFIG_B64" | base64 -d
   > /app/event.yaml`, and sets `EVENT_CONFIG=/app/event.yaml` for the
   build step. An empty/unset build arg skips this — no `event.yaml` is
   written, and the generator falls through to its next input.
4. `pnpm build`'s `prebuild` hook runs
   `apps/web/scripts/generate-event-config.mjs` (also wired to `predev` and
   `pretest`), which resolves config with priority **`EVENT_CONFIG` yaml
   file > `EVENT_*` env vars > neutral defaults** — the same targets
   enum and unknown-module/unknown-target rejection rules as `sync/src/config.js`
   (see
   [decisions.md #13](decisions.md#13-closed-appid-union-config-selects-a-subset-unknown-values-fail-the-build)).
   It writes `apps/web/src/lib/event-config.generated.ts` (gitignored — a
   typed `const` module) and fails the build loudly (non-zero exit) on
   invalid input.
5. `src/lib/event-config.ts`, `src/lib/modules.ts`, `src/lib/apps.ts`, and
   `src/lib/site.ts` import the generated module and derive `eventConfig`,
   `enabledModules`, `enabledApps`, and the site-wide `event` object from
   it.
6. `next build` statically renders pages against those values — event name,
   dates, and the enabled-target subset are compiled into the served HTML,
   not read at request time.

Changing `event.yaml` after the stack is already running requires an
explicit rebuild of the `app` image (`docker compose --profile app build
app`) — `docker compose up` alone won't pick up the edit, since Compose
only rebuilds an image when told to (README, "Rebuilding the app after a
config change").

## Security model

- **Trust filter before parse.** `sync/src/github.js` filters comments by
  `cfg.commentAuthor` *before* `sync/src/parse.js` ever runs `JSON.parse`
  on the comment body. A forged comment authored by anyone else is
  discarded at the filter step regardless of what JSON it carries —
  `scripts/smoke.sh` asserts this directly (a `mallory`-authored comment
  with a valid `ctf-score` block never reaches the leaderboard).
- **Author grammar as a datastore-key guard.** `parse.js`'s `GITHUB_LOGIN`
  regex (`/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}(?:\[bot\])?$/`)
  validates `author` before it's ever sent to `scorer`, because it becomes
  a Redis key segment there — the same grammar the scorer enforces on its
  own side.
- **Oracle discipline.** Contestant-visible output (PR comment, push/poll
  payload) is pass/fail plus points only — never failing-test names,
  assertion messages, or exploit payloads (`docs/modules.md §6.2`).
  Verbose diagnostics stay in the private workflow log.
- **Poll mode = zero inbound network surface.** `caddy/Caddyfile.poll` has
  no `/score` route at all; nothing needs to reach the box from the
  internet. `caddy/Caddyfile.push` is the only Caddyfile that exposes
  `/score` externally, and only when the organizer opts into push mode.
- **Private scorer image, per-event mirror.** The scorer image stays
  private (it bakes in the rubric). `setup/ctf-setup.sh org` mirrors
  whatever `SCORE_IMAGE` names — no default: the expected path is the
  self-contained one, the in-repo engine `scorer/` plus your own private
  rubric (see [docs/scorer.md](scorer.md)); the upstream
  `ghcr.io/owasp-ctf/score:latest` works too but is private with no formal
  access process yet (ask the OWASP-CTF maintainers) —
  into the event org's own GHCR (`ghcr.io/$org/score:latest`) so forked
  repos' Actions can pull it with their own `GITHUB_TOKEN`. Access control, not obfuscation, is the
  actual defense — reverse-engineering the rubric out of the image is
  assumed possible; the goal is to limit who can pull it, not to make it
  unreadable.
- **Monotonic, idempotent-on-replay writes.** `scorer`'s `POST /score` is
  the single write path (`sync/src/submit.js` and push-mode Actions both
  land on it — there is no second writer). Delivery is at-least-once: on a
  submit failure, `sync`'s `tick()` un-marks the comment as seen and
  retries it next tick (`rs.seen = rs.seen.filter((id) => id !== c.id);`).
  A replayed already-applied score is expected to be a no-op on the scorer
  side, not a double-count. The real (private) `scorer` image doesn't
  accept bearer-token auth on `POST /score` yet — that's an unlanded
  upstream change (see README's [Status / upstream
  dependencies](https://github.com/dcotelo/ctf-in-a-box/blob/main/README.md#status--upstream-dependencies),
  item 1); the
  offline mock scorer in `scripts/smoke.sh` is today's end-to-end proof of
  this write path, not a live scorer.
- **Per-event disposable orgs.** Each event gets its own GitHub org
  (`setup/ctf-setup.sh org` forks targets into it; `teardown` archives them
  afterward). Contestant PR code runs via `pull_request_target` in the
  base repo's Action context, so the untrusted PR code itself never sees
  the org's secrets or the GitHub App key.

## Testing strategy

| Layer | Where | What it proves |
|---|---|---|
| Unit (sync) | `sync/test/*.test.js`, run via `npm test` (Node's built-in test runner) | Config loading/validation, comment parsing and the author grammar, cursor/ETag handling, submit retry semantics, state persistence — in isolation, no network or Docker. |
| Unit (scorer) | `scorer/test/*.test.js`, run via `npm test` (Node's built-in test runner) | Rubric loading/validation, probe grammar + evaluation, the judge's report format (the score-action regexes and the sync marker, pinned verbatim), serve auth/validation/monotonic-replay semantics, leaderboard aggregation, and both solve stores (memory, and Redis-via-SRH against a mocked endpoint) — in isolation, no network or Docker. |
| Unit (app) | `apps/web/src/lib/__tests__/*`, `apps/web/scripts/__tests__/generate-event-config.test.ts`, run via `vitest run` | Event-config generation (yaml/env/defaults precedence, unknown-module/target rejection, timezone-independent date formatting), module/app enablement filtering, site config derivation. |
| Shell (bats) | `setup/test/ctf_setup.bats` | `ctf-setup.sh`'s subcommands against fixture `event.yaml` files: dry-run fork/workflow/mirror/teardown plans, secrets generation, and YAML-parsing edge cases (flow-style config, blank entries, decoy keys) — no real `gh`/`docker` calls needed. |
| Offline smoke | `scripts/smoke.sh` | The full poll pipeline against fixture services (`test/fixtures/mock-github.mjs`, `test/fixtures/mock-scorer.mjs`, `docker-compose.smoke.yml`): Redis and the `srh` REST proxy work, `sync` ingests fixture score comments, scores match the fixtures, a forged comment is dropped by the trust filter, an unauthenticated `POST /score` is rejected, and — the organizer admin panel's freeze proof — setting `ctf:admin:settings paused` directly on Redis (the same key the app's settings route writes) holds a queued fixture score out of the leaderboard and out of `ctf:sync:status`, then clearing it lets the poller ingest it on the next tick. This is what CI's `smoke` job runs, and needs no live GitHub org, Action runs, or scorer image access. |
| Docker acceptance | `scripts/acceptance-app.sh` | Builds the real `apps/web/Dockerfile` twice — once with an `EVENT_CONFIG_B64` override, once without — and asserts: the custom event name and only the configured targets render, a disabled target never renders, and the default (no-config) build is neutral (no DC34 branding, name "OWASP CTF"). This is the layer that proves the build-time config flow actually reaches rendered HTML, not just the generated TS module. |
| Docker acceptance (scorer) | `scripts/acceptance-scorer.sh` | Builds the scorer image from `scorer/` with the example rubric and closes the scoring loop offline: judge runs against a fake target that passes some probes and fails others, and the script asserts the report's score-action regexes, that no probe internals leak into the comment, that the sync marker parses via the real `sync/src/parse.js`, and that push mode lands on `GET /leaderboard` with rubric-derived points/totals (poll mode — no `SCORE_API` — is exercised too). |

CI (`.github/workflows/ci.yml`) carries five jobs — `sync-tests`, `shell`
(shellcheck + bats), `smoke`, `app` (vitest + `next build` +
`acceptance-app.sh`), and `scorer` (`node --test` + `acceptance-scorer.sh`). A
`changes` gate (native `git diff`, no third-party action) runs only the jobs
whose area a PR touches; a push to `main` runs all five. The heavier
`stock-scores-zero` / `patched-scores-right` workflows are scoped to
judge-relevant scorer inputs, so a leaderboard-only change doesn't spin up the
per-target Maven/gradle builds.

## Names

Five spellings of "the project" are in play; they are not interchangeable:

| Name | What it is |
|---|---|
| **CTF-in-a-box** | The product / brand (README, `dcotelo.github.io/ctf-in-a-box`). |
| `owasp-ctf` | The local repo directory and the lowercase image namespace. |
| `OWASP-CTF` | The GitHub **org** the targets are forked into (`github.org` default). |
| `ghcr.io/owasp-ctf/score` | The scorer image path. The lowercase `owasp-ctf` here is a registry-namespace convenience, not the `OWASP-CTF` org; override `SCORE_IMAGE` to your own org's GHCR. |
| `dc34-owasp-secure-development-ctf` | The upstream repo the rubrics are vendored from (see `scorer/rubric.owasp/PROVENANCE.md`). |
