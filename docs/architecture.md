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
provisioning, teams, ingestion, or ranking. `event.yaml`'s `modules:` map
accepts more than one registered module id — `secure-development` (targets,
GitHub-mediated scoring, the worked example throughout this doc) and `quiz`
(a self-paced single/multi-select question bank, scored entirely inside the
app — see [Quiz data flow](#quiz-data-flow) below and
[docs/modules.md §5](modules.md#5-ui--presentation-contract) for what its UI
contract still leaves open). An id outside
the registry still fails the build loudly; the boundary is the
[module contract](modules.md).

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
   upstream change ([Status and upstream
   dependencies](operations.md#status-and-upstream-dependencies), item 2).
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
   result on the contestant-facing leaderboard page. Alongside the ranked
   `leaderboard`/`teams` standings, the payload carries a top-level `catalog`
   (per target, each challenge's `id`/`name`/`points`/`owasp`, derived from
   the rubric — `owasp` is carried only by exec-grammar catalogues, `null`
   for declarative YAML targets) and a `solvedIds` array on every entry's and team's
   `apps.<target>`. The app joins the two to show *which* flags are solved —
   the collapsible per-target list under a contestant's breakdown, and a
   team's per-target flags (solved by its members' union, plus the ones still
   open). Both fields are
   additive; an older scorer that omits them simply falls back to the
   solved/total counts.
9. Before rendering, the app composes the fetched `LeaderboardData` through a
   fixed pipeline (`app/(site)/leaderboard/page.tsx`):
   `withHintPenalties` → `withModuleContributions` → `withTeamStandings`
   (`src/lib/leaderboard/{hint-penalties,module-contributions,team-standings}.ts`).
   `withModuleContributions` attributes each row's points into a
   per-module `ModuleProgress` for every *enabled* module — `secure-development`
   is **attributed**, not added, since its points already came from the
   scorer above; `quiz` scores entirely app-side, so its points are never
   inside `entry.points` to begin with and are **added** on top instead
   (`entry.points += quizTotal.points`) — see
   [Quiz data flow](#quiz-data-flow) below. It runs *after* hints so it attributes the **net**
   (post-penalty, floored) figure — attributing first would show an expanded
   row a larger module total than the header above it — and it re-ranks
   unconditionally, so being last is what makes the final order deterministic
   (`withHintPenalties` no-ops when hints are disabled and can't be relied on
   to produce it). Team rows pass through it untouched: nothing renders a
   per-module team breakdown yet. Ranking
   itself (`src/lib/leaderboard/rank.ts`'s `compareStanding`) is: items
   completed **across modules** descending, then combined points descending,
   then earliest last-activity ascending, with a `patched`/`lastSolveAt`
   fallback for sources that carry no per-module data (e.g. the legacy
   Upstash-schema source). With only `secure-development` enabled the
   *populated* case reproduces the old `patched`-then-`points`-then-
   `lastSolveAt` order exactly. The fallback case does **not** preserve the
   Upstash source's own arrival order: that source hands back rows ordered by
   points descending (`ZRANGE`), and ranking on `patched` first moves a row
   with more patches but fewer points above one with more points. That
   re-ordering is deliberate — it puts Upstash on the same breadth-first rule
   as the lambda and mock sources instead of leaving one board scored
   differently. An
   expanded leaderboard row then renders each enabled module's own detail
   block (`components/module-detail.tsx` switches on `moduleId` — a
   `secure-development` row shows the existing per-target breakdown, and a
   module with a different progress shape defines its own).

## Quiz data flow

The `quiz` module never touches `scorer`, `sync`, or GitHub — it's the app's
own, entirely separate scoring path, running inside `apps/web` against Redis
keys it owns outright. `apps/web/src/lib/quiz-store.ts` is the only writer
during normal contestant and authoring activity — answering, grading,
question authoring/deletion all go through it — but two `admin-store.ts`
bulk-maintenance paths touch `ctf:quiz:*` directly rather than calling into
`quiz-store.ts`: `seedDemoData()` (`HSET`s the questions key, the answer key,
a per-login answers hash, and both aggregate hashes when seeding demo data)
and the master reset's `scanDelByPrefix()` (`SCAN`+`DEL`s
`ctf:quiz:answers:*`/`ctf:quiz:attempts:*`/`ctf:quiz:points`/
`ctf:quiz:answered` — see "Master reset" below). Both reuse `quiz-keys.ts`'s
shared key constants and `canonicalizeChoices` recipe rather than
re-deriving them, so the two writers can't silently disagree on key names or
answer-set format even though they're separate code paths:

- `ctf:quiz:questions` — the public-safe question hash both contestants and
  the admin panel read: prompt, type, choices, points, `order`. Never
  carries a correct answer.
- `ctf:quiz:key` — the correct-choice-id set per question, always stored as
  a sorted JSON array (a `"single"` question is simply the one-element
  case, not a separate format). Read only inside `quiz-store.ts`'s grading
  path; no route that echoes its input back to the caller ever touches it,
  so the answer key never reaches a client — contestant or admin.
- `ctf:quiz:answers:<login>` / `ctf:quiz:attempts:<login>` — one
  contestant's correctly-answered questions (points and timestamp captured
  at answer time) and every attempt, right or wrong.
- `ctf:quiz:points` / `ctf:quiz:answered` — running per-login aggregate
  counters the leaderboard overlay reads with two `HGETALL`s regardless of
  board size, the same trick `ctf:hints:spent` uses.

**Grading is one atomic Lua script**, not a sequence of round trips: reading
the current attempt count and cooldown, re-checking the cap and cooldown
against the *current* admin settings, bumping the attempt counter, comparing
the submission against the stored key, and — on a match — writing the answer
row and incrementing both aggregate counters, all happen inside a single
script execution. The JS-side `quizGate` pre-check that runs before the
script is only a cheap early-out over its own separate, non-atomic read; the
script is what actually closes the race, because Redis runs it to completion
before starting the next one, so a burst of near-simultaneous submissions on
the same question can't collectively spend more attempts than the cap
allows.

**Fail-closed — deliberately the opposite of the scoring freeze.** If the
gate's attempt/answer lookup itself errors, it refuses the answer (a
distinct `"unavailable"` reason) rather than guessing. This is the inverse
of `effectivePaused`'s fail-**open** behavior below (a Redis blip must never
silently drop a live, already-judged PR submission): for the quiz, the safe
failure on an unverifiable lookup is "don't grade it," not "grade a
possibly-replayed submission."

**Quiz points are ADDED to the board, not attributed from it.**
`withModuleContributions` (`src/lib/leaderboard/module-contributions.ts`)
treats the two enabled modules differently because their points arrive
differently: `secure-development`'s points are already inside `entry.points`
(the scorer computed them), so the overlay only *attributes* that existing
figure into a `ModuleProgress` block. The quiz never submits anything
through `scorer`'s `POST /score` — the web app holds no score-writing token
for that endpoint at all, so there is nothing for it to authenticate as a
writer with — its points are computed and stored entirely by the app, so
they must be **added** onto the scorer-sourced total (`entry.points +=
quizTotal.points`) before the combined board re-ranks.

A team's quiz total is the **union** of its members' correctly-answered
questions (`getTeamQuizTotals`), never the sum of their individual
aggregates — summing would double-count a question two teammates both
answered, exactly like a shared flag would double-count under naive
summation. Individual rows read the cheap per-login aggregate counters
instead (`getQuizTotals`); only a team standing pays the per-member
`HGETALL` cost, and only once team standings are already available on that
leaderboard source.

The master reset (below) wipes `ctf:quiz:answers:*`, `ctf:quiz:attempts:*`,
`ctf:quiz:points`, and `ctf:quiz:answered` — contestant progress — but
deliberately leaves `ctf:quiz:questions` and `ctf:quiz:key` untouched, the
same way it leaves `ctf:admin:settings` untouched: both are organizer-
authored content, not event-run state a reset should ever destroy.

## Organizer admin panel (runtime overrides)

`event.yaml`'s `admins` allowlist (checked case-insensitively against the
signed-in GitHub login, `apps/web/src/lib/admin-auth.ts`'s `requireAdmin`)
gates a small runtime-override layer that sits alongside the build-time
config above — this one *is* readable/writable while the stack is running,
without a rebuild:

- **`ctf:admin:settings`** (Redis hash, `apps/web/src/lib/admin-store.ts`) —
  `paused` (two-state: `"1"` or absent — absent means false), `hintsEnabled`,
  `hintCost`, `hintsMinSolves` and `hintsUnlockAfterMin` (three-state:
  a value or absent — absent means "no override, use the build-time
  default"), plus `updatedBy`/`updatedAt` and
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
`ctf:joincode:*`, `ctf:hints:*`, and, when the `quiz` module is enabled,
`ctf:quiz:answers:*`/`ctf:quiz:attempts:*`/`ctf:quiz:points`/
`ctf:quiz:answered` — keeps `ctf:admin:settings` and (deliberately)
`ctf:quiz:questions`/`ctf:quiz:key`, and appends a
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
them, timestamps spread for a rising graph, plus teams). When the `quiz`
module is enabled, the same seed also writes a small demo question bank
(`DEMO_QUESTIONS`) with some already answered (`DEMO_QUIZ_ANSWERS`), so the
demo board shows a genuinely combined score — patch points and quiz points
both contributing — instead of leaving the second module invisible. A
disabled quiz module leaves the seed byte-for-byte identical to pre-quiz
behavior. The route and its
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
   It validates every key under `event.yaml`'s `modules:` map against a fixed
   set of registered ids (today: `secure-development`, `quiz`) and emits a
   structured `modules` array (one entry per registered, enabled id) plus a
   derived back-compat `targets` array — `secure-development`'s `targets`
   list, or `[]` if that module isn't enabled — so existing `targets`
   consumers don't need to know the config is now multi-module. It writes
   `apps/web/src/lib/event-config.generated.ts` (gitignored — a typed `const`
   module) and fails the build loudly (non-zero exit) on invalid input,
   including an unregistered module id.
5. `src/lib/event-config.ts`, `src/lib/modules.ts`, `src/lib/apps.ts`, and
   `src/lib/site.ts` import the generated module and derive `eventConfig`,
   `enabledModules`, `enabledApps`, and the site-wide `event` object from
   it. `modules.ts`'s `enabledModules` maps the generated `modules` array to
   each id's registry entry (display name, description, nav) — enablement
   comes from config, display metadata lives in code — and `site.ts`'s
   `moduleNavLinks` splices a module's nav entry into the header nav iff that
   module is enabled and defines one (a module with no contestant route, like
   `quiz` today, contributes no link).
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
  upstream change (see [Status and upstream
  dependencies](operations.md#status-and-upstream-dependencies), item 1); the
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
| Unit (app) | `apps/web/src/lib/__tests__/*`, `apps/web/scripts/__tests__/generate-event-config.test.ts`, run via `vitest run` | Event-config generation (yaml/env/defaults precedence, unknown-module/target rejection, timezone-independent date formatting), module/app enablement filtering, site config derivation, and — `apps/web/src/lib/leaderboard/__tests__/{module-contributions,rank,pipeline}.test.ts` — the module-contribution overlay's attribution (`secure-development` attributed not added, no double counting; a penalised row's module points equal its net points; with the quiz module disabled a source's teams pass through untouched and no quiz block is read at all; with it enabled, quiz points are added to an entry's and a deduped team's totals, a quiz-less entry gets no quiz block, and quiz activity can't demote a patched-heavy row on an upstash-shaped board) and the cross-module-completion/points/earliest-activity ranking — including the regression that ordering is already correct with hints disabled, since `withHintPenalties` no-ops in that case and must not be the thing doing the re-rank, and the pinned re-ordering of an Upstash-shaped board onto the breadth-first rule. The quiz store itself (`src/lib/__tests__/quiz-store*.test.ts`) covers all-or-nothing set comparison, the attempt cap and cooldown (including the atomic grading script's authority over the JS-side pre-check, and its fail-closed behavior on a lookup error), and question authoring validation; `components/__tests__/{admin-quiz-controls,quiz-board}.test.tsx` cover the authoring form and the contestant answer UI. |
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
