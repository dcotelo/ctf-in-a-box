---
title: Architecture
---

[← Docs home](index.md)

# Architecture

What runs where, how a score gets from a contestant's PR to the leaderboard,
how an organizer's `event.yaml` becomes the app's branding, and what the
security model actually rests on. For *why* these choices were made instead
of alternatives, see [docs/decisions.md](decisions.md). For the contract a
new CTF vertical must satisfy, see [docs/modules.md](modules.md). For
day-to-day operation, see [docs/operations.md](operations.md).

## Platform and modules

CTF-in-a-box is a **control plane** with **modules** plugged into it. The split
is deliberate: the platform never knows what a challenge *is*, only how a score
arrives and how a leaderboard renders; a module never re-implements org
provisioning, teams, ingestion, or ranking. `event.yaml`'s `modules:` map
accepts more than one registered module id — `secure-development` (targets,
GitHub-mediated scoring, the worked example throughout this doc), `quiz`
(a self-paced single/multi-select question bank, scored entirely inside the
app — see [Quiz data flow](#quiz-data-flow) below), `classic` (a
jeopardy-style flag board, also scored entirely inside the app — see
[Classic data flow](#classic-data-flow) below), and `ai` (externally hosted
AI/LLM challenges: the box mints a contestant's identity for the outside
site and grades or accepts a solve back, also scored entirely inside the
app — see [AI data flow](#ai-data-flow) below). See
[docs/modules.md §5](modules.md#section-5-ui--presentation-contract) for what the three
app-side modules' UI contract still leaves open. An id outside
the registry still fails the build loudly; the boundary is the
[module contract](modules.md).

| The platform (control plane) owns | A module provides |
|---|---|
| The disposable per-event GitHub **org** and its lifecycle (`setup/ctf-setup.sh`). | The **targets** it forks/provisions per event, and its teardown equivalents (contract §7). |
| **Auth** (GitHub OAuth sign-in) and the **admins** allowlist. | — (uses the platform's identity). |
| **Team** registration, roster, join codes, the dedupe rollup, and the requirement that a contestant be on a team before anything scores (`apps/web`, `ctf:team:*`). | — (scores are per `author`; the platform maps authors to teams). |
| The **scoring pipeline**: the single audited writer `POST /score`, poll/push transports, the `github-actions[bot]` trust filter (`sync/`, `scorer/`). | Its **scoring workflow** and the score payloads it submits through that one writer (contract §2–3, §6). |
| **Leaderboard** ranking, points aggregation, the score-over-time series, and rendering (`scorer/src/serve.js`, `apps/web`). | Its **challenge catalogue** — stable target/challenge IDs with totals — plus display metadata and progress semantics (contract §4–5). |
| The **admin panel** runtime overrides (freeze, hints, registration, module enablement, per-module display name/blurb) (`ctf:admin:settings`). | — (inherits the controls; its registry `displayName`/`description` are the defaults an organizer's `moduleTitle:<id>`/`moduleBlurb:<id>` override). |
| **Event config** schema, top-level (`event`, `github`, `admins`) baked into the app (build-time flow below). | Its `modules.<name>` config block and the loader/validator entry that recognizes it (contract §1). |

Everything below — the services, the score data flow, the security model — is
the platform. Where `secure-development` fills a module slot (its targets, its
`pull_request_target` scoring workflow, its catalogue), it is called out as the
worked example, exactly as the module contract does.

## System overview

Everything runs as one `docker-compose.yml` stack (see
[decisions.md #2](decisions.md#adr-2-single-docker-compose-box-no-kubernetes-in-v1)).
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
                    |    srh    |<--|  scorer   |   judges PRs;
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
| `caddy` | `caddy:2-alpine` image (digest-pinned, [ADR 51](decisions.md#adr-51-base-images-are-digest-pinned-and-dependabot-is-what-keeps-the-pin-honest)); `caddy/Caddyfile.poll` or `caddy/Caddyfile.push` selected by `SCORE_INGEST` | Reverse proxy in front of `app`. Push mode adds a `/score` route to `scorer`; poll mode has no `/score` route at all — zero inbound scoring surface. |
| `app` | `apps/web/` (vendored Next.js app, built from local source via `apps/web/Dockerfile`) | Contestant-facing UI: GitHub sign-in, challenge browser, leaderboard, rules/FAQ/how-to-play pages. Event name/dates/targets are baked in at build time (see below). |
| `scorer` | `${SCORE_IMAGE:-…}` — your own build from the in-repo engine `scorer/`, which bakes the public vendored rubric by default (see [docs/scorer.md](scorer.md)); `setup/ctf-setup.sh org` mirrors whatever `SCORE_IMAGE` names into the event org. The compose fallback `ghcr.io/owasp-ctf/score:latest` is a private upstream image the kit does not assume access to. | Judges submitted PRs against the baked rubric; exposes `POST /score` (bearer-token authed write) and `GET /leaderboard`. The one score writer in the system. Part of the `secure-development` module, so it carries `profiles: ["poll", "push"]` — both ingest modes need it, unlike `sync`, which is `["poll"]` only — and a single-module event without `secure-development` never brings it up; see [ADR 26](decisions.md#adr-26-compose-profiles-follow-the-enabled-modules). |
| `srh` | `hiett/serverless-redis-http` | Upstash-REST-compatible HTTP proxy in front of `redis`, so the app's `@upstash/redis` client works unchanged against local Redis. Implements only the POST-command-array subset of Upstash's REST API (no path-style `GET /get/<key>` shortcut — see `scripts/smoke.sh`). |
| `redis` | `redis:7-alpine` (digest-pinned, [ADR 51](decisions.md#adr-51-base-images-are-digest-pinned-and-dependabot-is-what-keeps-the-pin-honest)), `--appendonly yes` | Durable state: scores, team/hint data. Named volume `redis-data` survives box reboots. |
| `sync` | `sync/` (Node, `sync/src/*.js`) | Poll-mode only (`profiles: ["poll"]`). Polls the event org's forked target repos' issue comments with a GitHub App installation token, validates them, and forwards trusted score payloads to `scorer`. Also reads the organizer's pause flag and master-reset epoch every tick and writes a heartbeat (see "Organizer admin panel" below). Tolerates `modules.secure-development` being absent from `event.yaml` (e.g. a quiz-only event): it logs `no polled module enabled, nothing to do` and exits `0` rather than polling anything — `restart: on-failure` (not `unless-stopped`) is what keeps that clean exit from being restarted as if it were a crash. |

## Data flow for a score

1. A contestant forks a target repo in the event org, patches a
   vulnerability, and opens a PR back to the org's copy.
2. A `pull_request_target` GitHub Action (rendered per target from the
   in-repo template `scorer/consumer-workflow.example.yml` by
   `setup/ctf-setup.sh org`, which commits it to each fork automatically, see
   [docs/modules.md §6.1](modules.md#section-6-security-requirements-non-negotiable))
   runs in the *base* repo's context — where org secrets live — and scores
   the patch using the private `scorer` image, while the contestant's PR
   code runs sandboxed with no access to those secrets.
3. The Action reports the result one of two ways, depending on
   `SCORE_INGEST`:
   - **push**: POSTs the score directly to `${scorerUrl}/score` (through
     `caddy`'s `/score` route) with a bearer token. The scorer compares that
     token in constant time — both sides are SHA-256'd and passed to
     `timingSafeEqual`, so neither the token's bytes nor its length are
     recoverable from how long a rejection takes.
   - **poll** (default): posts a PR comment authored as
     `github-actions[bot]` containing a machine-readable marker,
     `<!-- ctf-score: {...} -->` (`sync/src/parse.js`'s `MARKER`).

   Where and how push mode POSTs comes from the org secrets
   `LEADERBOARD_URL`/`LEADERBOARD_TOKEN`, read by the kit's own scoring
   workflow (`scorer/consumer-workflow.example.yml`) — leave both unset for
   poll mode
   ([Status and upstream dependencies](operations.md#status-and-upstream-dependencies)).
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
   The poller's `seen` set is keyed by comment **revision** — its id AND its
   `updated_at` — not by id alone. The scoring workflow posts ONE comment per
   target and EDITS it (a "scoring in progress" placeholder, then the result),
   so an id-only key meant a PR whose first run produced no score burned its
   id on the placeholder and could never be scored afterwards: the edit
   carrying the real result was skipped, silently, and the cursor advanced
   past it. Re-presenting a revision is safe because the scorer's write is
   monotonic and idempotent on replay (step 7).
6. `submitScore` (`sync/src/submit.js`) POSTs the validated payload to
   `POST /score` on `scorer` with a bearer token
   (`Authorization: Bearer ${cfg.scorerToken}`). A `2xx` is success; a
   `4xx` is treated as a permanent rejection (dropped, logged); anything
   else throws and the poller un-marks the comment as seen so it retries
   next tick.
7. `scorer` writes the score to Redis (via `srh`) as a monotonic,
   idempotent-on-replay update — the write model is described in
   [docs/decisions.md #5](decisions.md#adr-5-single-score-writer-monotonic-writes-at-least-once-delivery).
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
   `withModuleContributions` → `withTeamStandings` → `withHintPenalties`
   (`src/lib/leaderboard/{module-contributions,team-standings,hint-penalties}.ts`).
   `withModuleContributions` attributes each row's points into a
   per-module `ModuleProgress` for every *enabled* module — `secure-development`
   is **attributed**, not added, since its points already came from the
   scorer above; `quiz`, `classic` and `ai` each score entirely app-side, so
   none of those modules' points are ever
   inside `entry.points` to begin with and all three are **added** on top instead
   (`entry.points += quizTotal.points + classicTotal.points + aiTotal.points`)
   — see [Quiz data flow](#quiz-data-flow), [Classic data flow](#classic-data-flow),
   and [AI data flow](#ai-data-flow)
   below. Hint penalties run **last**, netting the final all-module total
   exactly once — module blocks everywhere show their *gross* contribution and
   the row's `−N hints` marker is what reconciles them against the netted
   header. (The fold used to run first, netting scorer points alone, which
   made hints free for any row whose points arrive later: a classic- or
   quiz-only contestant, or an upstash-path team.) Ranking
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

## Leaderboard with no scoring backend

Steps 1–8 above assume `secure-development` is enabled — there is a scorer,
and `LEADERBOARD_API_URL`/`LEADERBOARD_SOURCE` name a real backend to read.
When it's disabled (a quiz-only, classic-only or ai-only event, or any event
with no
scored module),
none of that pipeline runs at all: `getLeaderboardSourceMode`
(`src/lib/leaderboard/source.ts`) checks `isModuleEnabled("secure-development")`
*before* looking at `LEADERBOARD_SOURCE`, and — not overridably by that env
var — resolves to `"empty"` instead, serving `emptySource`
(`src/lib/leaderboard/empty.ts`): no entries, no teams, every capability
`false`. This is deliberately not the mock source; placeholder data would be
indistinguishable from real standings on a board that also carries real quiz,
classic or ai points.

Everything a contestant sees on such a board is then built by the overlay
pipeline itself, on top of nothing. `withModuleContributions` creates a row
for any login that holds module (quiz, classic and/or ai) points and has no
entry from the
source — the board's login set is the *union* of the source's logins and the
logins holding module points, matched case-insensitively, so a contestant
with quiz, classic or ai points but no scored PR gets a row instead of staying
invisible
until one exists — and a login holding more than one module's points gets ONE
row
carrying every held block, never one row per module. A created row has every scorer-supplied field
(`patched`/`failed`/`total`/`apps`) genuinely zero — there is no scoring
entry behind it — and its only points are the modules', added rather than
attributed (see [Quiz data flow](#quiz-data-flow), [Classic data
flow](#classic-data-flow) and [AI data flow](#ai-data-flow) below for why
those are
different verbs). `withTeamStandings` does the same one step later for
teams: its membership-only rows (synthesised from live team records whenever
the source has no team concept of its own) get quiz, classic and ai points
added
via
`withTeamQuizPoints`, `withTeamClassicPoints` and `withTeamAiPoints`, each
deduped by question/flag/challenge
across members, so a quiz-only, classic-only or ai-only
event's default view — the teams board, whenever teams exist — doesn't open
on every team tied at zero. See
[decisions.md #25](decisions.md#adr-25-building-a-leaderboard-with-no-scoring-backend)
for why the board is built this way.

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

  The **field name is the question id**, which is also the field name in
  `ctf:quiz:key` and the reference every `ctf:quiz:answers:<login>` row is
  recorded against. Organizers no longer author it: `generateQuestionId`
  (in the dependency-free, client-safe `quiz-keys.ts`, alongside the
  `QUIZ_ID_RE` the store validates with — one object, checked on both sides)
  derives a slug from the prompt plus a short random suffix when a NEW
  question is saved, and checks its own output against that pattern before
  returning it. On an EXISTING question the id is immutable, and structurally
  so: the admin form's `QuestionDraft` type has no `id` field for an edit to
  change. Rewriting one would orphan every banked answer — the points would
  stay on the leaderboard with nothing behind them.

  `order` is likewise derived rather than typed: the admin list is sortable
  (drag, or per-row Move up/Move down for keyboard operation) and the pure
  `reorderQuestions(list, from, to)` recomputes every row's `order` from its
  new position, with only the changed rows POSTed back. Storage and the
  read path are unchanged — `listQuestions` still sorts by `order`.
- `ctf:quiz:key` — the correct-choice-id set per question, always stored as
  a sorted JSON array (a `"single"` question is simply the one-element
  case, not a separate format). **Never reaches a contestant**, and the
  boundary is a type, not a habit: `listQuestions()` — the only list
  function `/quiz` and the leaderboard may call — issues no command against
  this hash at all, and the `Question` shape it returns has no field that
  could carry a correct-answer id. Two server-side readers, and only two,
  touch it: the grading script, and `listQuestionsForAdmin()`, whose sole
  caller is the `requireAdmin`-gated `GET /api/admin/quiz`. That admin read
  is deliberate — it prefills the organizer's edit form with the choices
  currently marked correct, so fixing a typo in a prompt doesn't require
  re-picking the answer from memory and silently redefining it. It is sound
  because anyone past that gate can already rewrite or delete the answer
  outright. Its return type, `AdminQuestion` (`{ question, correct }`), is
  deliberately **not** assignable to `Question`, so handing an admin record
  to a contestant-facing component is a compile error rather than a leak.
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
questions (`getTeamQuizTotalsBatch`), never the sum of their individual
aggregates — summing would double-count a question two teammates both
answered, exactly like a shared flag would double-count under naive
summation. Individual rows read the cheap per-login aggregate counters
instead (`getQuizTotals`); only a team standing pays the per-member
`HGETALL` cost. That happens in one of two places: `withModuleContributions`
attributes it directly when the source already provides deduped team rows
with real per-flag points (mock/lambda, `capabilities.teams` already `true`);
otherwise — upstash, and the empty source a quiz-only event uses — team rows
don't exist yet when `withModuleContributions` runs, so the same attribution
(`withTeamQuizPoints`, calling the identical `attributeTeams` helper) runs
from `withTeamStandings` instead, against the membership-only rows it just
synthesised. One dedupe rule, called from whichever of the two places the
rows actually exist at. Those per-member reads for **every** team on the
board go out in a single pipeline (one `HGETALL` per distinct member, not one
round trip per team), because `/leaderboard` is dynamic and fetched
`no-store` — a per-team round trip would bill an event one REST call per
team on every page view.

The overlay's two quiz reads are settled **independently**: `getQuizTotals`
supplies the points, `listQuestions` only the "answered / total"
denominator. A failed question-list read degrades to a missing denominator
(clamped to at least the answered count, so the ratio can never read
"1 / 0"), never to lost points — points and the ranking they drive must not
hinge on a cosmetic read.

The master reset (below) wipes `ctf:quiz:answers:*`, `ctf:quiz:attempts:*`,
`ctf:quiz:points`, and `ctf:quiz:answered` — contestant progress — but
deliberately leaves `ctf:quiz:questions` and `ctf:quiz:key` untouched, the
same way it leaves `ctf:admin:settings` untouched: both are organizer-
authored content, not event-run state a reset should ever destroy.

## Classic data flow

The `classic` module is the jeopardy-style flag board: an organizer authors a
set of challenges, each hiding a flag under a description; a contestant reads
the description, finds the flag by whatever means the challenge calls for,
and submits the string for points, graded instantly. Like `quiz`, it never
touches `scorer`, `sync`, or GitHub — it is a second, entirely separate
app-side scoring path, running inside `apps/web` against its own Redis keys.
`apps/web/src/lib/classic-store.ts` is the only writer during normal
contestant and authoring activity (submitting, grading, challenge
authoring/deletion all go through it); `admin-store.ts`'s bulk-maintenance
paths (demo seed, master reset) are the one documented exception, reusing
`classic-keys.ts`'s shared key constants directly rather than calling into
`classic-store.ts` — the same deliberate exception `quiz-store.ts` documents.

**Authoring produces TWO flag hashes, not one**, keyed by challenge id:

- `ctf:classic:flag` — the flag AS AUTHORED, trimmed. Read by exactly one
  function, `listChallengesForAdmin` (the `GET /api/admin/classic` surface
  behind `requireAdmin`), so an organizer's edit form can show what they
  typed, casing included, instead of forcing a retype-from-memory on every
  typo fix.
- `ctf:classic:flagnorm` — the challenge's comparison form
  (`flagComparisonForm` in `classic-keys.ts`): trim, then Unicode
  NFC-normalize, then lowercase — **unless** the challenge is marked
  `caseSensitive`, in which case the lowercasing is skipped and only trim and
  NFC apply (issue #193). This is the ONLY value grading ever compares
  against.

  Which form applies is decided by the public challenge record, and the
  grading script only *chooses* between two forms the submission path has
  already computed in JS. That keeps the long-standing rule intact: no case
  handling ever happens in Lua, whose `string.lower` is ASCII-only and would
  disagree with JS on any non-ASCII flag — producing a challenge nobody can
  solve.

Both are written together in one Upstash pipeline call inside
`upsertChallenge`, so they can never observably disagree — a challenge can
never be live with a `flagnorm` belonging to a previous version of its flag.
See [decisions.md's ADR on two flag hashes](decisions.md#adr-27-two-flag-hashes-rather-than-one)
for why the store keeps both rather than one.

**Normalization happens in JS, on both the authoring and submission paths,
and deliberately NEVER in Lua.** `normalizeFlag` is the one function either
side may use, precisely so they can never independently drift; Lua's
`string.lower` is ASCII-only, so a Lua-side re-normalization of any
non-ASCII flag would disagree with the JS side and produce a challenge
nobody could solve. `SUBMIT_SCRIPT` (below) receives an already-normalized
value and compares whole strings with Lua's `==` — a flag can contain
braces, quotes, and backslashes, so it is never pattern-matched out of a
JSON blob the way a points value is.

**The full key layout is ten `ctf:classic:*` keys**, enumerated in
`classic-store.ts`'s header comment: `challenges` (the public-safe hash
contestants see — no field on it could carry a flag even by accident),
`flag` and `flagnorm` (above), `hints` (paid-hint text per challenge, per
issue #190 — written by the admin form, SECRET until purchased through
hint-store's reveal, exactly the flag hashes' rule; its name lives in
`classic-keys.ts`),
`categories` (one JSON array, the organizer's chosen display order), `solves:<login>` (a contestant's banked solves —
`{points, at}`, points captured at solve time so a later re-price never
rewrites history), `attempts:<login>` (every submission, right or wrong —
`{attempts, firstAt, lastAt, lastAtMs}`, the cooldown's own read; `firstAt`
is what Insights' time-to-solve is measured from), and three running
aggregates: `points` and `solved` (per-login totals the leaderboard overlay
reads with two `HGETALL`s regardless of board size) and `solvecount` (the
per-challenge distinct-solver count the board displays, distinct by
construction because the already-solved guard runs before any write).

**Submission**: `POST /api/classic/submit` derives `login` from the session
(never the request body) and calls `submitFlag(login, challengeId, flag)`.
A cheap, non-atomic JS pre-check (`evaluateGate`) short-circuits on, in
order: scoring paused/outside the scheduled window (fails **open** — a Redis
blip must never silently drop a submission a contestant is entitled to
make), already solved, or still inside the cooldown (fails **closed**, with
its own `"unavailable"` reason, if the lookup itself errors). Past the
pre-check, one atomic Lua script — `SUBMIT_SCRIPT`, not the pre-check — is
the actual authority: it re-reads the already-solved guard and the cooldown
against state read fresh at script-execution time (never a value the caller
read earlier), so a race that slips past the pre-check is still caught,
atomically. On a correct submission it reads the challenge's current price
off the challenge hash, writes the solve row, and bumps all three aggregate
counters (`points`, `solved`, `solvecount`) in the same script execution.

**There is no attempt cap anywhere in this gate — only a cooldown, in
SECONDS.** `classicCooldownSec` (organizer-configurable, default `5`,
capped at `3600` — `CLASSIC_COOLDOWN_SEC_MAX` in `admin-store.ts`) is the
only knob; `0` disables it. This is worth stating explicitly because every
neighbouring retry-gate setting on this platform (`quizRetryAfterMin`,
`hintsUnlockAfterMin`) is expressed in **minutes** — classic's is seconds,
because the job is blunting scripted brute force on a short timescale, not
rationing genuine tries the way quiz's attempt cap does. See
[decisions.md's ADR on no attempt cap](decisions.md#adr-29-no-attempt-cap-on-flag-submission).

**Points are static.** `SUBMIT_SCRIPT` reads a challenge's price off
`ctf:classic:challenges` at the moment of a correct solve; nothing anywhere
lowers it as more contestants solve it, and there is no first-blood bonus.
Re-pricing a challenge later never changes what was already banked, because
`solves:<login>` captures `points` at solve time.

**Descriptions render through a hand-rolled Markdown subset**
(`apps/web/src/lib/markdown.ts`): bold, italics, inline code, fenced code
blocks, ordered/unordered lists, and links restricted to an `http:`/
`https:`/`mailto:` scheme allowlist (control characters and whitespace
stripped before parsing, scheme-relative `//host` rejected outright). The
parser produces a typed node tree, never an HTML string, and
`components/markdown.tsx` renders that tree into React elements —
`dangerouslySetInnerHTML` is never called anywhere in the pipeline, so
injected markup is structurally impossible rather than filtered out. See
[decisions.md's ADR on the hand-rolled renderer](decisions.md#adr-28-a-hand-rolled-markdown-renderer-rather-than-a-library).

**Classic points are ADDED to the leaderboard, never attributed** — the
scorer never sees a flag, so there is nothing of classic's to attribute from
(same reasoning as quiz's points; see [Quiz data flow](#quiz-data-flow)
above). A team's classic total is the **union** of its members' solved
challenges (`getTeamClassicTotalsBatch`), never the sum of their individual
aggregates, for the same double-counting reason a shared flag or a shared
quiz answer would otherwise double count. That union-by-item fold is not
classic's own logic: it is `leaderboard/team-fold.ts`'s `foldTeamItems`,
the identical function `quiz-store.ts` calls for its own team total —
one shared dedupe rule (earliest-record-wins on a tie, latest timestamp for
"last activity") rather than two copies that could silently diverge. See
[decisions.md's ADR on the shared fold](decisions.md#adr-30-one-shared-team-dedupe-fold).

**Secrecy is a contestant boundary, not an absolute one — mirroring
`ctf:quiz:key`.** `listChallenges` (the contestant path — `/flags`, and the
leaderboard's read of the catalogue) never issues a command against
`ctf:classic:flag` or `ctf:classic:flagnorm`, and the `Challenge` shape it
returns has no field that could carry a flag. `listChallengesForAdmin`
(the `GET /api/admin/classic` surface, behind `requireAdmin`) DOES return a
challenge's flag, in a separate `AdminChallenge` shape (`{challenge, flag}`)
deliberately **not** assignable to `Challenge` — reaching the public half
takes an explicit `.challenge`, so handing an admin record to a
contestant-facing component is a compile error, not a leak someone has to
notice in review. **A flag is genuinely stored in plaintext and visible to
anyone with `/admin` access** — see `docs/operations.md`'s "Classic" section
for the organizer-facing statement of that trade-off.

**Deleting a challenge retires it — contestant history and banked points are
untouched.** `deleteChallenge` removes the challenge and both flag rows, but
deliberately leaves `solves:<login>`/`attempts:<login>` rows and the three
aggregate counters alone, mirroring `deleteQuestion`. Points already banked
for a deleted challenge stay on the leaderboard; only the master reset
clears them.

## AI data flow

The `ai` module is externally hosted AI/LLM challenges: an organizer authors
each challenge in `/admin` (mode `flag`/`event`/`both`, a launch URL
template, categories, an optional paid hint, a submission cooldown), and a
contestant plays it on the outside site or types a flag back on `/ai/[id]`.
Like `quiz` and `classic`, it never touches `scorer`, `sync`, or GitHub — a
third, entirely separate app-side scoring path, running inside `apps/web`
against its own Redis keys. `apps/web/src/lib/ai-store.ts` is the only
writer during normal contestant and authoring activity; `admin-store.ts`'s
bulk-maintenance paths (demo seed, master reset) are the one documented
exception, reusing `ai-keys.ts`'s shared key constants directly — the same
deliberate exception `quiz-store.ts` and `classic-store.ts` document. The
one thing `ai` needs that neither sibling does is an **identity to hand the
outside world**, which is why the module also owns a launch-token mint and
an external-event intake, both described below.

**Identity out: the launch mint.** `/ai/[id]`'s Server Component
(`apps/web/src/app/(site)/ai/[id]/page.tsx`) is the ONE place in the app
that mints a launch token, via `mintLaunchUrl`/`buildLaunchClaims`
(`lib/ai-launch.ts`). This is **gate-at-mint**: the render checks the
module is live, then `requireGatePassed()` (the pre-event gate), then reads
the session, then redirects a teamless contestant away — all four before
the mint is ever reached, and there is no code path above the mint that
calls it without a `login` in hand. The token is Ed25519 (ADR 53), signed
with the module-wide keypair in `ctf:ai:launchkey`, minted lazily on first
use; its claims carry the player's login (`sub`), the one challenge it is
scoped to (`aud`), and a capped progress snapshot across the whole board.
It rides in exactly one place — the launcher `<a>`'s `href` on the
challenge page — and nowhere else in the app renders a token-bearing URL.
The public half is what an external backend or a pure static SPA verifies
against, served by the one unauthenticated, cacheable route
`GET /api/ai/launch-key`.

**Flags in: three surfaces, two store functions, one script.** A solve can
arrive three ways, and every one folds into the same atomic Lua script:

- **In-box**: the shared `ChallengeDetail` form posts to a Server Action,
  `submitAiFlagAction` (`[id]/actions.ts`) — not to the token API, because
  the token that would authenticate such a call lives only in the launcher
  href and must not reach the client any other way. The action re-runs the
  page's own gate order — module live, pre-event gate (fails **closed** — an
  exception is treated as a refusal), session, team (fails **open**, via
  `hasTeam`) — before calling `submitAiFlag` (`ai-store.ts`).
- **External flag submission**: `POST /api/ai/submit` takes `{token, flag}`
  for an external site that renders its own flag box — the launch token in
  the body is the whole authentication (cookie-blind, verified against the
  module's public key), and it calls the same `submitAiFlag` the in-box
  action does.
- **External**: `POST /api/ai/event` is the surface an externally hosted
  challenge's backend calls to assert a solve. It is cookie-blind and
  CORS-open by design, so it authenticates by two proofs instead of a
  session, checked in this order: the raw-body HMAC signature against the
  challenge's own `ctf:ai:signkey` (checked *before* the token, so a caller
  that cannot prove it is the real backend learns nothing about the token
  it presented), clock skew in both directions, then the launch token's
  Ed25519 signature and its `aud` against the challenge id. Only after both
  proofs check out does it charge a per-login rate limit, check team
  membership (fails **open**, same `hasTeam`), and claim the token's `jti`
  against the replay-guard nonce — claimed immediately before the award, so
  neither an earlier refusal burns it nor a later claim lets a race double
  it. A `dryRun` flag runs every check and writes nothing, for an
  integrator to test against without spending a real launch token.

All three surfaces funnel into `submitAiFlag`/`awardAiEvent`, which share **one**
`AWARD_SCRIPT` (`ai-store.ts`) — sharing is deliberate, because two scripts
would eventually disagree about the already-solved guard that makes the
solve counter distinct-by-construction. The script itself refuses an event
assertion against a challenge authored as `mode: "flag"`, so a missed
mode-check in the route cannot turn every flag-only challenge into
something any signing-key holder can assert.

**The key layout is thirteen `ctf:ai:*` keys**, split by secrecy class:

- **Catalogue — public**: `ctf:ai:challenges` (the public-safe hash
  contestants and the leaderboard read — no field on it could carry a flag
  even by accident) and `ctf:ai:categories` (the organizer's chosen display
  order, one JSON array, mirroring classic's).
- **Grading material** — never reaches a contestant path:
  `ctf:ai:flag` (the flag as authored, admin-form only),
  `ctf:ai:flagnorm` (the comparison form grading actually reads),
  `ctf:ai:hints` (paid-hint text, secret until purchased, exactly like
  classic's), and `ctf:ai:signkey` (the per-challenge HMAC key an event
  assertion is signed with — leaking one lets its holder assert solves for
  players who already hold a box-minted token, but cannot mint one itself).
- **Module identity** — `ctf:ai:launchkey`, the module-wide Ed25519
  keypair. Its private half is the most dangerous secret in the module: it
  mints identity, so its holder could name any user on any challenge. It
  sits inside the same contestant secrecy boundary as the hashes above; the
  public half is the one thing in this list that is meant to be served.
- **Progress** — `ctf:ai:solves:<login>` / `ctf:ai:attempts:<login>` (one
  contestant's banked solves and every attempt, right or wrong) and the
  running aggregates the leaderboard overlay reads with flat `HGETALL`s:
  `ctf:ai:points`, `ctf:ai:solved`, and the per-challenge
  `ctf:ai:solvecount` (distinct-solver count, distinct by construction
  because the already-solved guard runs before any increment).
- **Replay** — `ctf:ai:nonce:<jti>`, one key per spent event `jti`, written
  `SET NX EX` so a captured signed request can be replayed at most once.

**Grading is one atomic Lua script**, exactly like quiz's and classic's: the
already-solved guard, the cooldown (graded path only — a signed event has no
wrong answer to rate-limit), the flag comparison, the solve row, and all
three aggregate counters are read and written inside one script execution,
against state read fresh at that instant rather than a value either caller
read earlier. The JS-side pre-check (`evaluateGate`) that runs before it is
only a cheap early-out; the script is what actually closes the race.

**Fail directions, and they don't all point the same way.** The pre-event
gate is **closed** — a check that cannot pass is treated as a refusal, the
same direction quiz's own gate lookup takes on an unverifiable read, because
a mint or a solve is exactly the kind of write a gate exists to hold back.
Team membership is **open** — `hasTeam`'s own catch resolves to `true`,
so a team-store blip never drops a submission an already-teamed contestant
is entitled to make. The pause/schedule settings read is **open** for the
same reason `effectivePaused` is elsewhere: a Redis blip must not silently
freeze a live award. `GET /api/ai/launch-key` is the one **closed** route
here in a different sense — wrapped in `aiRoute`, a thrown store error
answers `503 {error:"unavailable"}` rather than an empty or partial key,
because handing back a bad key would have every integrator cache something
that verifies nothing.

**AI points are ADDED to the leaderboard, never attributed** — the scorer
never sees a launch token or a flag, so there is nothing of ai's to
attribute from (same reasoning as quiz's and classic's points; see
[Quiz data flow](#quiz-data-flow) above). `withModuleContributions`
(`src/lib/leaderboard/module-contributions.ts`) creates a row for any login
that holds `ai` points and has no entry from the scoring source, exactly as
it does for quiz and classic — a login reported by more than one app-side
module still gets exactly ONE created row, carrying every reported block.
Gross module blocks render everywhere, with hint penalties folding **last**
at the row level, same as every other module.

A team's `ai` total is the **union** of its members' solved challenges
(`getTeamAiTotalsBatch`), never the sum of their individual aggregates —
summing would double-count a challenge two teammates both solved. It reads
every member's solve hash in one pipeline for the whole board and folds them
through the same shared `foldTeamItems` (`leaderboard/team-fold.ts`) that
quiz's and classic's team totals use — one dedupe rule, not three copies
that could silently diverge.

**Master reset clears progress, nonces, and the launch key — never the
catalogue.** `resetEvent`'s `RESET_PREFIXES` wipe `ai`'s solve/attempt rows,
the three aggregate hashes, and every spent replay nonce, but deliberately
leave `ctf:ai:challenges`/`ctf:ai:flag`/`ctf:ai:flagnorm`/`ctf:ai:hints`/
`ctf:ai:signkey`/`ctf:ai:categories` untouched — organizer-authored content,
the same rule quiz's and classic's questions/challenges get. Unlike those
two siblings, the reset also deletes `ctf:ai:launchkey` outright: a master
reset starts the event over, so no live launch token should survive it, and
the next launch mints a fresh keypair — every already-issued token stops
verifying, and any deployed external verifier has to re-fetch
`GET /api/ai/launch-key` on its next check. `clearAiChallenges`
(`ai-store.ts`), used by a whole-event archive import rather than the reset,
is the opposite on both counts: it wipes the catalogue (challenges, both
flag hashes, hints, signing keys, categories, and the per-challenge
solvecount) while leaving contestant history and the launch keypair alone,
because rotating identity on every archive import would break every
deployed integration for a wipe that was only ever meant to replace the
challenge list. See [docs/ai-module.md §9](ai-module.md#keys-and-rotation)
for the integrator-facing statement of the same rotation contract.

## Contestant and team state

- **`ctf:user:<login>`** — the contestant's own record: `team` (their current
  slug), `joinedAt` (when they joined **that** team), and `firstTeamAt` (the
  first time they were **ever** on a team). The two timestamps have
  deliberately different lifetimes: `joinedAt` is cleared alongside `team` by
  every path that clears it — leave, captain-remove, disband, admin override —
  while `firstTeamAt` is written with `HSETNX` and survives all of them. ADR 49
  explains why one field could not serve both: reusing `joinedAt` for the
  engagement funnel would report every team-switcher's conversion at their
  *latest* join.
- **`ctf:team:<slug>`** — `name`, `captain`, `createdAt`, `joinCode`; with
  **`ctf:team:<slug>:members`** (a SET) and **`ctf:joincode:<code>`** (the
  reverse index that makes `/join/<code>` resolvable, ADR 45's shareable
  invite).
- **`ctf:user:<login>:hints`** — a SET of `<target>/<challengeId>` the
  contestant bought, where `<target>` is a secure-development app id or the
  literal `classic` (classic hints, issue #190; their text lives in
  `ctf:classic:hints` — named in `classic-keys.ts`, not here — written by the
  admin classic form and secret until purchased, exactly like the flag
  hashes); **`ctf:hints:spent`** — a hash of
  login → points spent, read by the leaderboard's per-team penalty fold;
  **`ctf:hints:at:<login>`** — a hash of `<target>/<challengeId>` → ISO
  purchase time. That last one is a *separate* key
  rather than a conversion of the SET, because changing a live key's type would
  fail `WRONGTYPE` on the first purchase after deploying. It sits under
  `ctf:hints:` so the master reset's existing prefix already sweeps it.

**A team is required to score** (ADR 47). `POST /api/quiz/answer` and
`POST /api/classic/submit` refuse a teamless login with
`403 { error: "no-team" }` — after the pre-event gate, before the store call,
and (on the classic route) before the body is even parsed, so the refusal
cannot become an oracle for whether a flag was correct. The page-level
redirect to `/profile#team` is signposting on top of that, not the boundary.
The check **fails open**: a Redis blip lets the submission through rather than
dropping a correct answer.

Key builders for all of the above live in `apps/web/src/lib/team-keys.ts` — a
dependency-free module, the same pattern as `quiz-keys.ts`/`classic-keys.ts`,
so readers that must not import the `server-only` store can still name the
keys without open-coding the strings.

## Organizer admin panel (runtime overrides)

`event.yaml`'s `admins` allowlist (checked case-insensitively against the
signed-in GitHub login, `apps/web/src/lib/admin-auth.ts`'s `requireAdmin`)
gates a small runtime-override layer that sits alongside the build-time
config above — this one *is* readable/writable while the stack is running,
without a rebuild:

- **`ctf:admin:settings`** (Redis hash, `apps/web/src/lib/admin-store.ts`) —
  two-state `paused` (`"1"` or absent, absent meaning false) and
  `teamRegistrationOpen`, plus a set of **three-state** knobs where a value or
  its absence means "no override, use the build-time default":

  | field | what it gates |
  | --- | --- |
  | `hintsEnabled`, `hintCost` | hints on/off and their price |
  | `hintsMinSolves`, `hintsUnlockAfterMin` | the anti-burner gate and the time phase |
  | `quizMaxAttempts`, `quizRetryAfterMin` | the quiz retry gate |
  | `classicCooldownSec` | seconds between flag submissions on one challenge |
  | `scoreCooldownMin` | minutes between SCORED runs on one PR (ADR 46) |
  | `teamMaxMembers` | players per team (ADR 45) |
  | `scoringStartsAt` / `scoringEndsAt` | the scheduled freeze window |
  | `registrationStartsAt` / `registrationEndsAt` | the team-registration window |
  | `enabledModules` | the live module set (ADR 52) — absent means "use `event.yaml`'s baked set" |

  plus `updatedBy`/`updatedAt` and `resetAt` (the master-reset epoch `sync`
  honours — see below). Every reader applies **override-else-default**
  precedence (`s.hintsEnabled ?? HINT_DEFAULT_ENABLED`, `hint-store.ts`'s
  `resolveHintConfig`), never the reverse.

  **The scheduled windows are enforced at READ time**, not by a scheduler on
  the box, and the same `outsideWindow` logic is implemented independently in
  `apps/web/src/lib/schedule-window.ts` (re-exported through
  `admin-store.ts`), `scorer/src/store.js` and `sync/src/redis.js`. Those
  three must agree; changing one alone silently splits the event's idea of
  whether it is running.

  **`scoreCooldownMin` is the one setting a fork needs.** The Action enforcing
  it runs inside a contestant's repository and cannot reach this Redis, so it
  pulls the value from **`GET /api/public/scoring`** — one of the kit's few
  unauthenticated routes (the full named list is invariant 11 in
  [docs/reviewing.md](reviewing.md)), deliberately read-only and carrying
  scoring *policy* only. ADR 46 states the rule and ADR 50 generalises it: the box may
  publish policy to a fork; a fork may not report facts to the box.

  Two field *families* live on the same hash, keyed by module id rather than
  fixed-name, so a third module needs no storage change:
  **`moduleTitle:<moduleId>`** and **`moduleBlurb:<moduleId>`** — the
  organizer's per-module display name (≤60 chars) and blurb (≤200), plain
  text only (control characters and Unicode bidi-override/isolate characters
  rejected), and validated **fail-closed against `enabledModules`**: a field
  naming a module this event does not run is refused on write and dropped on
  read, so a stale override can neither be planted nor resurface if a module
  is re-enabled later under a different name. An empty
  value `HDEL`s the field rather than storing `""`, so clearing the box
  restores the registry default. Same override-else-default precedence,
  applied by `apps/web/src/lib/modules.ts`'s pure `resolveModules()`; the
  request-scoped reader is `lib/resolved-modules.ts`'s `getResolvedModules()`,
  which **fails open** (a settings-read error resolves to registry defaults,
  because a wrong display name is cosmetic where a wrong gate decision awards
  points). Since ADR 52, **which modules are enabled is runtime too**: the
  Event tab's per-module switches write `enabledModules` on this same hash,
  `event.yaml`'s `modules:` is the starting set and the outage fallback
  (`apps/web/src/lib/enabled-modules.ts`'s `getEnabledModuleIds()`), and the
  title/blurb validation above is checked against the *live* set.
- **`ctf:admin:admins`** (Redis SET, ADR 44) — logins granted admin at
  runtime, on top of the ones baked into the image from `event.yaml`. A set
  rather than a settings field because membership *is* the whole value.
  **Baked admins are not revocable here**: they are the recovery path if a
  runtime grant goes wrong, so no sequence of clicks and no compromised admin
  session can lock everyone out of `/admin`. `requireAdmin` checks the baked
  list first, without touching Redis, and **fails closed** — an unreachable
  store denies rather than resolving to an empty list.

- **`ctf:admin:audit`** — a capped list (`AUDIT_CAP` = 500, `LPUSH`+`LTRIM`)
  of every settings change, written atomically with the change itself (one
  Lua script, so a change can never land without its audit line). Support
  actions (below) append here too, naming both the actor and the target.

- **`ctf:activity:log`** (issue #212) — a capped list (`ACTIVITY_LOG_MAX` =
  5000, `LPUSH`+`LTRIM` in one pipeline, so every write carries its own trim)
  of contestant-facing events: sign-ins (recorded from better-auth's
  after-hook on the OAuth callback), fresh quiz/classic solves, and team
  create/join/leave/rename. Read only by the admin panel's **Activity** tab
  (`GET /api/admin/activity`, admin-gated). Two invariants, both from
  `activity-log.ts`: the writer **fails open** — it sits inside sign-in and
  submission paths, and a lost log line must never fail the action it
  describes — and the `detail` field carries **ids and slugs only, never
  flags, answers, or hint text**. Wiped by the master reset alongside the
  other progress keys; distinct from `ctf:admin:audit`, which records what
  *organizers* changed.

### Support operations (ADR 48)

`POST`/`DELETE /api/admin/ops/user` and `/api/admin/ops/team`, behind
`requireAdmin`, act on **one** contestant or **one** team: look up, reset
progress, delete, remove from team, transfer captaincy, disband. They exist
because the master reset was previously the only destructive control, so a
single stuck contestant mid-event meant choosing between doing nothing and
wiping the event.

The `GET` is gated as hard as the writes — one named contestant's team,
points, attempts and hint spend is precisely the read a non-admin must never
have. The team overrides drop `team-store`'s captain guard (an organizer acts
on a team they are not on) but keep the existence and membership checks
*inside* the Lua, so an admin path is not the one that races a contestant
clicking Leave.

**Secure Development solves can be deleted but not kept deleted.** The scorer
writes them with `HSETNX` so replays no-op, and the poller re-submits from PR
comments — so a per-contestant reset clears them and the next re-score writes
them back. `resetEvent` solves this globally by freezing and bumping `resetAt`;
there is no per-login equivalent, so the API returns a **warning** instead of
pretending. Quiz, classic and ai writes originate in the app, so those deletes are
final.

### Engagement metrics (ADR 50)

`GET /api/admin/metrics` (JSON, or `?format=csv` for the per-challenge table)
folds the funnel, per-challenge difficulty, solves-over-time, module split and
hint usage **entirely out of keys the modules already maintain**. There is no
collection step and no new write path, and nothing is fetched from a fork —
authenticating a fork means a credential every contestant can read, so
fork-reported engagement would be forgeable by the contestants it measures.

Admin-only permanently: the aggregates are harmless, but the payload is
computed from per-contestant rows, so every field added later is one edit away
from carrying a login. The response ships its own **caveats** array, because a
metric whose limits travel separately from it gets quoted without them.

**What it reads.** Three aggregate reads in one pipeline (`ctf:quiz:points`,
`ctf:classic:points`, `ctf:hints:spent`), a `SCAN` of `ctf:solves:*` for
Secure Development, `listTeams()`, and then **six reads per contestant** —
their quiz answers, classic solves, both attempt hashes, `firstTeamAt` off
`ctf:user:<login>`, and their hint purchase times — batched 200 commands to a
round trip. Nothing else; the module contract for those row shapes is
[docs/modules.md §10](modules.md#section-10-engagement-metrics-contract-insights).

**Who counts as a contestant** is the union of everyone on a team and everyone
with points in any module — cheaper than `SCAN`ning `ctf:user:*`, which also
matches `ctf:user:<login>:hints`. Team membership is what makes `stuck`
measurable: someone who attempted everything and solved nothing has no points
row, so only their team knows they exist. That works because ADR 47 makes a
team mandatory before anything scores. An event running without team writes
would see only contestants who scored.

**The fold is capped at 2000 contestants** (`MAX_CONTESTANTS`), far beyond
what the kit targets — the cap exists so a runaway key space cannot turn an
admin click into an unbounded read. When it bites it says so in `caveats`,
because a silently truncated metric reads as a complete one.

**On demand, never cached.** The fold is O(contestants), so it runs on the
button rather than on arrival, and the button doubles as the refresh: an
organizer re-reading it mid-event wants the current number, not one from a
minute ago.

**Aggregate counters are deliberately not read.** `ctf:classic:solvecount`
would be a free classic-only shortcut for per-challenge solves, but folding
each contestant's own rows produces the same figure for *both* modules from
one source. Reading both would invite the two to disagree with no way to tell
which was right.

**The solve-rate denominator has a floor.** It is
`max(people with an attempt row, people who solved it)`, not the attempt-row
count alone: an earned row can exist without an attempt row, because the demo
seed writes answers directly and anything predating the attempts hash has the
same shape. Dividing by attempt rows alone produced solve rates of 200% and
300% on a seeded event — nonsense on its face rather than a subtle
inaccuracy — so the larger of the two is both the correct denominator and the
floor that keeps the rate inside 0..1.
- **`ctf:sync:status`** (Redis hash, written by `sync/src/redis.js`'s
  `writeStatus()` every tick) — `lastPollAt`, `ingested`, `dropped`,
  `lastDrop`, `reposPolled`, `paused`, `lastError`. This is `sync`'s
  heartbeat; the admin dashboard's `GET /api/admin/status` reads it alongside
  `ctf:admin:settings` and a best-effort leaderboard-freshness read.

  `ingested` and `dropped` are a **pair**, and /admin shows them side by side:
  points that reached the leaderboard, and points that reached a PR and
  stopped there. A drop is a comment the poller consumed and could not turn
  into a score — a scorer `4xx`, or a `ctf-score:` marker present but
  unreadable. Both are cumulative and neither is self-clearing, unlike
  `lastError`, which describes only the tick that wrote it: a dropped score is
  still missing after the poller recovers, so the next quiet tick must not
  erase the pointer to the PR that needs looking at.

  What is deliberately **not** counted is as load-bearing as what is. A
  duplicate (the `since` cursor is inclusive, so the boundary comment is
  re-read on most ticks) and a comment with no marker at all (the workflow's
  "⏳ Scoring in progress…" placeholder, every other Action's comments) are
  routine. Folding them in would make `dropped` permanently nonzero, and an
  always-nonzero warning is one organizers learn to ignore — which is the
  failure this counter exists to prevent. They are still tallied per repo and
  reported in one summary log line per tick when anything non-routine
  happened; a fully routine tick prints nothing.

  This exists because **both** of the scoring bugs found by running a real PR
  end to end had the same shape: a comment was consumed, no score was
  submitted, and nothing was written down — the `continue` sat above every
  logged branch, so no amount of tailing the poller would have found either.
  See ADR 38.

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

**The state file is repaired, never trusted.** Poll mode's cursor, seen-cache
and counters live in `/state/state.json` on the `sync-state` volume
(`sync/src/state.js`). It is JSON this service wrote, which makes its *shape*
tempting to assume once it parses — and that was a real outage: a bare `{}` is
valid JSON, so a partial write or a hand edit during a reset produced a file
that loaded fine and then threw on `state.repos[repo]` for every repo, on every
tick. Nothing contains that throw — `tick()`'s per-repo `try` wraps only the
fetch — so it reached the fatal handler, exited 1, and compose restarted
straight back into the same file. Ingestion stayed down for the whole event.

`loadState` now validates the shape it parsed and repairs what is unusable,
field by field rather than all-or-nothing: a damaged `repos` is reset while
`ingested` and `resetAt` survive, because re-zeroing them would misreport the
event's totals and re-apply a master reset already performed. `repoState` does
the same one level down, since a per-repo entry can be damaged on its own and
`markSeen` dereferences `seen` immediately. Every repair is logged; a **missing**
file is not, because that is every event's first boot.

**Master reset + the reset epoch.** `resetEvent()` (`admin-store.ts`, behind
`POST /api/admin/reset`, `requireAdmin` + server-side type-to-confirm) wipes
all event data — `SCAN`+`DEL` of `ctf:solves:*`, `ctf:team:*`, `ctf:user:*`,
`ctf:joincode:*`, `ctf:hints:*`,
`ctf:quiz:answers:*`/`ctf:quiz:attempts:*`/`ctf:quiz:points`/
`ctf:quiz:answered`, and
`ctf:classic:solves:*`/`ctf:classic:attempts:*`/`ctf:classic:points`/
`ctf:classic:solved`/`ctf:classic:solvecount`, and the activity log
(`ctf:activity:log`) — keeps `ctf:admin:settings`
and (deliberately) the organizer's authored content,
`ctf:quiz:questions`/`ctf:quiz:key` and `ctf:classic:challenges`/
`ctf:classic:flag`/`ctf:classic:flagnorm`/`ctf:classic:categories`, and
appends a reset audit line. The prefix list is walked unconditionally: the
reset does not check which modules are enabled, so keys a since-disabled
module left behind are cleared too. On its own that isn't enough in **poll
mode**: `sync` would re-ingest the same PR comments within a cycle and undo
the wipe. So the reset also freezes scoring **and bumps a `resetAt` epoch
field in the settings hash**.
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
`resolveHintConfig()` is the single answer to "are hints on right now",
and every hint read path goes through it: `revealHint`/`hintGate` (the
purchase boundary), `getHintAvailability` (the challenges-page button and
its notice banner), `getViewerHints` (the profile tile and `/api/hints`),
and `getHintPenalties` (the read-time leaderboard penalty). Flipping
`hintsEnabled` in `/admin` therefore changes all of them on the next
request, with no rebuild and no restart.

Two things stay separate from that override on purpose. `HINTS_AVAILABLE`
is a **capability** check — Upstash credentials present — since hint text
lives only there and no organizer setting can conjure it; the read paths
test it first because a credential-less deployment need not read settings
to learn hints are off. And turning hints off does not rewrite history:
`ctf:hints:spent` keeps its rows, so the penalties return intact when
hints come back on. See
[docs/decisions.md #31](decisions.md#adr-31-one-hint-switch-capability-split-from-policy),
which supersedes the v1 limitation recorded in
[#19](decisions.md#adr-19-organizer-admin-panel-runtime-override-layer).

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
   [decisions.md #13](decisions.md#adr-13-closed-appid-union-config-selects-a-subset-unknown-values-fail-the-build)).
   It validates every key under `event.yaml`'s `modules:` map against a fixed
   set of registered ids (today: `secure-development`, `quiz`, `classic`, `ai`) and
   emits a structured `modules` array (one entry per registered, enabled id)
   plus a derived back-compat `targets` array — `secure-development`'s
   `targets` list, or `[]` if that module isn't enabled — so existing `targets`
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
   `moduleNavLinks`/`buildNavLinks` splice a module's nav entry into the flat
   list iff that module is enabled and defines one (`nav` is optional in the
   registry type, so a module with no contestant route contributes no link —
   `secure-development`, `quiz`, `classic` and `ai` each define one now that
   `/ai` exists). The header and
   the footer diverge from there: the footer (`getNavLinks`) always renders
   that flat list, but the header (`getNavGroups`) collapses it further —
   exactly one module still renders as a plain link, but two or more collapse
   into a single "Challenges" dropdown (`buildNavGroups`) whose items read
   each module's `title`, not its `nav.label` (see `docs/modules.md`'s
   "Where a rename reaches, honestly" for why the two labels differ).
6. `next build` statically renders pages against those values — event name,
   dates, and the enabled-target subset are compiled into the served HTML,
   not read at request time.

Changing `event.yaml` after the stack is already running requires an
explicit rebuild of the `app` image (`docker compose --profile app build
app`) — `docker compose up` alone won't pick up the edit, since Compose
only rebuilds an image when told to
([Rebuilding the app after a config change](hosting.md#rebuilding-the-app-after-a-config-change)).

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
- **Per-event scorer image mirror.** The stock rubric ships public (ADR 18
  reversed ADR 17's private-by-default posture): the in-repo engine
  `scorer/` bakes the vendored `rubric.owasp/` unless you build with your
  own `RUBRIC_DIR` (see [docs/scorer.md](scorer.md)) — privacy is an option
  for organizers who want it, not the norm. Either way,
  `setup/ctf-setup.sh org` mirrors whatever `SCORE_IMAGE` names — no
  default; the upstream `ghcr.io/owasp-ctf/score:latest` works too but is
  private with no formal access process (ask the OWASP-CTF maintainers) —
  into the event org's own GHCR (`ghcr.io/$org/score:latest`) so forked
  repos' Actions can pull it with their own `GITHUB_TOKEN`. For a private
  rubric, access control, not obfuscation, is the actual defense —
  reverse-engineering the rubric out of the image is assumed possible; the
  goal is to limit who can pull it, not to make it unreadable.
- **Monotonic, idempotent-on-replay writes.** `scorer`'s `POST /score` is
  the single write path (`sync/src/submit.js` and push-mode Actions both
  land on it — there is no second writer). Delivery is at-least-once: on a
  submit failure, `sync`'s `tick()` un-marks the comment as seen and
  retries it next tick (`rs.seen = rs.seen.filter((id) => id !== c.id);`).
  A replayed already-applied score is expected to be a no-op on the scorer
  side, not a double-count. The in-repo scorer's `POST /score` requires
  bearer auth (`scorer/src/serve.js` — constant-time compare, refuses to
  boot without a token); `scripts/smoke.sh` proves this write path end to
  end offline, and no live event has exercised it against real GitHub yet
  (see
  [Status and upstream dependencies](operations.md#status-and-upstream-dependencies)).
- **Redis is authenticated and unreachable from the app tier.** Redis runs
  with `requirepass` (`REDIS_PASSWORD`, generated by
  `setup/ctf-setup.sh secrets`), and compose reads that variable with `:?` so
  a missing value fails the bring-up instead of quietly starting an
  unauthenticated instance. Independently of the password, the stack is split
  across two compose networks: **`srh` is the only service on both**, so
  `app`, `scorer` and `sync` have no route to `redis:6379` and cannot
  side-step srh's bearer token even if one of them were compromised — an SSRF
  or RCE in the internet-facing app was the concrete worry. `backend` is
  `internal`, so nothing on it reaches the outside world either. Both halves
  are asserted in `scripts/smoke.sh` (an unauthenticated `PING` must answer
  `NOAUTH`; an app-tier service must not resolve `redis` at all), because
  either one can be present in the compose file and absent in the running
  stack. See ADR 41.
- **Per-event disposable orgs.** Each event gets its own GitHub org
  (`setup/ctf-setup.sh org` forks targets into it; `teardown` archives them
  afterward). Contestant PR code runs via `pull_request_target` in the
  base repo's Action context, so the untrusted PR code itself never sees
  the org's secrets or the GitHub App key.
- **Explicit same-origin assertion on mutating API routes.** Every custom
  route authenticates from the session cookie, and that cookie is
  `SameSite=Lax` — which already blocks the cross-site POST a CSRF attack
  needs. The assertion in `src/proxy.ts` is therefore defence in depth, not a
  fix for a live hole: it keeps the property true for a reason this repo
  controls rather than one a dependency default supplies. A `POST`/`PUT`/
  `PATCH`/`DELETE` to `/api/*` whose `Origin` is present and does not match
  `BETTER_AUTH_URL` gets a `403`. Enforced in the proxy rather than per
  handler because the per-handler version's failure mode is a new route that
  forgets. Two prefixes are deliberately excluded: `/api/auth/*`, because
  better-auth runs its own origin policy there and two policies on one route
  is how a sign-in breaks in a way nobody can find; and `/api/ai/*`, because
  the ai module's routes are called cross-origin BY DESIGN by the external
  challenge site and by a static verifier, and authenticate with a signed
  launch token or an HMAC event signature rather than an ambient cookie (see
  `AI_PREFIX` in `src/proxy.ts`). A missing `Origin` is allowed: it means a
  non-browser client, which carries no ambient cookie to ride. See ADR 40.
- **A leaked event key cannot mint identity (ADR 53).** The `ai` module
  splits its two signatures by key type rather than sharing one: the
  per-challenge `ctf:ai:signkey` (HMAC) proves the sender is the real
  external challenge backend, while the module-wide Ed25519 launch token
  proves who is playing. Neither key can produce the other's proof, so a
  backend holding a leaked event key can assert a solve but cannot forge a
  launch token naming an arbitrary player.
- **Per-login rate limits on the guessable/hammerable routes.**
  `/api/team/join` (join-code guessing) and `/api/hints/reveal` are charged
  against a fixed window keyed on the **authenticated login**
  (`src/lib/rate-limit-store.ts`), not an IP; the ai module's
  `/api/ai/submit`, `/api/ai/state`, `/api/ai/event` and the admin
  `/api/admin/ai/test` use the same store, keyed on the login the verified
  launch token names. That distinction is the point:
  `lib/gate-store.ts` keys on IP because the pre-event gate runs before anyone
  has an identity, and it documents that the key is spoofable (Caddy *appends*
  to `x-forwarded-for`). These routes run after `getSession()`, so there is a
  key a caller cannot forge without forging the session. They fail **open** on
  a Redis error — the opposite of the gate throttle, which guards a password
  compare and fails closed — because these bound abuse of routes that have
  their own correctness gates underneath.

## Testing strategy

| Layer | Where | What it proves |
|---|---|---|
| Unit (sync) | `sync/test/*.test.js`, run via `npm test` (Node's built-in test runner) | Config loading/validation, comment parsing and the author grammar, cursor/ETag handling, submit retry semantics, state persistence — in isolation, no network or Docker. |
| Unit (scorer) | `scorer/test/*.test.js`, run via `npm test` (Node's built-in test runner) | Rubric loading/validation, probe grammar + evaluation, the judge's report format (the score-action regexes and the sync marker, pinned verbatim), serve auth/validation/monotonic-replay semantics, leaderboard aggregation, and both solve stores (memory, and Redis-via-SRH against a mocked endpoint) — in isolation, no network or Docker. |
| Unit (app) | `apps/web/src/lib/__tests__/*`, `apps/web/scripts/__tests__/generate-event-config.test.ts`, run via `vitest run` | Event-config generation (yaml/env/defaults precedence, unknown-module/target rejection, timezone-independent date formatting), module/app enablement filtering, site config derivation, and — `apps/web/src/lib/leaderboard/__tests__/{module-contributions,rank,pipeline}.test.ts` — the module-contribution overlay's attribution (`secure-development` attributed not added, no double counting; a penalised row's module points equal its net points; with the quiz module disabled a source's teams pass through untouched and no quiz block is read at all; with it enabled, quiz points are added to an entry's and a deduped team's totals, a quiz-less entry gets no quiz block, and quiz activity can't demote a patched-heavy row on an upstash-shaped board) and the cross-module-completion/points/earliest-activity ranking — including the regression that ordering is already correct with hints disabled, since `withHintPenalties` no-ops in that case and must not be the thing doing the re-rank, and the pinned re-ordering of an Upstash-shaped board onto the breadth-first rule. The quiz store itself (`src/lib/__tests__/quiz-store*.test.ts`) covers all-or-nothing set comparison, the attempt cap and cooldown (including the atomic grading script's authority over the JS-side pre-check, and its fail-closed behavior on a lookup error), and question authoring validation; `components/__tests__/{admin-quiz-controls,quiz-board}.test.tsx` cover the authoring form and the contestant answer UI. The derived-plumbing rules get their own direct coverage, since neither is observable in a static render: `src/lib/__tests__/quiz-id.test.ts` pins that `generateQuestionId` always emits an id `QUIZ_ID_RE` accepts (across a corpus of punctuation-only, non-Latin, emoji and over-long prompts) and that two identical prompts never collide, and `admin-quiz-controls.test.tsx` pins that `payloadFromEditor` submits an existing question's stored id no matter how the draft was rewritten, plus `reorderQuestions`'s recomputed `order` values. The drag handlers themselves are deliberately NOT unit-tested — this repo has no testing-library and does not want one — which is why every decision they make lives in those two pure functions instead. The answer-key boundary is pinned from both sides: `listQuestions` never issues a command against `ctf:quiz:key` while `listQuestionsForAdmin` returns the set paired by question id (`quiz-store.test.ts`), `GET /api/admin/quiz` returns it for an admin and returns a body with no answer data at all for a 401/403 (`app/api/quiz/__tests__/routes.test.ts`), the admin edit draft prefills it (`admin-quiz-controls.test.tsx`) while the collapsed question list doesn't paint it, and `/quiz`'s page-level view model strips it even when the store hands one over (`app/(site)/quiz/__tests__/page-view-model.test.tsx`, with `quiz-board.test.tsx`'s markup check as the independent second guard). |
| Live Lua (app) | `apps/web/src/lib/__tests__/{classic-store,quiz-store,ai-store}.lua.upstash.test.ts`, `describe.skipIf`-gated on `UPSTASH_REDIS_REST_URL`/`_TOKEN`; the `app` CI job brings up `redis` + `srh` (digest-pinned like `docker-compose.yml`) and sets `CTF_LUA_SUITES_REQUIRED=1` so a skip fails the job | The three grading scripts — the scoring authority — EXECUTED against a real Redis, on run-unique keys: `missing`/`already`/`incorrect`/`correct`/`cooldown`/`exhausted`/`mode` verdicts, the exact attempts and solve rows written, that a refused submission writes nothing, the cooldown boundary (refused at `now < lastAtMs + cooldownMs`, graded at equality), the `>=` cap, `maxAttempts = 0` as uncapped, a first-ever submission with a cooldown set (no attempts row, so `lastAtMs` is nil), `solvecount` keyed by the challenge and the two totals by the login, the case-sensitive form chosen only for a `caseSensitive` record, and ai's event path (no flag compare, no attempts row, `source` recorded, a `mode: "flag"` challenge refused). Each of the six single-line Lua mutations the 2026-08-25 review found survivable (already-solved polarity, `and lastAtMs`, login-keyed solvecount, `>` cap, mode refusal, case-sensitive branch) fails at least one of these. The mocked `*.grade.test.ts` suites still pin what the stores hand the scripts (key and argument order); together the two layers cover the chain. |
| Shell (bats) | `setup/test/ctf_setup.bats` | `ctf-setup.sh`'s subcommands against fixture `event.yaml` files: dry-run fork/workflow/mirror/teardown plans, secrets generation, and YAML-parsing edge cases (flow-style config, blank entries, decoy keys) — no real `gh`/`docker` calls needed. |
| Two-reader corpus | `setup/test/corpus/` (fixtures), asserted from both sides by `setup/test/module_readers.bats` and `sync/test/module-readers.differential.test.js` | That `ctf-setup.sh` and `sync/src/config.js` — two `modules:` parsers in two languages sharing no code — ACCEPT and REJECT the same `event.yaml` files, and extract the same targets. Each fixture records its verdict in its filename, so agreeing with the corpus is agreeing with each other. Covers block style at 2/4/8 spaces, flow style on one line and across several, quoted keys, interleaved comments, CRLF, block- and flow-sequence targets, a bare `modules:`, an absent one, unknown keys, merge keys, tabs and sequences where a mapping belongs. The bash side additionally asserts the organizer-visible behaviour (flow style really forks and renders; an unparseable block fails CLOSED in `org` and `doctor` rather than printing "nothing to do"). See [ADR 24](decisions.md#adr-24-tolerating-a-missing-module-vs-rejecting-an-unknown-one). |
| Offline smoke | `scripts/smoke.sh` | The full poll pipeline against fixture services (`test/fixtures/mock-github.mjs`, `test/fixtures/mock-scorer.mjs`, `docker-compose.smoke.yml`): Redis and the `srh` REST proxy work, `sync` ingests fixture score comments, scores match the fixtures, a forged comment is dropped by the trust filter, an unauthenticated `POST /score` is rejected, and — the organizer admin panel's freeze proof — setting `ctf:admin:settings paused` directly on Redis (the same key the app's settings route writes) holds a queued fixture score out of the leaderboard and out of `ctf:sync:status`, then clearing it lets the poller ingest it on the next tick. This is what CI's `smoke` job runs, and needs no live GitHub org, Action runs, or scorer image access. |
| Docker acceptance | `scripts/acceptance-app.sh` | Builds the real `apps/web/Dockerfile` twice — once with an `EVENT_CONFIG_B64` override, once without — and asserts: the custom event name and only the configured targets render, a disabled target never renders, and the default (no-config) build is neutral (no DC34 branding, name "OWASP CTF"). This is the layer that proves the build-time config flow actually reaches rendered HTML, not just the generated TS module. |
| Docker acceptance (scorer) | `scripts/acceptance-scorer.sh` | Builds the scorer image from `scorer/` with the example rubric and closes the scoring loop offline: judge runs against a fake target that passes some probes and fails others, and the script asserts the report's score-action regexes, that no probe internals leak into the comment, that the sync marker parses via the real `sync/src/parse.js`, and that push mode lands on `GET /leaderboard` with rubric-derived points/totals (poll mode — no `SCORE_API` — is exercised too). |
| Docker acceptance (quiz-only) | `scripts/acceptance-quiz-only.sh` | Builds the real app image bound to a `modules: { quiz: {} }` config (no `secure-development` at all), seeds one question and one contestant's answer straight into Redis (no OAuth app in CI to drive real authoring/answering), and asserts against the running app: `/quiz` shows the seeded question by name, `/challenges` 404s, and `/leaderboard` shows the contestant by login with their quiz points — the one assertion a vacuously-up-but-broken app can't fake, since a quiz-only event's leaderboard source is `emptySource` and carries no rows of its own. Separately brings up `sync` through the real `docker-compose.yml` against the same config and asserts it exits `0`, logs the clean no-op reason, and — sampled over several seconds — stays exited rather than being restarted. It also asserts the DOCUMENTED bring-up structurally: `--profile app` must resolve to a line-up with no `scorer` and no `sync` (a quiz-only organizer cannot pull the private scorer image), while `--profile poll --profile app` must still contain both. |
| Docker acceptance (classic-only) | `scripts/acceptance-classic-only.sh` | The classic module's sibling of the quiz-only script, following every one of its design decisions: builds the real app image bound to a `modules: { classic: {} }` config, seeds a challenge and a solve straight into Redis, and asserts `/flags` shows the challenge by title, `/challenges` 404s, `/leaderboard` shows the contestant's classic points by login, and the `--profile app` line-up contains no secure-development service. |
| Docker acceptance (ai-only) | `scripts/acceptance-ai-only.sh` | The ai module's sibling of the quiz-only/classic-only scripts, following the same design decisions: builds the real app image bound to a `modules: { ai: {} }` config, seeds a challenge and a contestant's solve straight into Redis, and asserts `/ai` shows the challenge by title without leaking its flag, `/ai/<id>` 200s while `/ai/<bad-id>` 404s, `/challenges`, `/flags` and `/quiz` all 404, `/leaderboard` shows the contestant's ai points by login, `GET /api/ai/launch-key` mints the keypair internally and serves its public key with no OAuth/cookie/session available, the `--profile app` line-up contains no secure-development service, and `sync` exits `0` and stays exited with nothing to poll. |
| Vacuous-pass sweep | `scorer/tools/vacuous-sweep.mjs` | Points every target's rubric at an in-process HTTP stub that is UP but USELESS (three personalities: empty-200, not-found, server-error) and fails if any challenge passes — a challenge that "blocks the exploit" against a stub proves nothing. Must report 0; wired into CI only once the count reached 0/321. |

CI (`.github/workflows/ci.yml`) carries a `changes` gate (native `git diff`,
no third-party action) plus ten gated jobs — `sync-tests`, `scorer`
(`node --test` + `acceptance-scorer.sh`), `vacuous` (the sweep above),
`shell` (shellcheck + bats, including `deploy/fly/`'s scripts and bats
suite), `smoke`, `app` (vitest + `next build` + the `/` never-prerendered
assertion + `acceptance-app.sh`), `quiz-only`, `classic-only`, `ai-only`, and
`docs` (Jekyll build + link/meta checks). The gate runs only the jobs whose area a
PR touches; a push to `main` runs all ten. The heavier `stock-scores-zero` /
`patched-scores-right` workflows are scoped to judge-relevant scorer inputs,
so a leaderboard-only change doesn't spin up the per-target Maven/gradle
builds.

## Names

Several names orbit "the project" and they are not
interchangeable — the table moved to the
[glossary](glossary.md#the-projects-names), which also defines the terms
(target, module, rubric, probe, marker, …) the rest of this doc uses.
