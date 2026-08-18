---
title: Decisions
---

# Decisions

Numbered architecture decision records for CTF-in-a-box. Each entry is
Context / Decision / Consequences. For how these decisions fit together as
a running system, see [docs/architecture.md](architecture.md). For the
contract a new CTF module must satisfy, see
[docs/modules.md](modules.md). For operator-facing instructions, see
[README.md](https://github.com/dcotelo/ctf-in-a-box/blob/main/README.md).

## 1. Keep the GitHub fork/PR/Action flow — it is the pedagogy

**Context.** The contestant loop could be simplified to "submit a diff" or
"paste a patch" through the app itself, cutting out GitHub entirely.

**Decision.** Keep the full fork → patch → PR → Action-scores-the-PR flow
(README: "fork target app → find + patch the vuln → PR back → GitHub
Actions scores the patch"). The app never accepts code; scoring only
happens through a real GitHub Actions run against a real PR.

**Consequences.** Contestants practice the actual workflow a security
engineer uses to ship a fix (fork, branch, PR, CI feedback), not a
CTF-specific submission form. This is why `pull_request_target` isolation
(decision 9) and oracle discipline (decision 7) matter as much as they do —
the trust boundary is a real CI system, not a sandboxed judge the kit
fully controls. It also means the kit depends on GitHub Actions being
available and configured correctly per target, which is what
`setup/ctf-setup.sh org` exists to automate.

## 2. Single docker-compose box; no Kubernetes in v1

**Context.** A CTF event could run on a cluster for scale/HA.

**Decision.** Ship one `docker-compose.yml` (`caddy`, `app`, `scorer`,
`srh`, `redis`, `sync`) meant to run on a single box — a chapter
organizer's laptop or a small VM, not a cluster.

**Consequences.** Setup is `docker compose ... up -d`; no cluster,
ingress controller, or orchestration knowledge required (README: "One box,
one free GitHub org, no cloud dependencies"). State lives in named Docker
volumes (`caddy-data`, `redis-data`, `sync-state`), so a box reboot doesn't
lose scores. The tradeoff is no horizontal scaling or built-in HA — a
single-chapter-sized event is the target load, not a multi-thousand-person
conference CTF.

## 3. Score transport: poll by default, push optional

**Context.** The scoring Action needs to get a result from the event org
back to the organizer's box, which may or may not have a public URL.

**Decision.** Default to `poll` (`sync` service reads score comments from
GitHub with a GitHub App installation token — org-scoped and auto-expiring);
support `push` (the Action POSTs
directly to `${scorerUrl}/score` with a bearer token) as an opt-in via
`SCORE_INGEST=push` in `.env`.

**Consequences.** Poll mode needs nothing but outbound HTTPS — works
behind NAT, on a laptop, anywhere (`caddy/Caddyfile.poll` has no `/score`
route). Push mode needs a public URL for the box plus org Actions secrets
(`LEADERBOARD_URL`/`LEADERBOARD_TOKEN`) and gets near-instant results
instead of poll's ~30s cadence. `event.yaml`'s
`modules.secure-development.score_ingest` field only documents the
organizer's intent — the operative switch is the `SCORE_INGEST` env var in
`.env`, and nothing syncs the two (README, "Poll vs push"). Neither mode
authenticates against a live scorer yet: both need the scorer's
bearer-token auth mode, and push additionally needs `score-action`'s
`leaderboard-url`/`leaderboard-token` inputs — both unlanded upstream
changes tracked in `docs/operations.md`'s "Status and upstream dependencies".

## 4. SRH as the Upstash-REST proxy in front of local Redis

**Context.** The app's leaderboard/team/hint stores use an
`@upstash/redis`-style REST client, which expects Upstash's hosted REST
API, not a raw Redis TCP connection.

**Decision.** Run `hiett/serverless-redis-http` (`srh`) as a local
Upstash-REST-compatible proxy in front of `redis:7-alpine`, so the app's
Redis client code runs unchanged in self-hosted mode
(`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` point at `srh`
instead of a hosted endpoint).

**Consequences.** No fork of the app's data-access layer for self-hosting.
The cost is a compatibility ceiling: `srh` implements only the
POST-command-array subset of Upstash's REST API — no path-style `GET
/get/<key>` shortcut, for example (`scripts/smoke.sh` asserts the working
subset directly against `srh`). Any future Redis usage in the app must
stay within what `srh` actually supports; this is called out as an open
verification item in `docs/operations.md`'s "Status and upstream dependencies".

## 5. Single score writer: monotonic writes, at-least-once delivery

**Context.** Two independent paths can produce a score for the same
solve — poll's `sync` service and push mode's direct Action POST — and
network failures mean a submission might be retried.

**Decision.** Both paths write through exactly one endpoint, `POST /score`
on `scorer` (`sync/src/submit.js`; `docs/modules.md §2.1`: "there is no
second write path"). The receiving end (`scorer`) is required to treat
writes as monotonic and idempotent on replay; senders may deliver
at-least-once.

**Consequences.** `sync`'s poller leans on this directly: on a submit
failure it un-marks the comment as seen and retries next tick
(`sync/src/index.js`, `tick()`: `rs.seen = rs.seen.filter((id) => id !==
c.id); // retry next tick`), which means the same comment can be submitted
more than once. That's fine because a replay of an already-applied score
is required to be a no-op on the scorer side, not a double-count. A module
implementer MUST NOT invent a second write path (`docs/modules.md §2.1`).

## 6. Poller trust model: author filter before parsing, grammar as key guard

**Context.** Anyone can post a PR comment. The poller must not treat an
attacker-authored comment as a legitimate score, and any value it forwards
becomes a Redis key on the scorer side.

**Decision.** Two independent checks, in order: `sync/src/github.js`
filters fetched comments to `cfg.commentAuthor` (default
`github-actions[bot]`) *before* any JSON parsing happens; then
`sync/src/parse.js` validates the `author` field inside the parsed payload
against the GitHub-login grammar
(`/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}(?:\[bot\])?$/`,
`GITHUB_LOGIN`) before returning a payload.

**Consequences.** A forged comment from an untrusted login never reaches
`JSON.parse`, regardless of what it contains — `scripts/smoke.sh` proves
this with a `mallory`-authored comment carrying a valid `ctf-score` block
that never appears on the leaderboard. The grammar check exists
independently because `author` becomes a Redis key segment downstream on
the scorer; even a comment from the trusted author must carry a
well-formed login before that string is trusted as a key. Any new
transport a module adds must reproduce both checks, not just one
(`docs/modules.md §3.2`: "trust here is entirely the GitHub-authenticated
comment author, not anything in the payload"). The filter itself is
proven today (`scripts/smoke.sh`'s forged-comment case); what it feeds —
a bearer-authed `POST /score` against the real scorer — is not, pending
the same upstream scorer auth mode noted in `docs/operations.md`'s "Status
and upstream dependencies".

## 7. Oracle discipline: pass/fail and points only, never diagnostics

**Context.** A scoring Action's output is visible to the contestant who
triggered it (as a PR comment) and, in push mode, is the payload sent
off-box. Verbose failure output — assertion messages, exploit payloads,
failing test names — would leak information about the rubric.

**Decision.** Contestant-visible scoring output MUST be pass/fail plus
points only (`docs/modules.md §6.2`). Verbose diagnostics stay in the
private workflow log, visible to org admins only.

**Consequences.** This is treated as the cheapest real defense of the
scorer's secrecy — cheaper and more effective than trying to keep the
image itself unreadable (see decision 8). Any new module's scoring
workflow inherits this requirement; it is not something `secure-development`
does uniquely.

## 8. Private scorer image and per-event mirror; access control over obfuscation

**Context.** The scorer image bakes in the challenge rubric. If it leaked
publicly, contestants could read exactly what's being checked for.

**Decision.** Keep `ghcr.io/owasp-ctf/score` private upstream, and have
`setup/ctf-setup.sh org` mirror it into each event org's own private GHCR
package (`docker pull` → `docker tag` → `docker push
ghcr.io/$org/score:latest`), rather than granting every forked repo's
Actions direct read access to the upstream package.

**Consequences.** Forked repos' Actions pull the image with their own
`GITHUB_TOKEN` against the *event org's* package, never against
credentials that reach the upstream org. The organizer must keep the
mirrored package private and grant each target repo read access
explicitly (`ctf-setup.sh org`'s printed manual steps: "Keep package
`ghcr.io/$org/score` PRIVATE," "Manage Actions access → add each target
repo with Read"). This is explicitly access control, not obfuscation:
reverse-engineering a rubric out of a pulled image is assumed possible in
principle: the goal is limiting who can pull it at all, not making the
image itself unreadable — which pairs with oracle discipline (decision 7)
as the actual leak-prevention layer.

## 9. Per-event disposable GitHub orgs; `pull_request_target` isolation

**Context.** Running a CTF against live GitHub repos means untrusted
contestant code exists as real PR branches, and something must run
Actions that need real secrets (a `GITHUB_TOKEN` to pull the private
scorer image) without ever handing those secrets to that untrusted code.

**Decision.** Each event provisions its own disposable GitHub org
(`setup/ctf-setup.sh org` forks each target into it; `teardown` archives
them afterward). Scoring workflows use the `pull_request_target` trigger,
which runs in the base (org) repo's context — where secrets live — while
the untrusted PR code under test executes sandboxed, with no access to
that context.

**Consequences.** Contestant code never sees the organizer's tokens or org
secrets, regardless of what a malicious PR contains. Everything
provisioned for an event (forked repos, mirrored image, installed
workflow) lives entirely inside the disposable org, so teardown (archive
repos, uninstall the GitHub App, delete org secrets) fully retires the event
with no lingering access (`docs/modules.md §7`: "everything a module provisions
for an event MUST be archivable or revocable after the event"). `cmd_org` now
commits the scoring workflow (`ctf-score.yml`) to each fork's `ctf` branch and
disables the forks' inherited workflows automatically.

## 10. `event.yaml`'s module namespace; deliberate, not dynamic, registration

**Context.** The kit is meant to eventually support more than one CTF
vertical (forensics, API security, cloud, …) alongside
`secure-development`, but only one exists today.

**Decision.** Platform-level config (`event`, `github`, `teams`, `hints`,
`admins`) sits at the top level of `event.yaml`; everything vertical-specific
lives under a kebab-case key in `modules:` (`modules.secure-development`).
The config loader (`sync/src/config.js`) and the app's generator
(`apps/web/scripts/generate-event-config.mjs`) both enumerate known module
keys explicitly and throw/fail the build on anything else — no
dynamic/plugin-style loading in v1.

**Consequences.** An organizer who writes `modules.forensics: {...}` today
gets a loud startup failure (`event.yaml: unknown module: forensics (v1
supports only secure-development)`), not a silently ignored block. Adding
a real second module means extending both loaders (and
`setup/ctf-setup.sh`'s `yaml_targets`) to recognize the new key — a code
change, not a config-only addition. `docs/modules.md` is explicit that
this is a v1 constraint, not a permanent architectural stance.

## 11. Vendor the contestant app into `apps/web/`; upstream stays read-only

**Context.** The contestant app (`OWASP-CTF/ctf-owasp-org`) previously
lived as an upstream image pulled at build/deploy time. Making it
event-generic (name, dates, enabled targets) required changes upstream
doesn't currently accept — the upstream repo is read-only for this
project.

**Decision.** Copy the app's source into `apps/web/` in this repo (see
`apps/web/VENDORED.md` for upstream commit/date/reason), build it from
local source (`apps/web/Dockerfile`, context = repo root), and drop
upstream's `.git/`, `.github/`, and `node_modules/` in the process.

**Consequences.** The kit can ship event-config and module-driven UI
without waiting on upstream write access, at the cost of a source fork
that will diverge from upstream over time. `VENDORED.md` records
provenance (exact upstream commit, date, reason) and states the intent to
offer the delta back as a single PR once upstream write access opens —
this is a deliberate, tracked fork, not an untracked copy-paste.

## 12. Build-time config generation over runtime config

**Context.** Event identity (name, dates, targets, branding) needs to
reach the app somehow. A runtime option (read `event.yaml` on every
request, or on server start) was available instead of baking it into the
build.

**Decision.** Generate a typed TS module
(`src/lib/event-config.generated.ts`, gitignored) from `event.yaml` (or
`EVENT_*` env vars, or neutral defaults) as a `prebuild`/`predev`/`pretest`
npm hook (`apps/web/scripts/generate-event-config.mjs`), and have the
app's static `metadata` exports and page content read from it at build
time.

**Consequences.** Static generation and `metadata` exports keep working
exactly as the vendored app already used them — no new runtime
config-fetch code path, no risk of a slow or failing config read blocking
a page render. The tradeoff is explicit and accepted: changing
`event.yaml` requires an image rebuild (`docker compose --profile app
build app`), not just a restart or a config hot-reload; README calls this
out directly under "Rebuilding the app after a config change" so it isn't
a surprise.

## 13. Closed `AppId` union; config selects a subset; unknown values fail the build

**Context.** The target catalogue (`juice-shop`, `dvwa`, `webgoat`,
`securityshepherd`, `vulnerableapp`, `vampi`) is fixed for
`secure-development` in v1; an organizer's `event.yaml` should only be able
to pick a subset of it, never introduce a new one by typo or intent.

**Decision.** `src/lib/apps.ts`'s `AppId` type is a closed six-member
union. `generate-event-config.mjs`'s `validateTargets` rejects any target
not in that set (and rejects an empty targets list), calling `fail()`
(non-zero exit) rather than silently dropping the bad value — mirroring
`sync/src/config.js`'s identical `TARGETS` check.

**Consequences.** A typo'd target name in `event.yaml` (e.g. `dvwaa`)
fails the app's build loudly, at the same point it would fail `sync`'s
config load — one contract, enforced twice, in the two places that read
`event.yaml`. `enabledApps` in `apps.ts` is then a simple filter: catalogue
∩ config, so nav, challenge list, and leaderboard columns for a disabled
target vanish with no per-page conditional logic.

## 14. Neutral defaults; no DEF CON 34 in the platform

**Context.** The vendored app's source (from `OWASP-CTF/ctf-owasp-org`)
carried event-specific branding, copy, and links from the DEF CON 34 event
it was built for.

**Decision.** A zero-config build (no `EVENT_CONFIG`, no `EVENT_*` env
vars) produces a neutral "OWASP CTF" site: `DEFAULTS` in
`generate-event-config.mjs` sets `name: "OWASP CTF"`, empty
theme/dates/location, `ctfStartsAt: null`, and all six targets enabled.
DEF CON-specific fields and copy are removed, not defaulted to empty.

**Consequences.** `scripts/acceptance-app.sh` asserts this as a regression
guard: the default build must contain neither "DEF CON" (case-insensitive)
nor leftover DC34 branding, and must show "OWASP CTF." The platform is
event-agnostic by construction — DC34 was one event that happened to be
the app's original deployment, and its specifics are not baked in as
"the" default anywhere in the generator or the catalogue.

## 15. Timezone-independent date display

**Context.** `event.yaml`'s `event.start`/`event.end` are ISO 8601
timestamps with an explicit offset (e.g.
`2026-10-01T09:00:00-03:00`). The app is built on whatever machine (and
whatever `TZ`) runs `docker build` — which has nothing to do with the
event's own timezone — and the displayed date range must not depend on
that build machine's local time.

**Decision.** `displayDates()` in `generate-event-config.mjs` parses the
wall-clock date textually straight out of the ISO string (`iso.slice(0,
10).split("-")`) rather than constructing a `Date` and reading local
fields, and formats month names via `Intl.DateTimeFormat` pinned to
`timeZone: "UTC"` at `Date.UTC(y, m - 1, d, 12)` (noon UTC, to stay clear
of any date-boundary rounding).

**Consequences.** The rendered date text is identical no matter what `TZ`
the build container runs under — `generate-event-config.test.ts` asserts
this explicitly with `TZ=UTC` and `TZ=Pacific/Auckland` runs producing the
same `"dates"` string for the same input. Getting this wrong would mean
the exact same `event.yaml` renders a different (and wrong, by one day in
either direction) date depending on which CI runner or organizer laptop
happened to build the image.

## 16. Cursor rollback on partial batch failure in the sync poller

**Context.** Each poll tick fetches a batch of comments and may need to
submit several scores to `scorer`. Some submissions in a batch can succeed
while a later one in the same batch fails (network blip, `scorer`
temporarily down); the poller's `since`/`etag` cursor determines what gets
re-fetched next tick.

**Decision.** On any submit failure within a tick, `sync/src/index.js`'s
`tick()` records the failing comment's `updated_at` as `stopAt`, then
advances the cursor's `since` to `stopAt` (not to the batch's latest
timestamp) and resets `etag` to `null` whenever any failure occurred:

```js
rs.since = stopAt ?? result.cursor.since;
rs.etag = stopAt ? null : result.cursor.etag;
```

**Consequences.** The next tick re-fetches starting from the first
failure, which means already-successfully-submitted comments earlier in
that same batch get re-fetched and re-parsed too — not just the failed
one. That's an accepted redundancy: `markSeen`'s per-repo `seen` list
(capped at 500 ids) prevents most of that overlap from being resubmitted,
and any resubmission that does slip through relies on `scorer`'s
monotonic/idempotent write guarantee (decision 5) to be a safe no-op. The
alternative — advancing the cursor past the whole batch regardless of a
mid-batch failure — would guarantee the failed comment's score is silently
dropped. Retry semantics were chosen over cursor precision.

## 17. Public scorer engine, private rubric

**Context.** The upstream scorer image (`ghcr.io/owasp-ctf/score`) is
private with no formal access process — you have to ask the maintainers
directly, and during this kit's development it emerged that the upstream
team is not reachable on demand. That left the kit's scoring path
documented but not runnable by a self-hosted organizer. Meanwhile the
threat model doesn't actually require secrecy of scoring *logic*: the
targets are open source and their vulnerabilities/solutions are already
public (Juice Shop ships an official solutions guide) — this is an
educational CTF. What privacy buys is scoring integrity during the event:
a contestant who can read the exact probes can craft a patch that
satisfies the probe string without fixing the vulnerability
(check-gaming).

**Decision.** Split the scorer into a public engine and a private rubric.
The engine (`scorer/` — serve + judge modes, probe grammar, entrypoint)
and an instructive example rubric (`scorer/rubric.example/`) live in this
repo, public. Organizers bake their own private rubric at image-build time
(`--build-arg RUBRIC_DIR=rubric` after copying it to the gitignored
`scorer/rubric/`) and keep only the built image private during the event —
publishing the rubric afterward as teaching material is encouraged. A
self-contained consumer workflow (`scorer/consumer-workflow.example.yml`)
replaces the dependency on upstream `score-action`: it runs the mirrored
image and posts the comment itself via `github-script`. Authoring and
operation are documented in `docs/scorer.md`.

**Consequences.** The kit is fully self-sufficient — an organizer with a
rubric can run a real event with zero upstream access, scoped precisely:
the only upstream repos touched are the public target projects themselves
(`gh repo fork OWASP-CTF/<target>` — public OSS, no special access).
`setup/ctf-setup.sh org` renders the consumer workflow locally from the
in-repo template and mirrors an organizer-supplied `SCORE_IMAGE` (no
upstream image default), never reading the private upstream scorer repos.
`scripts/acceptance-scorer.sh` proves the whole loop offline. The official
OWASP rubric remains upstream-gated; this decision routes around the
access problem, it doesn't solve it. The comment marker
(`<!-- ctf-score: {...} -->`) now carries the JSON contract end-to-end
between components this repo owns on both sides (judge writes it, sync
parses it), so the contract is pinned by tests rather than by observation
of upstream behavior. The score-action output regexes (title line, `**N /
M** challenges patched`, `not-recorded` marker) are deliberately preserved
verbatim, so an upstream event could adopt this engine later without
touching its existing tooling.

## 18. Exec-probe rubrics for all six targets; the rubric ships public

**Context.** Decision 17 split the scorer into a public engine and a
private rubric, and shipped one instructive example (`juice-shop.yaml`,
three declarative probes). Meanwhile the kit advertised six targets:
`sync/src/config.js`'s `TARGETS` enum accepts all six and the contestant
app renders counts for all six, but enabling any target other than Juice
Shop produced `400 unknown target`.

The rubrics already existed. `OWASP-CTF/dc34-owasp-secure-development-ctf`
holds 321 authored, pass-on-patch challenges across all six targets — but
as executable `node:test` suites, not declarative probes. They need
authenticated sessions (all 40 Security Shepherd challenges, all 19 DVWA
category files), multi-request sequences, structural JSON assertions
(110 VulnerableApp challenges), and timing comparisons (VAmPI's ReDoS
challenge). None of that fits `status` / `bodyIncludes` / `bodyMissing`.

**Decision.** Promote exec-probes from documented follow-up to shipped
feature (`scorer/src/exec.js`), and vendor the upstream rubric into
`scorer/rubric.owasp/`, baked by default. The declarative grammar stays
supported and `rubric.example/juice-shop.yaml` stays as its tutorial; a
rubric directory may mix both shapes, though defining one target twice is
an error. Upstream is treated as **read-only**: `scripts/vendor-rubric.sh`
clones at a pinned SHA recorded in `PROVENANCE.md` and has no push path.

The rubric ships **public**, reversing decision 17's posture. This CTF is
educational, all six targets are open source, and their solutions are
already published. The check-gaming exposure decision 17 guarded against
is accepted as a trade-off rather than treated as a blocker.

**Consequences.** All six targets score out of the box; `event.yaml` can
name any subset. Points come from `catalogue.<target>.json`'s `difficulty`
rather than a YAML `points:` field, so the price list has one source.
Challenge ids are the catalogue key lowercased — the keys are CamelCase
and all 321 fail `RUBRIC_ID`, while lowercasing collides on none.

The kit now runs untrusted-adjacent code in the judge: exec children are
`node --test` processes spawned inside the scorer container. They were
already running contestant-patched application code as a sibling
container, so this widens the existing boundary rather than crossing a
new one, but it is a real change to what the judge executes. Name it
precisely: those children inherit the scorer's mounted
`/var/run/docker.sock` and actively use it — Security Shepherd's vendored
helpers `docker exec` the MariaDB and Tomcat containers by name to
provision the shared attacker account — so a rubric test file reaches the
host daemon, not just the app under test. What holds that boundary is the
vendoring discipline rather than a sandbox: upstream is read-only,
`scripts/vendor-rubric.sh` clones a pinned SHA and has no push path, and
`PROVENANCE.md` records exactly which commit was copied.

Oracle discipline (decision 7) is unaffected — `ctf-score.md` still
carries challenge name, points, and ✅/❌ only. Test output, assertion
text, and file names never reach the contestant-visible comment.

Check-gaming is now mitigated by rubric *shape* rather than secrecy:
exec probes assert timing and response structure, which a patch cannot
satisfy without changing real behaviour the way a `bodyMissing` substring
can be.

All six targets now genuinely score `0 / N` against their unpatched
upstream image, verified by `scripts/acceptance-target.sh`: vampi 9,
vulnerableapp 110, juice-shop 38, dvwa 55, webgoat 69, securityshepherd 40
— 321 challenges, 668 points across the six.

A known scoring-fidelity gap ships with this. Security Shepherd's vendored
`extractSolutionKey` helper accepts any 32-128 character hex run found in
the response. At least one challenge (`Challenge-10-IDOR-2`) echoes the
attacker-supplied identifier — itself pure hex — back into the page
precisely when a *correct* patch blocks the lookup, so the helper reads a
"solution key" out of noise and the challenge scores as unpatched however
good the fix. The bias runs toward "not patched," so the stock-scores-zero
gate is unaffected and no contestant gains a free point; the cost is that
one Shepherd challenge can under-credit a correct patch. The rubrics are
vendored read-only, so the fix belongs upstream — tighten the helper to
require a result-key-shaped match rather than any bare hex run. This is
already recorded in `docs/operations.md`'s "Status and upstream dependencies" list; keep
the two consistent.

## 19. Organizer admin panel: runtime override layer

**Context.** Everything up to this point is either build-time config
(`event.yaml`, decision 12) or a one-shot event of no return (a score
write). An organizer running a live event needs something in between: a
way to see the pipeline is healthy, and a way to intervene — hold
ingestion during an incident, or adjust hints — without a rebuild or a
restart, and without giving up the kit's no-cloud, single-box posture.

**Decision.** Add a small runtime-override layer living in the same Redis
the rest of the kit already uses: `ctf:admin:settings` (a hash: `paused`,
`hintsEnabled`, `hintCost`, plus `updatedBy`/`updatedAt`) and
`ctf:admin:audit` (a capped list of every change, written atomically with
the change via one Lua script — a setting can never land without its
audit line). Every reader applies **override-else-default** precedence:
an explicit value in `ctf:admin:settings` wins, an absent field falls
through to the build-time default (`hint-store.ts`'s `resolveHintConfig`:
`s.hintsEnabled ?? HINTS_ENABLED`) — `??`, not `||`, so an explicit
`false`/`0` override is honored rather than treated as "unset." Access is
gated by `event.yaml`'s existing `admins` allowlist (case-insensitive
GitHub login match, `apps/web/src/lib/admin-auth.ts`), the same list
`event.yaml.example` already asked organizers to fill in — no new secret,
no new identity system.

The headline control, **freeze, means freeze ingestion — not stop
execution.** Pausing never touches fork Actions or GitHub: contestants'
PRs keep getting judged and commented on exactly as before. In poll mode,
`sync`'s `tick()` checks the pause flag first and skips the whole
fetch/parse/submit loop while paused, leaving the per-repo cursor and ETag
untouched — a queued score is deferred, never lost, and ingests normally
on the next tick after the organizer clears the flag. In push mode,
`scorer`'s `POST /score` returns `503` while paused, so a contestant's
Action retries rather than having its submission silently dropped. Both
readers fail open on a Redis error (a transient Redis blip must not freeze
a live event by accident), and `scripts/smoke.sh`'s freeze stage proves
the poll-mode path directly against Redis (the app isn't in the smoke
profile, but `sync` reads the identical key either way).

**v1 scope boundary.** Shipped: status visibility (poller heartbeat, last
error, leaderboard freshness) and flow control (freeze/unfreeze, hint
enable/cost). Deliberately deferred, each for a reason: **score
adjustments** (no manual point-editing UI — the single-writer model,
decision 5, is a load-bearing invariant, and a manual override path would
be a second writer in disguise); **player removal** (no ban/disqualify
control — the kit has no notion of a removable "player" independent of a
GitHub identity, and forging that model is a larger feature than a v1
admin panel warrants); **GitHub-workflow control** (no start/stop/rerun of
Actions from the panel — that is GitHub's surface, not this kit's, and
reaching into it would mean the panel holding GitHub credentials with
write scope beyond what anything else in the kit needs).

**Known limitation, accepted rather than fixed in v1: the hint toggle is
only live at the reveal boundary.** `resolveHintConfig()` (and therefore
`revealHint`, called by the `/api/hints` reveal route) resolves the
`hintsEnabled`/`hintCost` override live, so a flip takes effect on the very
next reveal attempt. But `getViewerHints`, `getHintPenalties`, and
`getHintAvailability` — which drive the challenges-page hint button, the
hint-notice banner, and the leaderboard's hint-penalty display — all still
gate on the module-level `HINTS_ENABLED` constant, resolved once from the
build-time env var. An organizer flipping hints mid-event changes whether
a hint **can be bought** instantly; it does not instantly change whether
the UI **offers** the button, or whether the read-time penalty display
reflects it. Making those three call sites live too is future work, not a
bug fix — it is out of scope for this decision because it touches
statically-rendered page output and cached leaderboard reads, not just a
single write path.

**Consequences.** The admin panel adds no new infrastructure — no new
service, no new dependency, same Redis, same `srh` proxy, same allowlist
identity source as everything else in the kit. The trade-off is the
limitation above: v1 ships a toggle whose effect is real but partial, and
that partiality must stay documented (README, this entry, and
`docs/architecture.md`'s "Organizer admin panel" section) rather than
implied to be complete.
