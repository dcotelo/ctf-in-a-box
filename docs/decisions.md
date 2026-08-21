---
title: Decisions
---

[← Docs home](index.md)

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

> **Amended by [#24](#24-tolerating-a-missing-module-vs-rejecting-an-unknown-one).**
> This decision describes **two** enumerations to extend for a new module. There
> are now **three**: `setup/ctf-setup.sh`'s `KNOWN_MODULES` joined them when
> provisioning learned to skip a module set with no `secure-development`. The
> reasoning below is unchanged — only the count is. See
> [#32](#32-scheduled-windows-evaluated-at-read-time-in-three-readers) for the
> other place this kit duplicates a rule across independent readers on purpose.

**Context.** The kit is meant to eventually support more than one CTF
vertical (forensics, API security, cloud, …) alongside
`secure-development`, which is still the only *scored* one.

**Decision.** Platform-level config (`event`, `github`, `teams`, `hints`,
`admins`) sits at the top level of `event.yaml`
(**amended** — `hints` and `teams` are gone; both were declared here and never
read, see [#31](#31-one-hint-switch-capability-split-from-policy));
everything vertical-specific
lives under a kebab-case key in `modules:` (`modules.secure-development`).
Enablement is presence — a module is on because its key is there, off because
it isn't; there is no `enabled:` flag. The config loader
(`sync/src/config.js`) and the app's generator
(`apps/web/scripts/generate-event-config.mjs`) both enumerate known module
keys explicitly and throw/fail the build on anything else — no
dynamic/plugin-style loading in v1.

**Consequences.** An organizer who writes `modules.forensics: {...}` today
gets a loud startup failure (`event.yaml: unknown module: forensics (known
modules: secure-development, quiz, classic)`), not a silently ignored block.
Adding a real second module is a code change, not a config-only addition, but
the two enumerations play different roles and both must be extended:

- `apps/web/scripts/generate-event-config.mjs`'s `MODULE_VALIDATORS` — the
  ids the app will *render*, each with its own config validator. Paired with
  `apps/web/src/lib/modules.ts`'s `REGISTRY`, which supplies display name,
  description, and optional nav entry.
- `sync/src/config.js`'s `KNOWN_MODULES` — the ids the poll service will
  *tolerate* in the same file. Both services mount the same `event.yaml`, so
  an id the app accepts and `sync` rejects crash-loops the poller and silently
  freezes the leaderboard; the lists must stay in step. Tolerating an id is
  not serving it: `sync` scores exactly one module, named by the separate
  `MODULE` literal, and still requires `modules.secure-development` to exist.

`setup/ctf-setup.sh`'s `yaml_targets` needs **no** change for a new module: it
is scoped to the `secure-development:` block by construction (it awk-ranges
from that key to the next line at equal-or-lower indent) and provisions that
module's forks only. A module that needs its own provisioning adds its own
step rather than widening this one. `docs/modules.md` is explicit that the
single-scored-module state is a v1 constraint, not a permanent architectural
stance.

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
through to the default (`hint-store.ts`'s `resolveHintConfig`:
`s.hintsEnabled ?? HINT_DEFAULT_ENABLED`) — `??`, not `||`, so an explicit
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

**Known limitation, accepted rather than fixed in v1 — since RESOLVED by
[#31](#31-one-hint-switch-capability-split-from-policy), which routed the
three read paths below through `resolveHintConfig` and retired the env var
entirely. The paragraph is kept as the record of what v1 shipped: the hint
toggle was only live at the reveal boundary.** `resolveHintConfig()` (and therefore
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

## 20. Landing-page frame is code; module content is contributed, not organizer-authored

**Context.** The landing page hardcoded `secure-development`'s own pitch — a
tagline, a hero paragraph, four "how it works" steps, a "please use AI"
section — as if it were the platform's own copy, the same problem decision
14 solved for event branding, but for a module's sales pitch instead of the
event's name. Composing the page from whatever modules an event actually
enables meant deciding, up front, who authors what.

**Decision.** The platform frame stays code, unconditionally: `app/page.tsx`
owns the logo, event name, dates, countdown, its own CTAs (how to
play/leaderboard/Discord), and the progress-tracking card, none of it
organizer-editable at runtime. Each enabled module instead contributes its
own landing-page content — tagline, hero paragraph, a "what to expect"
heading/lede, numbered steps, an optional CTA, an optional extra section —
through a `home` block on its registry entry (`src/lib/modules.ts`), read at
request time and rendered inside that frame. Rejected: making the platform's
own hero copy admin-editable, e.g. a rich-text or Markdown field an organizer
could set per event. That needs a real sanitisation story for
organizer-authored markup reaching every contestant's browser, in exchange
for a rebranding need that's already covered — the event name (decisions 12
and 14) handles what the event is called, and the per-module title/blurb
override (`docs/modules.md §5.1`) handles what each module is called. There
was no remaining gap to justify taking on HTML sanitisation for.

**Consequences.** An event's homepage always looks and functions like the
kit — frame, countdown, nav, CTAs — and only the module-specific pitch
changes with which modules are enabled: a quiz-only event's landing page
never mentions forking a repo or opening a PR, and a two-module event gets
two "what to expect" sections with no per-page conditional logic added for
it. Because `home` carries no organizer-editable field, there is nothing on
this page that needs HTML sanitisation, unlike the rejected alternative
would have required.

## 21. Module identity resolution makes every page dynamic

**Context.** An organizer's title/blurb override for a module (decision 19's
runtime-override layer, extended to module naming) has to show up in the
nav, the leaderboard, the module's own page header, its admin tab label, and
its landing-page section heading. The root layout that renders the nav had
no Request-time API of its own (no `cookies`/`headers` call), so Next
happily prerendered it at **build** time — against an Upstash that is
deliberately unreachable during the Docker build (see `apps/web/Dockerfile`)
— and baked that one-shot, fail-open fallback (registry defaults) into the
static HTML for every route that didn't otherwise opt out of prerendering.
An organizer's rename would then only ever appear on the handful of routes
that already had their own Request-time API (`/admin`, `/leaderboard`,
`/profile`, `/gate`); everywhere else the nav was silently and permanently
wrong, with no error raised anywhere to say so.

**Decision.** `getResolvedModules()` (`src/lib/resolved-modules.ts`) calls
`await connection()` before its settings read. This has no effect on the
data returned; its only job is to tell Next this function needs Request-time
information, which forces the root layout — and therefore every route under
it — to render dynamically, per request, instead of being statically
prerendered at build time. Rejected alternative: wrap the header/nav in
`<Suspense>` so the rest of the shell could stay a static, prerendered shell
around a dynamically-streamed nav. Declined because a `Suspense` fallback
has to render *something* while the real per-request read resolves, and the
only sensible fallback is the registry-default nav — so a contestant loading
the page right after a rename would see the *old* module name for a moment,
then have it swapped out from under them. That is a worse failure mode than
uniformly dynamic rendering, which never shows a wrong name at all. CI
carries a regression gate for this class of bug (`.github/workflows/ci.yml`,
after the app build): it fails if `apps/web/.next/server/app/index.html`
exists, since a unit test cannot detect a prerendering regression — only the
build output can.

**Consequences.** Every page under the root layout is dynamically rendered
per request now; there is no static shell for the nav. That is the accepted
cost of the fix: it is what makes an organizer's rename live on the very
next request everywhere, matching the override-else-default precedence the
rest of the runtime-override layer already promises (decision 19).
`getResolvedModules()` is wrapped in React's `cache()` so the settings read
is deduped within one request — the root layout's nav and a page's own
`generateMetadata`/body can all call it and only the first pays for the
Redis round trip — and it still fails open on a settings-read error,
rendering the registry-default nav rather than an empty one.

## 22. Resolved modules are identity-only, deliberately

**Context.** A resolved module (registry defaults merged with the
organizer's title/blurb override) is handed to both server code and Client
Components — the admin panel's tab shell, the leaderboard. Two fields on the
underlying `ModuleDef` don't survive that trip safely: `displayName` and
`description` are exactly the registry defaults that `title`/`blurb` exist to
replace, and the registry's copy blocks — `home`'s `intro`/`steps`,
`guide`'s `steps`/`example`, and `rules` itself — are **functions** — React's
flight serializer throws "Functions cannot be passed directly to Client
Components" the instant a function-valued prop crosses into one.

**Decision.** `ResolvedModule` (`src/lib/modules.ts`) is defined as
`Omit<ModuleDef, "displayName" | "description" | "home" | "guide" | "rules" |
"faq" | "terms" | "routeCard"> & { title: string; blurb: string }` — every
problem field is dropped from the object as well as the type, not merely
shadowed by its replacement. Server code that needs a module's page content
goes through separate, server-only accessors — one per dropped copy block,
`getModuleHome(id)` through `getModuleRouteCard(id)`
(`src/lib/resolved-modules.ts`) — which return the raw
copy blocks, functions included, straight off the registry, never off a
`ResolvedModule`; callers must be Server Components, calling `intro()`/
`steps()`/`example()` there and passing only the resulting plain data
downward.

**Consequences.** Reading `.displayName`/`.description` off a resolved
module — silently rendering the registry default instead of the organizer's
override — is a compile error, not a property access that quietly returns
`undefined`. And no resolved module can ever carry a function value across
the RSC boundary, so a future module defining `home` cannot accidentally 500
`/admin` or `/leaderboard` by having its copy blocks attached to the same
object those pages already pass to Client Components. The omissions are
guarded by tests (`modules-resolve.test.ts`), which assert a resolved module
has no `displayName`/`description`/`home`/`guide`/`rules` key at all, and
scan it recursively for any function value — including a compile-time
assertion on the type itself — not just that today's consumers happen not to
read them.

## 23. `/how-to-play` gets its own registry field, not a reuse of `home.steps`

**Context.** Decision 20 composed the landing page from each module's `home`
block. `/how-to-play` and `/rules` had the same defect and worse: ~29
references to patching, forks and pull requests, with no module awareness at
all, so a quiz-only event handed contestants a step-by-step guide to a game
it was not running. The open question was where that page's copy should come
from — reuse `ModuleHome.steps`, or give the guide its own registry field.

**Decision.** Its own field, `guide` (`ModuleGuide`), plus a `rules` field
for `/rules`. The two step lists are not the same copy at different lengths:
`home.steps` is four short cards that *pitch* the event ("Patch it and open a
PR. Fix the vulnerability in your fork…"), while the guide's five *instruct*
a contestant through their first submission, and the guide additionally
carries a loop callout, a callout above the steps, a seven-step worked
example with code blocks, "good to know" caveats and a scoring paragraph that
have no landing-page counterpart. Reusing `home.steps` would therefore have
had to either change what the landing page says or change what the guide
says. The constraint that *is* enforced is the one that matters: no string is
written twice — a given sentence lives in `home` or in `guide`, never both,
so there is exactly one place to edit it. Rejected: a single merged copy
block for both pages (it would have to grow a "which page is this for?"
discriminator on every field), and leaving the guide in the page behind
`isModuleEnabled` gates (that keeps module copy in platform code, which is
what decision 20 exists to stop).

**Consequences.** A quiz-only event's `/how-to-play` and `/rules` describe
the quiz, and a secure-development event's read exactly as they did before
the split — verified by rendering both pages before and after the change and
diffing the HTML byte for byte. The guarantee is held by suites that assert
ABSENCE against a deliberately enumerated secure-development vocabulary
(`app/(site)/__tests__/secure-dev-terms.ts`), narrowing a term rather than
dropping it when it risks a false positive — the previous round's list
checked "pull request", "fork" and "Browse targets" but not "patched", which
was the one string that had actually leaked, and dropping "target" over
`target="_blank"` left prose about targets sailing through until it came back
as a bounded pattern. The list is self-verifying: a companion test renders
the pages that ARE supposed to carry this vocabulary and fails if any term
matches nothing, so a term cannot rot into decoration while the absence
assertions keep passing. Copy stays plain data rather
than JSX (`Copy`/`CopySegment` covers the emphasis and links a sentence needs
inline), so the registry remains importable either side of the server
boundary, and the new fields are stripped from `ResolvedModule` for the
reason decision 22 gives.

## 24. Tolerating a missing module vs rejecting an unknown one

**Context.** Two independent readers parse the same `event.yaml` for module
keys and share no code: `sync/src/config.js` (JS, the poller) and
`setup/ctf-setup.sh` (bash, provisioning) — AGENTS.md's lockstep rule
requires them to agree in behaviour anyway. Before this decision, `sync`'s
`loadConfig` treated an absent `modules.secure-development` block exactly
like an unknown module key: both threw, crash-looping the poller on a
quiz-only `event.yaml` the app itself was happy to build and run. The two
situations are not the same failure. A module this build knows about but
that isn't configured for this event is a legitimate config choice — nothing
for `sync` to poll. A module key this build has never heard of is a typo or
a vertical that was never wired into this reader — the deliberate-
registration model in [docs/modules.md §1.2](modules.md#1-module-identity--config-block)
means a new vertical is always a code change, never config alone, so an
unrecognized key can't mean "a module I haven't heard of, ignore it."

**Decision.** Tolerate a missing `secure-development` block; keep rejecting
an unknown key, in both readers, and keep an absent `modules:` block itself
an error in both. In `sync/src/config.js`, `loadConfig` returns `null` when
`modules.secure-development` is absent — `if (!mod) return null;` — while an
unknown key or a missing `modules:` object still throws. `sync/src/index.js`'s
`main()` treats `null` as "nothing to do": it logs `ctf-sync: no polled
module enabled, nothing to do` and returns (exit 0) before touching
`loadState`/`makeRedis`/the poll loop. `setup/ctf-setup.sh` mirrors the same
split with its own `KNOWN_MODULES` list and `check_known_modules`/
`has_module`/`yaml_has_modules_block` helpers: a present `modules:` block
that simply lacks `secure-development` is fine (`cmd_org`/`cmd_render`/
`cmd_doctor` each check `has_module secure-development` and skip their
fork-based work with an informational message instead of erroring), while an
absent `modules:` block or an unrecognized key is a hard error — the same
two checks `sync/src/config.js`'s `loadConfig` makes.

`check_known_modules` is called only by `org`, `render`, and `doctor` — the
three commands that actually consume module keys — deliberately not by
`teardown`, `app-manifest`, or `oauth-app`. `teardown` is the recovery path
for an event whose config may now be wrong in some way; gating it on config
validity would strand an organizer who typo'd a module name with already-
forked repos they can no longer tear down through the tool. `app-manifest`/
`oauth-app` open GitHub UI flows with no functional dependency on module keys
at all.

The compose `restart:` policy for `sync` changed from `unless-stopped` to
`on-failure` alongside this, because `unless-stopped` restarts a container
regardless of its exit code: a clean `exit 0` from the new "nothing to do"
path would have been indistinguishable from a crash and looped forever.
`on-failure` only restarts on a genuine nonzero exit.

**Consequences.** A quiz-only `event.yaml` (`modules: { quiz: {} }`, no
`secure-development` block at all) boots on `--profile app` alone (ADR 26)
and runs `sync` to a single clean exit if `--profile poll` is passed anyway,
and `ctf-setup.sh org`/`render`/`doctor`
report "nothing to provision/check" instead of failing. An organizer who
typos a module name, or omits `modules:` entirely, still gets a loud failure
in both readers — and can still run `teardown` to recover already-forked
repos regardless of what's currently wrong with `event.yaml`.
`scripts/acceptance-quiz-only.sh` is the CI gate proving the `sync` half end
to end, including that the restart-policy change holds (it samples
`RestartCount` after the exit, not just the exit code once). The two readers
still share no code — a third module key is still a by-hand addition to both
`KNOWN_MODULES` lists, same as before this decision.

**Agreement is now tested, not asserted.** "Two readers must behave the
same" broke twice on its own: first when `sync` threw on a missing module,
then when `ctf-setup.sh`'s hand-rolled reader — which only understood
2-space block indentation — returned zero keys for the flow style
(`modules: { quiz: {} }`) these very docs print, so `org`/`render`/`doctor`
exited 0 having provisioned nothing while `sync` was perfectly happy. Two
rules fell out of that. First, the bash reader FAILS CLOSED: it parses block
style at any indent, flow style, quoted keys, comments and CRLF, and it
*errors* on anything it cannot confidently parse rather than reporting "no
modules" — a silently empty result is indistinguishable from a legitimately
quiz-only event, which is what made the bug invisible. `has_module` aborts
rather than answering "absent" on a parse failure, because every caller
spells it `if ! has_module …; then <skip everything>`. Second,
`setup/test/corpus/` is a shared corpus of `event.yaml` shapes (block at 2/4/8
spaces, flow on one line and across several, quoted keys, tabs, a bare
`modules:`, an absent one, unknown keys, merge keys, sequences where mappings
belong, targets as flow *and* block sequences). Each fixture records its
verdict in its filename; `setup/test/module_readers.bats` runs the corpus
through the bash reader and `sync/test/module-readers.differential.test.js`
runs the same files through `sync`'s, so agreeing with the corpus is agreeing
with each other. The corpus immediately found one live divergence — `modules:
[]` was accepted by `sync` (`typeof [] === "object"`) and rejected by bash —
now closed with an `Array.isArray` guard. A second one turned up later, in
the dangerous direction: YAML forbids repeated mapping keys, so both JS
readers throw on `quiz: {}` twice over (or on a second top-level `modules:`
block) while the bash reader took first-wins and provisioned whatever the
first copy said — `ctf-setup.sh org` exiting 0 having forked nothing, with the
failure surfacing at app build much later. The bash reader rejects both
shapes now, with four fixtures pinning it. One asymmetry is left open
deliberately: `modules: *alias` is rejected by bash (it resolves no anchors)
and accepted by the JS readers. That points the safe way — the strict reader
is the one that fails, loudly, at provisioning time.

The third reader, `apps/web/scripts/generate-event-config.mjs`, is not in that
corpus (it runs under the app's own vitest suite, at image-build time rather
than boot time) and it is deliberately one notch stricter: a *present but
empty* `modules: {}` fails its build ("at least one module is required")
while `sync` and `ctf-setup.sh` treat it as a valid config with nothing
enabled. That asymmetry is safe in the direction it points — the strict
reader fails loudly at build time, it does not silently provision less — but
it is the known gap to close if the corpus is ever extended to all three.

## 25. Building a leaderboard with no scoring backend

**Context.** `secure-development` disabled means there is no scorer, no
lambda, and no Upstash scoring data for this event at all — every
`LEADERBOARD_SOURCE` value names a backend that was never deployed. Before
this decision, `getLeaderboardSource` still tried to honor that env var
(falling back to the mock source on a bad value), and the board itself was
built only from rows the source supplied — a contestant with quiz points but
no scored submission had nothing to attach them to, because there was no
"attach points to a row" step that could run before a row existed. A
quiz-only event is exactly this case for every contestant, all the time: no
row for anyone, ever, on the scored path.

**Decision.** Two changes, working together. First,
`getLeaderboardSourceMode` (`src/lib/leaderboard/source.ts`) checks
`isModuleEnabled("secure-development")` *before* the env var and,
deliberately not overridably by it, resolves straight to a new `"empty"`
mode — `emptySource` (`src/lib/leaderboard/empty.ts`) returns no entries, no
teams, and every capability `false`. This is deliberately not the mock
source: placeholder data on a board that also carries real quiz points would
be indistinguishable from a contestant's actual standing. Second,
`withModuleContributions` (`src/lib/leaderboard/module-contributions.ts`)
now creates a row for any login that holds quiz points and has no entry from
the source — the board's login set becomes the union of the source's logins
and the logins holding module points, matched case-insensitively. A created
row has every scorer-supplied field (`patched`/`failed`/`total`/`apps`)
genuinely zero, because there is no scoring entry behind it to report. Team
rows get the same treatment one step later: `withTeamStandings` synthesises
membership-only rows (from live team records) when the source has no team
concept, and now calls `withTeamQuizPoints` on them so a quiz-only event's
default board — teams, whenever teams exist — doesn't open on every team
tied at zero while the individual view shows real points.

**Quiz points are ADDED, secure-development points are ATTRIBUTED, and that
verb difference is preserved everywhere in this decision.** `entry.points`
already holds `secure-development`'s score when that module is enabled (the
scorer computed it), so attributing it into a `ModuleProgress` block reports
an existing figure; adding it again would double-count. The quiz never
submits through `scorer`'s `POST /score` — the app holds no writer token for
that endpoint — so its points exist nowhere else, and must be added onto
whatever total the row already has (`0` for a created row) rather than
attributed from it. A created row therefore has nothing to double-count in
the first place: its only points are the ones just added. Team quiz totals
are deduped by *question*, not summed per member — `getTeamQuizTotalsBatch`
reads every member's answer hash directly and unions the question ids, so a
question three teammates all answered correctly still counts once, the same
rule already used for shared secure-development flags.

**Consequences.** A quiz-only event has a real, populated leaderboard from
first launch: a contestant who has answered nothing has no row (same as
today, on any event), and a contestant with quiz points has a row the moment
they earn any, with no scored submission required. `LEADERBOARD_SOURCE` is
inert while `secure-development` is disabled — pointing it at `lambda` or
`upstash` on a quiz-only event does nothing, by design, because there is no
backend there to point at. `scripts/acceptance-quiz-only.sh` proves the
individual-row half of this against a real built app and a real Redis; the
team half is covered at the unit level
(`src/lib/leaderboard/__tests__/team-standings-quiz-only.test.ts`). The
empty source's `getUser` also returns `null` unconditionally, which
`/profile` already handles as "no scored profile" for any unscored login —
so the page renders the module blocks it can build on its own rather than
gaining a second code path for "no backend at all."

## 26. Compose profiles follow the enabled modules

**Context.** `docker-compose.yml` put `sync` behind `profiles: ["poll"]` but
left `scorer` in the default (profile-less) set, and `app` carried
`depends_on: [srh, scorer]`. Both of those quietly assume every event scores
PRs. On a quiz-only event they are false, and expensively so: `docker compose
--profile poll --profile app up -d` — the command docs/hosting.md called
"safe to run as-is on a quiz-only event" — resolved to `redis srh scorer app
caddy sync` and tried to pull `ghcr.io/owasp-ctf/score:latest`, the
maintainers' PRIVATE image, which a quiz-only organizer has no access to and
no reason to want. The documented boot command for the branch's headline
feature could not be run.

**Decision.** Profiles express MODULE membership. `app` (the contestant app)
is always on. `poll` and `push` — the two `SCORE_INGEST` modes — carry
everything `secure-development` needs, which is `sync` *and* the `scorer`; the
scorer is as much a part of that module as the poller is, since it exists to
judge PRs against forked targets. So `scorer` gains `profiles: ["poll",
"push"]`, and `app` loses `scorer` from its `depends_on` (it reads the scorer
lazily over HTTP per request, and `depends_on` never waited for readiness
anyway — it only ever expressed start order, at the cost of dragging the
scorer into every `up`).

The alternative was a distinct `scored` profile. Rejected: it would have
added a third flag to the primary, well-worn command in every doc, script and
deploy module, and forgetting it fails SILENTLY at runtime (an app with no
scorer behind it) rather than loudly at bring-up. Putting the scorer in the
ingest profiles instead leaves the poll-mode command byte-identical — which is
what almost every organizer runs — and confines the change to the new,
documented quiz-only path.

**Consequences.** `--profile poll --profile app` is unchanged (`redis srh
scorer app caddy sync`); push mode now needs `--profile push` where the
scorer used to arrive by default; a quiz-only event boots with `--profile app`
alone. `ctf-setup.sh wizard` prints and runs the line-up that matches the
`event.yaml` it just configured, so the organizer never picks by hand.
`scripts/dev-stack` and `scripts/smoke.sh` name their services explicitly
(and compose auto-enables a profile for an explicitly targeted service), so
both are unaffected. `scripts/acceptance-quiz-only.sh` gained the structural
assertion that catches this class of bug directly: the documented quiz-only
line-up must contain no `scorer` and no `sync`, and the scored line-up must
still contain both — a check the rest of that gate structurally could not
make, since it builds the app by hand and brings `sync` up with `--no-deps`.

## 27. Two flag hashes rather than one

**Context.** The classic module's admin authoring surface needs to prefill
an existing challenge's flag when an organizer opens it for editing — the
same reasoning `quiz`'s answer-key prefill already established: an edit form
that starts blank forces a retype from memory, and a mistake there silently
redefines what counts as solved for every contestant, with no diff and no
warning. Grading, meanwhile, needs a value it can compare a submission
against cheaply and exactly. A single hash can't serve both needs well.
Storing only the flag AS AUTHORED means grading has to normalize it (trim,
case-fold, Unicode-normalize) on every submission — cheap, but it also means
the *comparison* target is derived at read time, one more place the
authoring and submission recipes could quietly diverge. Storing only the
*normalized* form solves grading cleanly but throws away the organizer's
original casing/whitespace, so the edit form can only ever show a
canonicalized flag, not what was actually typed.

**Decision.** Store both, as two separate hashes keyed by challenge id:
`ctf:classic:flag` (the flag AS AUTHORED, trimmed but otherwise verbatim —
read by exactly one function, `listChallengesForAdmin`, itself reachable
only from the `requireAdmin`-gated `GET /api/admin/classic`) and
`ctf:classic:flagnorm` (`normalizeFlag(flag)` — trim, Unicode NFC-normalize,
lowercase — the ONLY value grading's Lua script ever reads or compares
against). `upsertChallenge` writes the challenge record and both flag hashes
in one Upstash pipeline call, so all three can never observably disagree —
a challenge can never be live with a `flagnorm` belonging to a previous
version of its flag. `listChallenges`, the one list function a
contestant-facing route or the leaderboard may call, issues no command
against either flag hash, and its `Challenge` return type has no field that
could carry one even by accident — the split is a type boundary, not a
habit callers have to remember.

**Consequences.** The admin edit form always shows exactly what an organizer
typed, so a typo fix is a diff against real text instead of a blind
retype-and-hope. Grading never normalizes at submission time — it reads an
already-normalized value straight off `flagnorm` and compares whole strings
with Lua's `==`, so there is nothing for the grading path to get subtly
wrong on a given submission. The cost is genuinely small: one extra hash
field per challenge, written together with the other two so there is no
window where they could disagree, and deleted together in
`deleteChallenge`. The two hashes are deliberately readable by different
functions (`listChallengesForAdmin` for `flag`, the grading script alone for
`flagnorm`) rather than merged into one record type, which is what makes
"the contestant path never touches a flag" a property the compiler can
check rather than a discipline every future call site has to maintain by
hand.

## 28. A hand-rolled Markdown renderer rather than a library

**Context.** A classic challenge's description is organizer-authored content
that needs a little formatting — bold, italics, inline code, lists, a code
block, an occasional link — rendered for every contestant who opens the
board. Every mainstream Markdown library (`marked`, `markdown-it`,
`remark`-to-HTML) produces an HTML *string*, which then has to be either
rendered with `dangerouslySetInnerHTML` or run through a sanitizer
(DOMPurify and similar) before it can be. Either choice makes an
organizer-authored field — admin-gated, but authored by potentially many
organizers across many events, and the one place on this platform closest
to "arbitrary rich text from a semi-trusted party" — a standing injection
surface: a sanitizer allowlist can regress with a library upgrade, and a
`dangerouslySetInnerHTML` call is one `git blame` away from being copied
somewhere it shouldn't be.

**Decision.** `apps/web/src/lib/markdown.ts` hand-parses a small, fixed
subset directly into a typed node tree — `MdBlock`/`MdInline` unions for
paragraphs, fenced code blocks, ordered/unordered lists, strong/em/inline
code/links — and never into an HTML string at any stage. Two passes:
`parseMarkdown` splits input into blocks (fenced code, lists, paragraphs,
each capped by `MARKDOWN_MAX`), and `parseInline` runs a small ordered
pattern set within a block (code wins over emphasis, so `` `**x**` ``
renders literally). Links go through `safeHref`, an explicit allowlist of
exactly three schemes (`http:`, `https:`, `mailto:`) — control characters
and whitespace are stripped from the raw target BEFORE parsing (closing
`java\nscript:`/`java\tscript:`-style browser-normalization bypasses a check
on the parsed URL alone would miss) and scheme-relative `//host` is rejected
outright, since `new URL` cannot parse it standalone and it would otherwise
inherit the page's own scheme. `components/markdown.tsx` renders the node
tree into React elements directly — `dangerouslySetInnerHTML` is never
called anywhere in this pipeline, so injected markup is structurally
impossible to render, not merely filtered out by a sanitizer that has to
keep being right.

**Consequences.** The supported subset is deliberately small: no headings,
no images, no tables, no raw HTML passthrough of any kind — a real
capability gap next to a full Markdown library, and `<` is just a character
here with no special handling anywhere in the pipeline. That gap is the
trade for the injection surface it closes: a future feature that genuinely
needs raw HTML needs a new design, not a hole poked in this one (the
module's own header comment says so in as many words). The admin panel's
live preview renders through this exact same parser/renderer pair a
contestant's board uses — never a second implementation — so what an
organizer sees while authoring is never a preview of something different
from what ships.

## 29. No attempt cap on flag submission

**Context.** The quiz module enforces two retry-gate knobs together: a
maximum attempt count per question and a cooldown between attempts, because
a quiz question's answer space is small and enumerable (a handful of
labelled choices) — without a cap, exhausting every combination is a
realistic brute-force path. Classic's answer space is categorically
different: a flag is an arbitrary string with no enumerable option set, so
the brute-force risk a cap defends against for quiz simply doesn't apply the
same way here. A cap would instead mostly punish a contestant legitimately
iterating on a real hunch, or retrying immediately after noticing a typo —
friction with no matching security benefit, since the normalization
(decision noted in the architecture doc) already forgives case and
whitespace variance, the two mistakes an attempt cap might otherwise seem to
guard against.

**Decision.** `evaluateGate`/`SUBMIT_SCRIPT` enforce exactly one throttle:
`classicCooldownSec`, organizer-configurable, default `5`, capped at `3600`
(`CLASSIC_COOLDOWN_SEC_MAX` in `admin-store.ts`) — `0` disables it entirely.
There is no attempt-count field anywhere in the gate; the only refusal
reasons `submitFlag` can return are paused/scheduled, already-solved,
cooldown, or an unverifiable lookup (`"unavailable"`, fail-closed) — never a
spent allowance. The cooldown is expressed in **seconds**, not minutes,
deliberately unlike every neighbouring retry-gate setting on this platform
(`quizRetryAfterMin`, `hintsUnlockAfterMin`): the job here is blunting a
scripted brute-force loop hammering the endpoint, a sub-minute-timescale
problem, not rationing a contestant's genuine tries the way quiz's cap does.
The Lua script, not the JS pre-check, is the authority: it re-reads the
cooldown against the attempts row at script-execution time, so a burst of
near-simultaneous submissions can't collectively outrun a cooldown the
pre-check alone would have let through.

**Consequences.** A contestant can retry a classic challenge as many times
as they like, gated only by how long they're willing to wait between tries
— an organizer who wants a harder anti-brute-force posture has one lever
(raise the cooldown, up to the one-hour cap) rather than two. This is judged
adequate specifically because the flag space is arbitrary text: even a slow
scripted guesser gains nothing meaningful within the cap's lifetime, unlike
quiz's small enumerable option space, where a cap is load-bearing. If a
future need arises for a genuine per-challenge attempt limit, it is a new
knob, not an extension of the cooldown — the two solve different problems
and conflating them would blur which knob to reach for.

## 30. One shared team-dedupe fold

**Context.** Both `quiz` and `classic` need a team's total to be the
**union** of what its members individually banked — never the sum, which
double-counts any item two teammates both hold, the same double-counting
mistake naive summation would make with a shared secure-development flag.
Both stores also happen to bank a contestant's earned items in the identical
shape: a per-login hash keyed by item id, valued `{points, at}` (`at` the
solve/answer timestamp). Before `classic` existed, this union-fold logic —
parse each member's hash reply, dedupe by item id keeping the earliest
record on a tie, sum the deduped points, track the latest timestamp for
"last activity" — lived once, inside `quiz-store.ts`, written for quiz
alone.

**Decision.** Extract the fold into `apps/web/src/lib/leaderboard/team-fold.ts`'s
`foldTeamItems`, a pure function over Upstash pipeline replies with no
dependency on either store — deliberately not `server-only`, so both
`quiz-store.ts` and `classic-store.ts` can call it and its own tests can
exercise it directly. Both stores' team-total functions
(`getTeamQuizTotalsBatch`/`getTeamClassicTotalsBatch`) call the identical
function and rename only the returned `completed` count to their own noun
(`answered` for quiz, `solved` for classic) — the SHAPE is shared, the
vocabulary is not. The dedupe key is the hash field name (question id or
challenge id); the record kept for a key more than one member holds is the
EARLIEST one, so a later re-solve by a teammate, or a since-changed item
price recorded on someone else's row, never changes what the team already
earned; `lastAt` is the LATEST timestamp in the deduped set, for the "last
activity" column.

**Consequences.** One rule, one set of tests
(`leaderboard/__tests__/team-fold.test.ts`) governs tie-breaking and
timestamp handling for every module that ever needs a team-item dedupe,
instead of two copies that could silently diverge on either. A third
capture-style module (one that banks `{points, at}` per item per login)
gets correct team dedupe for free by calling `foldTeamItems` rather than
re-deriving the rule; a module whose progress doesn't fit that shape simply
doesn't use it, the same way `secure-development`'s per-target flags don't.
The shared function's vocabulary (`completed`, `Earned`) is intentionally
generic — each caller still translates it into its own domain language
(`ClassicTotal`/`QuizTotal`) at the boundary, so nothing downstream of
either store has to know the fold is shared.

## 31. One hint switch: capability split from policy

**Context.** Hints had three things that looked like a switch, and none of
them worked the way an organizer would expect.

`event.yaml`'s `hints: { enabled: true }` was read by nobody — its own
comment called it a v1 placeholder. `HINTS_ENABLED` was documented in
`.env.example`, in the app README and in the hosting guide as the way to ship
an event with hints off, but `docker-compose.yml` never forwarded it to the
`app` service and the Dockerfile declared no build arg for it, so on the
composed stack the container never saw it. And `/admin`'s toggle — the one
switch that did reach the running app — governed only whether a hint could be
**bought**: `getViewerHints`, `getHintPenalties` and `getHintAvailability`
read a module-level env constant instead, so turning hints off left the hint
buttons on the challenges page and the penalty column on the leaderboard.
That last split is the limitation [#19](#19-organizer-admin-panel-runtime-override-layer)
recorded and deferred.

The obvious repair — forward the env var through compose — would have made a
documented knob work while leaving three switches for one concept, and left
the split-brain untouched.

**Decision.** `/admin` is the only hint switch. `HINTS_ENABLED` is retired.

The env read splits into two things that were always distinct:

- **Capability** — `HINTS_AVAILABLE`, true when `UPSTASH_REDIS_REST_*` are
  set. Hint text lives only in Upstash, so without credentials there is
  nothing to reveal and no organizer setting can change that. Read paths test
  it first purely to skip a settings read they already know the answer to.
- **Policy** — `hintsEnabled` in `ctf:admin:settings`, falling back to
  `HINT_DEFAULT_ENABLED` (a constant in `hint-defaults.ts`, not an env var)
  when the organizer has never touched the toggle.

`resolveHintConfig()` combines them, and **every** hint read path now goes
through it, so the toggle cannot be true for one surface and false for
another. `HINT_COST` already worked exactly this way — a hardcoded default
with an admin override and no env var; hints-enabled was the odd one out.

`HINT_DEFAULT_ENABLED` lives in its own dependency-free module because
`hint-store.ts` is `server-only` and the admin toggle is a Client Component.
It has to render the same default the server resolves or it misreports the
state — which was a real bug: the toggle rendered `?? false`, showing "off"
on a fresh event while hints were live.

**Alternatives rejected.** *Forward the env var through compose* — makes a
vestigial knob work rather than asking whether it should exist, and needs a
container recreate to change something an organizer flips at event time.
*Keep the env var as a boot default under the admin override* — this was the
shipped intent (`hintsEnabled` is deliberately three-state, absent meaning
"use the env default"), but it never functioned: the override always writes
`"1"` or `"0"` and never `HDEL`s, so after one toggle there was no route back
to the default and the third state was unreachable in practice.

**Consequences.** One switch, one place to look, and the three-state encoding
collapses to a plain override with a code default — absent still means
"organizer has not chosen", now falling back to a constant rather than an
env var, so no stored data changes and no migration is needed.

The env var's only unique capability is gone: an organizer can no longer ship
an event with hints off without opening `/admin`. That window is pre-event,
with no contestants on the box, and the trade buys a switch that cannot
disagree with itself.

Anyone running the app outside compose (bare `next start`) who set
`HINTS_ENABLED=false` loses that; it never worked under the supported
deployment, so the blast radius is narrow. Turning hints off does not forgive
spend — `ctf:hints:spent` is untouched, so re-enabling restores the penalties
rather than wiping them.

**Amendment.** The decision retired `HINTS_ENABLED` but left `event.yaml`'s
`hints:` block in place, and the wizard kept writing it. That was the third
switch surviving the cull: a UI/UX pass on 2026-08-20 found an event whose
config read `hints: { enabled: false }` while `/challenges` advertised "HINTS
ARE LIVE" and `/admin` showed the toggle on. An earlier fix had changed the
emitted value from `false` to `true` so the key would at least agree with the
running app, but a key that cannot change the answer misleads whichever value
it carries.

So the key is now gone rather than merely truthful: `setup/ctf-setup.sh` no
longer emits it, and `generate-event-config.mjs` warns (never fails) when a
config still carries one, naming `/admin` as where the setting lives. This
also removes `hints` from the platform-level list in
[#10](#10-eventyamls-module-namespace-deliberate-not-dynamic-registration),
which had it as top-level schema. Existing configs keep building.

`teams:` went the same way in the same change, for the same reason and with
the same mechanism. It too was declared platform-level in #10 and read by
nobody, so `teams: { enabled: false, max_size: 6 }` got team play anyway,
capped at 4. It is arguably the worse of the two: `max_size` is a *number*,
which reads even more like configuration than a boolean does. Teams are always
available; `/admin` opens and closes registration, and the cap is
`TEAM_MAX_MEMBERS` in `team-store.ts`.

Deliberately not replaced by a build-time capability. Solo play already works
and is the default — teams are opt-in per contestant — so a `teams.enabled`
flag would only hide a UI that costs nothing to leave up, at the price of the
second switch this ADR exists to remove. Making the *cap* organizer-settable
is a real request and is tracked separately; if it lands it belongs in
`/admin` on the `HINT_COST` pattern named above — a constant default with an
override and no config key — not back in `event.yaml`.

## 32. Scheduled windows, evaluated at read time in three readers

**Context.** [#19](#19-organizer-admin-panel-runtime-override-layer) gave
organizers a manual freeze. Manual is not enough for a real event: an
organizer should be able to say "scoring opens at the keynote and closes at
17:00" and then stop watching the clock. The same is true of the team-forming
window.

The kit has no scheduler. There is no cron on the box, no job runner, and
adding one would mean a new always-on component whose failure mode is silent —
a missed tick leaves scoring open past its end.

**Decision.** Windows are **instants stored in `ctf:admin:settings`**
(`scoringStartsAt`/`scoringEndsAt`, `registrationStartsAt`/`registrationEndsAt`,
normalised to ISO-UTC on write) and **evaluated at read time**, by whoever is
about to act:

```
effectivePaused(s)          = s.paused || outsideWindow(now, scoringStartsAt, scoringEndsAt)
effectiveRegistrationOpen(s)= s.teamRegistrationOpen && !outsideWindow(now, registrationStartsAt, registrationEndsAt)
```

Read-time evaluation means there is nothing to miss. A window that has closed
is closed on the next request, whether or not anything ran at the boundary,
and a box that was powered off over the window boundary behaves correctly the
moment it comes back.

The manual flag and the schedule are **ORed** for the freeze and **ANDed** for
registration, which reads oddly until you say it aloud: the freeze is "stop
if I said so *or* if we are outside the window", registration is "open only if
I said so *and* we are inside the window". Both are the conservative reading
of the organizer's two inputs.

**Three readers, and they must change together.** `outsideWindow` is
implemented independently in `apps/web/src/lib/admin-store.ts`,
`scorer/src/store.js` and `sync/src/redis.js` — three languages-worth of
runtime with no shared package between them — plus `team-store.ts` for the
registration half. Each carries a comment saying so.

Duplication was chosen over a shared package because the alternative is worse
here: the scorer and sync are standalone Node services with their own
`package.json`, so sharing would mean publishing a package or vendoring a
build step into two services that currently have neither, to share about
fifteen lines of date comparison. The cost is a real lockstep obligation,
which is why it is written down in `AGENTS.md` as well as in each file.

**Freeze reads fail OPEN.** If Redis is unreachable, `scorer/src/store.js` and
`sync/src/redis.js` both return "not paused" rather than "paused". A Redis
blip during an event must not silently discard real submissions; the failure
mode of guessing wrong in the other direction is contestants losing work they
have already done. This is deliberately the opposite of the hint gate and the
quiz attempt lookup, which fail CLOSED — those guard a spend, and the safe
answer when you cannot tell is to refuse.

**Consequences.** Enforcement lands on writes rather than on a timer, so a
"closed" window still lets contestants browse — it stops scoring, not reading,
which matches what the freeze already did.

Nothing reconciles the three implementations automatically. A change to one
that misses the others produces an event where the app believes scoring is
closed while the poller keeps ingesting, and the only signal is behavioural.
The corpus tests that pin the `modules:` readers have no equivalent here.

## 33. Classic CTF: static exact-match flags, stored recoverably

**Context.** The `classic` module is the jeopardy format: a board of
organizer-authored challenges, each hiding a string, graded the instant a
contestant submits it. That is a different scoring shape from both existing
modules — `secure-development` judges a patch through a rubric,
`quiz` compares against an enumerable answer set.

**Decision — the solve mechanic is a static, exact-match string.** No
per-contestant flags, no regex, no scripted validators. Static means an
organizer can write a challenge without writing code, and a flag can be
verified by eye; exact-match means grading is a comparison rather than an
evaluation, so there is nothing to sandbox and no way for authored content to
become executable.

**Matching is normalised on both sides** (`normalizeFlag`: trim, NFC, then
lowercase). Copy-paste from a terminal picks up trailing whitespace,
Unicode-normalisation differences are invisible on screen, and case is not the
skill being tested. A contestant who found the flag should not lose it to any
of those.

**Flags are stored recoverably, in plaintext, not as a digest.** This is the
decision most likely to look wrong at a glance, so the reasoning matters. A
digest would let the organizer verify a submission without holding the
original — but the organizer *authored* the flag, and needs to keep reading it
back: to check it against the challenge text, to fix a typo, to export a board
and reuse it next term, and to answer "is this contestant's near-miss actually
correct?" A hash makes all of that impossible while defending against an
attacker who, by construction, already has admin access to the box.

The real exposure is a *contestant* reading flags, and that is handled by the
read boundary rather than by the storage format: `listChallenges` issues a
single `HGETALL` against the public hash and never touches the flag hash at
all, while `listChallengesForAdmin` reads both behind `requireAdmin`. That
split, and the second normalised hash it needs, is
[#27](#27-two-flag-hashes-rather-than-one).

**Categories and per-challenge points are first-class**, stored as their own
ordered list (`ctf:classic:categories`) rather than derived from the
challenges. An organizer sets board layout before authoring content, and an
empty category must be able to exist while its challenges are being written.

**Points are capped** (`CLASSIC_POINTS_MAX`), and the cap's real reason is not
game balance: the challenge record is serialised with `JSON.stringify`, at
`>= 1e21` JavaScript emits exponential form (`1e+21`), and `SUBMIT_SCRIPT`'s
anchored Lua pattern `'"points":(%-?%d+)[,}]'` cannot read that. Without a cap
an organizer could author a challenge that silently fails to grade. The cap is
far below the breaking point, so the constraint never surfaces — but it is the
constraint, and it lives in a source comment where a future refactor of the
Lua would not think to look.

**Consequences.** An organizer can put a flag in a screenshot, an email or a
slide and it still matches. Flags are as secret as `/admin` is — the export
bundle is the complete answer key in one file, which `docs/operations.md`
states outright.

The Lua-pattern coupling means the points cap and `SUBMIT_SCRIPT` are a pair:
changing how the record is serialised, or how the script parses it, invalidates
the other.

## 34. Classic bulk import/export as a versioned, self-contained bundle

**Context.** [#33](#33-classic-ctf-static-exact-match-flags-stored-recoverably)
gives organizers a board to author one challenge at a time. A real board is
twenty to forty challenges, often carried between terms or drafted offline by
someone who is not the person running the box.

**Decision.** The whole board round-trips as one JSON bundle — `version`,
`categories`, `challenges` — imported by paste or upload and exported from the
admin page.

**Import is upsert-by-id and never deletes.** A challenge already on the board
but absent from the file is left alone. A truncated or mistyped file therefore
cannot destroy authored work mid-event, which is the failure that actually
matters: the organizer is usually importing *during* setup, with contestants
already registered. The cost, stated in the panel and the docs, is that you
cannot prune a board by importing a shorter file — deletion stays an explicit
per-challenge action.

**Ids round-trip**, which is what makes an export a usable backup: re-importing
updates the same challenges rather than duplicating them, and because solves
reference ids, existing contestant progress stays attached.

**Categories are unioned, never replaced.** Replacing would silently drop or
reorder categories belonging to challenges the imported file never mentioned —
breaking part of a board the organizer was not editing.

**The parser is deliberately client-safe** (`classic-io.ts` imports nothing
server-only, no Redis), so the admin page can validate before submitting and
show every error at once. That creates an obligation the file states in its own
header: it must mirror `upsertChallenge`'s rules field for field, or the two
authoring paths disagree about what is valid. The asymmetry that is safe is
import being *stricter* — it can only refuse a challenge the form would have
taken, never admit one the form would reject.

**The server re-parses the raw text** rather than trusting a client-parsed
object, so a client bug cannot write something the single-challenge form would
have rejected. The payload carries text, not a bundle.

**Bundles are versioned** (`CLASSIC_BUNDLE_VERSION`), and a mismatch is a hard
refusal rather than a best-effort read. A board is a term's work; silently
misreading an old export is worse than refusing it.

**Consequences.** Two bundle builders exist — one server-side, one in the admin
page, which already holds the data and would otherwise re-fetch it. They can
only drift through an *optional* added field; a new required field breaks both
at compile time.

Version 1 has no migration path yet. The first bump has to add one, and the
refusal above is what makes that safe to defer.

## 35. Module composition: the contract a fourth module must satisfy

**Context.** [#25](#25-building-a-leaderboard-with-no-scoring-backend)
introduced created rows and the ADDED-vs-ATTRIBUTED distinction, as a
consequence of making a quiz-only board work at all.
`classic` then needed the identical treatment, and the next module will too.
What was missing was the *general* rule, stated once, in a place a module
author reads before writing code.

**Decision.** `withModuleContributions` is the single composition point, and
every module joins the board through it under three rules.

**Points are ADDED or ATTRIBUTED, never both, and the choice follows where
grading happens.** `secure-development` is graded outside the app, so its
points already sit inside the row the scorer produced — they are *attributed*
to the module for display. `quiz` and `classic` are graded in the app, so the
scorer has never seen them — they are *added* on top. The two verbs are not
interchangeable in either direction: attributing an app-side module shows zero,
adding `secure-development`'s double counts. Both failures are silent, and both
look like a scoring dispute rather than a bug.

**The board's population is a union, not the source's list.** A contestant who
has only answered quiz questions exists in no scorer row, so the entry set is
the union of source logins and module-point holders, matched
case-insensitively because GitHub logins are while stored fields keep whatever
casing the PR author used. A module that scores app-side *creates* leaderboard
rows; it does not merely annotate them.

**Progress detail is a closed union with a compile-time exhaustiveness check.**
Each module contributes a `detail` variant, and `module-detail.tsx` closes the
switch with an assignment to `never`. A fourth module that adds a variant
without a render branch fails the build rather than rendering nothing — a
deliberately loud failure, because a missing branch is invisible in a passing
test suite and shows up as an empty expander at the event.

**Consequences.** A new module touches more than its own files, and the set is
knowable: the registry, the three `event.yaml` readers
([#10](#10-eventyamls-module-namespace-deliberate-not-dynamic-registration), plus the third that
[#24](#24-tolerating-a-missing-module-vs-rejecting-an-unknown-one) added), the
proxy's route matcher, the contribution overlay, and the detail renderer.
`docs/modules.md` §9 is the checklist; this ADR is why the checklist has the
entries it does.

The exhaustiveness check is the only one of the three rules enforced by the
compiler. Picking the wrong verb, or forgetting the union, both typecheck
cleanly — they are caught by tests that assert a module-only contestant appears
on the board at all, which is why those tests exist and why they assert on a
named login rather than on a row count.

## 36. Quiz adopts classic's bundle format rather than inventing a second one

**Context.** [#34](#34-classic-bulk-importexport-as-a-versioned-self-contained-bundle)
gave classic a bulk path. Quiz — the older module — never got one, so seeding a
50-question bank meant 50 round trips through a form while an equivalent flag
board pasted in as one file. That asymmetry existed for no reason beyond
arrival order.

**Decision.** Quiz gets the identical shape, deliberately: a versioned,
self-contained JSON bundle, imported by paste or upload and exported from the
Quiz tab; `quiz-io.ts` mirrors `classic-io.ts` structurally, and every rule ADR
34 settled carries over unchanged — upsert-by-id and never delete, ids
round-trip so an export is a usable backup, a client-safe parser that must
mirror the single-question form field for field, the server re-parsing raw text
rather than trusting a client-parsed object, and a hard refusal on a version
mismatch.

Copying the format was the point. An organizer running both modules should
learn one file shape and one set of guarantees, and a reviewer comparing the
two validators should be able to read them side by side. The alternative — a
quiz-shaped format justified by quiz's own field list — would have bought
nothing and cost a second thing to keep honest.

**Two rules are quiz-specific**, because the quiz's content differs from
classic's in exactly two ways:

- **No categories.** The quiz has no such concept, so there is no union rule
  and no category-membership check, and `QuizImportSummary` carries only
  `created`/`updated`.
- **Duplicate choice ids within one question are rejected.** This has no
  single-question equivalent, and does not need one: the admin form *generates*
  choice ids and so cannot produce a collision. Only a hand-written file can.
  Two choices sharing an id make the radio group ambiguous and leave `correct`
  unable to name one of them — an unanswerable question that nothing
  downstream reports. This is the same class of bundle-only rule as classic's
  duplicate-category rejection: stricter than the form, which is the safe
  direction (see ADR 34).

**The retry-gate settings are NOT in the bundle.** `quizMaxAttempts` and
`quizRetryAfterMin` are event policy, not content; they are live-editable in
`/admin` and shared by every question. Folding them in would mean importing a
question set mid-event could silently re-open or shut a retry gate an organizer
had already tuned, with no undo and no visible cause. Classic excludes
`classicCooldownSec` on the same argument, so this is the format's rule rather
than a quiz exception. The admin panel states it beside the import control, so
an organizer is not left to infer it.

**Consequences.** `QUIZ_POINTS_MAX` moved from `quiz-store.ts` (`server-only`)
to `quiz-keys.ts`, re-exported so every existing import still resolves to the
same value — the browser-side validator has to check a pasted bundle against
the very bound the store enforces. `QUIZ_ID_RE` moved for that same reason
earlier; `classic-keys.ts` already holds `CLASSIC_POINTS_MAX` for it.

The same two-builders caveat ADR 34 records applies here: one bundle builder
server-side (`exportBundle`), one in the admin page (`exportBundleFrom`, which
already holds the data). They can only drift through an *optional* added
field — a new required field breaks both at compile time.

## 37. Opting in to the fork-PR checkout `pull_request_target` now guards

**Context.** `actions/checkout` began refusing to check out a fork's pull
request from a `pull_request_target` workflow:

> Refusing to check out fork pull request code from a 'pull_request_target'
> workflow. […] To opt in, review the risks […] and set
> 'allow-unsafe-pr-checkout: true'.

That is step 3 of `ctf-score.yml`, so **every scoring run on every deployment
of this kit failed at it** — before the scorer image was even pulled. Both
targets exercised on the test org (DVWA, WebGoat) failed identically and in
seconds. The guard arrived through the floating `@v4` tag, so it reached
already-provisioned events with no change on their side.

**Decision.** Set `allow-unsafe-pr-checkout: true`, and bump the workflow to
**v2** so [#43](#43-…)'s upgrade path carries it to live forks.

The flag's name describes the class of risk, not this workflow's posture. The
danger `pull_request_target` creates is *executing* a fork's code in a job
holding the base repo's token and secrets. This job does not. Every `run:`
step in it is `docker login`, `docker pull`, `docker network create`, or
`docker run`: the checkout is a build **context**, mounted into the scorer
container, and the contestant's app is built and booted inside that container
on an internal network. No install script, build script, or test runner from
the PR executes on the runner host, and `persist-credentials: false` keeps the
job's token out of the checked-out tree.

**What the flag does not change.** The scorer container holds `docker.sock` so
it can boot the app as a sibling, and it necessarily BUILDS contestant-supplied
source. That trust boundary is inherent to judging submitted code, is recorded
in the architecture doc's security model, and predates this flag by the whole
life of the project. This restores behaviour the kit already had; it grants
nothing new. The honest summary is that the guard asked a question the kit had
already answered in its own workflow header.

**The alternative was not "be safer", it was "do not score".** Dropping
`pull_request_target` for `pull_request` gives the job a read-only token that
cannot post the score comment — the comment IS the score in poll mode (the
poller ingests it), so the module stops working. Scoring from a
`workflow_run` trigger keeps the comment but adds a second workflow and a
race, for a trust boundary identical to the one above.

**Consequences.** This is the first real exercise of the versioned-workflow
upgrade path, and it is exactly the case that path was built for: a security-
relevant change to a file that lives in forks. Events provisioned before it
report `❌ v1 — stale` in `doctor` and take it with
`./setup/ctf-setup.sh upgrade`. An event that never upgrades scores nothing at
all, which is at least loud.

Pinning `actions/checkout` by SHA would have prevented the surprise and is
worth doing ([#49](https://github.com/dcotelo/ctf-in-a-box/issues/49) covers
digest-pinning first-party images); it would also have meant not receiving the
guard, so it trades a loud break for a silent divergence from upstream's
current advice.
