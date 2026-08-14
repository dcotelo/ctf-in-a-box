# Architecture

What runs where, how a score gets from a contestant's PR to the leaderboard,
how an organizer's `event.yaml` becomes the app's branding, and what the
security model actually rests on. For *why* these choices were made instead
of alternatives, see [docs/decisions.md](decisions.md). For the contract a
new CTF vertical must satisfy, see [docs/modules.md](modules.md). For
day-to-day operation, see [README.md](../README.md).

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
                                  (public URL needed)     GITHUB_PAT, then
                                                           POSTs to scorer
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
| `scorer` | `${SCORE_IMAGE:-ghcr.io/owasp-ctf/score:latest}` — private image, mirrored into the event org by `setup/ctf-setup.sh org` | Judges submitted PRs against the private rubric; exposes `POST /score` (bearer-token authed write) and `GET /leaderboard`. The one score writer in the system. |
| `srh` | `hiett/serverless-redis-http` | Upstash-REST-compatible HTTP proxy in front of `redis`, so the app's `@upstash/redis` client works unchanged against local Redis. Implements only the POST-command-array subset of Upstash's REST API (no path-style `GET /get/<key>` shortcut — see `scripts/smoke.sh`). |
| `redis` | `redis:7-alpine`, `--appendonly yes` | Durable state: scores, team/hint data. Named volume `redis-data` survives box reboots. |
| `sync` | `sync/` (Node, `sync/src/*.js`) | Poll-mode only (`profiles: ["poll"]`). Polls the event org's forked target repos' issue comments with the organizer's `GITHUB_PAT`, validates them, and forwards trusted score payloads to `scorer`. |

## Data flow for a score

1. A contestant forks a target repo in the event org, patches a
   vulnerability, and opens a PR back to the org's copy.
2. A `pull_request_target` GitHub Action (installed per target by
   `setup/ctf-setup.sh org`, see
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
- **Private scorer image, per-event mirror.** `ghcr.io/owasp-ctf/score`
  stays private; `setup/ctf-setup.sh org` mirrors it into the event org's
  own GHCR (`ghcr.io/$org/score:latest`) so forked repos' Actions can pull
  it with their own `GITHUB_TOKEN`. Access control, not obfuscation, is the
  actual defense — reverse-engineering the rubric out of the image is
  assumed possible; the goal is to limit who can pull it, not to make it
  unreadable.
- **Monotonic, idempotent-on-replay writes.** `scorer`'s `POST /score` is
  the single write path (`sync/src/submit.js` and push-mode Actions both
  land on it — there is no second writer). Delivery is at-least-once: on a
  submit failure, `sync`'s `tick()` un-marks the comment as seen and
  retries it next tick (`rs.seen = rs.seen.filter((id) => id !== c.id);`).
  A replayed already-applied score is expected to be a no-op on the scorer
  side, not a double-count.
- **Per-event disposable orgs.** Each event gets its own GitHub org
  (`setup/ctf-setup.sh org` forks targets into it; `teardown` archives them
  afterward). Contestant PR code runs via `pull_request_target` in the
  base repo's Action context, so the untrusted PR code itself never sees
  the org's secrets or the organizer's PAT.

## Testing strategy

| Layer | Where | What it proves |
|---|---|---|
| Unit (sync) | `sync/test/*.test.js`, run via `npm test` (Node's built-in test runner) | Config loading/validation, comment parsing and the author grammar, cursor/ETag handling, submit retry semantics, state persistence — in isolation, no network or Docker. |
| Unit (app) | `apps/web/src/lib/__tests__/*`, `apps/web/scripts/__tests__/generate-event-config.test.ts`, run via `vitest run` | Event-config generation (yaml/env/defaults precedence, unknown-module/target rejection, timezone-independent date formatting), module/app enablement filtering, site config derivation. |
| Shell (bats) | `setup/test/ctf_setup.bats` | `ctf-setup.sh`'s subcommands against fixture `event.yaml` files: dry-run fork/workflow/mirror/teardown plans, secrets generation, and YAML-parsing edge cases (flow-style config, blank entries, decoy keys) — no real `gh`/`docker` calls needed. |
| Offline smoke | `scripts/smoke.sh` | The full poll pipeline against fixture services (`test/fixtures/mock-github.mjs`, `test/fixtures/mock-scorer.mjs`, `docker-compose.smoke.yml`): Redis and the `srh` REST proxy work, `sync` ingests fixture score comments, scores match the fixtures, a forged comment is dropped by the trust filter, and an unauthenticated `POST /score` is rejected. This is what CI's `smoke` job runs, and needs no live GitHub org, Action runs, or scorer image access. |
| Docker acceptance | `scripts/acceptance-app.sh` | Builds the real `apps/web/Dockerfile` twice — once with an `EVENT_CONFIG_B64` override, once without — and asserts: the custom event name and only the configured targets render, a disabled target never renders, and the default (no-config) build is neutral (no DC34 branding, name "OWASP CTF"). This is the layer that proves the build-time config flow actually reaches rendered HTML, not just the generated TS module. |

CI (`.github/workflows/ci.yml`) runs all four non-unit-app-adjacent jobs —
`sync-tests`, `shell` (shellcheck + bats), `smoke`, and `app` (vitest +
`next build` + `acceptance-app.sh`) — on every PR and on push to `main`.
