---
title: Scorer
---

[← Docs home](index.md)

# Scorer

How to run scoring without any upstream access: author a rubric, build your
own scorer image from the engine in `scorer/`, and close the whole
scoring loop with components in this repo. For where the scorer sits in the
system, see [docs/architecture.md](architecture.md); for the contract it
implements, see [docs/modules.md](modules.md) §2–3; for why the rubric ships
public, see [decisions.md #18](decisions.md#18-exec-probe-rubrics-for-all-six-targets-the-rubric-ships-public).

## What the scorer is

One image (`scorer/Dockerfile`), two modes:

- **`score serve`** (the image's default CMD) — the leaderboard API that
  runs on your box as the `scorer` compose service: `POST /score`
  (bearer-token authed, the single score writer) and `GET /leaderboard`
  (the shape the app renders). Backed by Redis via the Upstash-REST proxy
  when `UPSTASH_REDIS_REST_URL` is set, an in-memory store otherwise.
- **`score judge`** (via `scorer/entrypoint.sh`) — the per-PR rubric
  runner. It executes inside the fork's GitHub Actions run: boots the
  contestant's patched app in a sibling container on an internal network,
  runs the rubric's HTTP probes against it, and writes a redacted
  `ctf-score.md` report.

In poll mode the loop closes entirely with kit components, no public URL
and no upstream service anywhere:

1. Contestant opens a PR against a forked target repo.
2. The fork's `ctf-score.yml` workflow (installed from
   `scorer/consumer-workflow.example.yml`) runs the mirrored scorer image
   in judge mode against the PR's code.
3. The workflow posts `ctf-score.md` as a PR comment, authored by
   `github-actions[bot]`, carrying the machine-readable
   `<!-- ctf-score: {...} -->` marker.
4. The kit's `sync` service polls the org's repos, trusts only
   `github-actions[bot]` comments, parses the marker, and POSTs the score
   to `score serve` on your box.
5. The app reads `GET /leaderboard` from that same serve process. The
   response pairs the ranked standings with a rubric-derived `catalog`
   (per target, each challenge's `id`/`name`/`points`/`owasp` — `owasp` is
   carried only by exec-grammar catalogues, `null` for declarative YAML
   targets) and a `solvedIds` list on each entry's/team's `apps.<target>`, so
   the app can show which flags are solved, not just how many.

Push mode short-circuits steps 3–4: the judge POSTs directly to your box's
public `/score` route and the comment is informational.

## Threat model — the rubric ships public

The targets are open source and their vulnerabilities and solutions are
already public (Juice Shop has an official solutions guide), so rubric
privacy was never about hiding answers. What a private rubric buys is
protection from check-gaming during the event — a patch crafted to satisfy
the exact probe (special-casing the probe's payload string, hardcoding the
expected status) without actually fixing the vulnerability. The kit accepts
that exposure as a trade-off rather than treating it as a blocker: the
vendored `rubric.owasp/` is public in this repo and is what a stock build
bakes ([decisions.md #18](decisions.md#18-exec-probe-rubrics-for-all-six-targets-the-rubric-ships-public),
reversing the earlier posture in
[#17](decisions.md#17-public-scorer-engine-private-rubric)). Two practical
consequences:

- **Stock default:** the checks a contestant is scored against are readable
  in this repo. Check-gaming is mitigated by rubric *shape* rather than by
  secrecy — the exec probes assert timing and response structure, which a
  patch cannot satisfy without changing the real behaviour the way a
  `bodyMissing` substring can be. That is a weaker guarantee than a hidden
  rubric, not an equivalent one.
- **Optional private path:** an organizer who wants the checks hidden
  authors their own rubric, bakes it with `RUBRIC_DIR`, and keeps the built
  image private while the event runs (the mirror steps below). Access
  control is the defense there; the image contents are assumed readable by
  anyone who can pull it. Publishing that rubric afterwards is encouraged —
  a well-written rubric is teaching material for the next cohort, and the
  solutions were public all along.

Either way the judge enforces its own discipline at runtime: the PR comment
shows challenge name, points, and ✅/❌ only — never probe paths, payloads,
or expected values.

## Authoring a rubric

A rubric is a directory of YAML files, one per target, `<target>.yaml`
with the `target:` field matching the filename stem. Probe grammar v1:

```yaml
target: juice-shop
challenges:
  - id: reflected-xss-search   # /^[a-z0-9][a-z0-9-]*$/ — becomes a Redis
    name: "Search no longer reflects an XSS payload"   # field segment, so
    points: 10                 # optional, default 1   # renaming resets solves
    probes:
      - request:               # method, path required; headers, body optional
          method: GET
          path: "/rest/products/search?q=<script>alert(1)</script>"
        expect:
          status: 200          # an int, or an inclusive [min, max] range
          bodyMissing: "<script>alert(1)</script>"
          # bodyIncludes: "..."  — substring the body MUST contain
```

A challenge is solved only when **all** of its probes pass, in order. The
loader fails loudly on unknown keys, duplicate ids, bad id charset, or
empty challenge lists — a typo breaks the build, not the event.

The golden rule is **assert the fix, not the exploit**: a probe must pass
only when the vulnerability is actually fixed. If it passes against the
stock vulnerable app, it is wrong — that's the stock-scores-zero invariant
from [docs/modules.md](modules.md) §6.4. Prefer one small, stable
substring (`bodyIncludes`) or the exact payload that must vanish
(`bodyMissing`) over brittle full-body matches. The kit's
`scripts/acceptance-scorer.sh` proves the all-fail path mechanically (an
unpatched fake app scores `0 / 3` and gains nothing on the leaderboard),
but verifying that **your** rubric scores a true stock target at zero is
the rubric author's §6.4 obligation before the event — the stock targets
are heavyweight and the kit cannot boot them generically.

The golden rule has a positive counterpart: a fix must still **earn its
points**. `scripts/acceptance-target.sh` gates the negative direction (a stock
app scores `0 / N`); `scripts/acceptance-patched.sh <target> <challenge-id>`
gates the positive one — it stages the pinned upstream source, applies a
**reference patch** from `patches/<target>/`, builds the fork, and asserts that
*exactly* the patched challenge is solved for its catalogue-difficulty points
while the other `N-1` still fail. Both gates share their staging/build/judge
machinery via `scripts/lib/acceptance-lib.sh`. All six targets have a reference
patch under `patches/<target>/` — one challenge each (VAmPI has two), enough to
prove the mechanism and, across VAmPI's pair, that the assertion discriminates.
That is **not** full per-challenge coverage; see
[patches/README.md](https://github.com/dcotelo/ctf-in-a-box/blob/main/patches/README.md) for the per-target status table, the
convention, and the anti-vacuous discipline that keeps a broken-app "pass" from
counting.

`scorer/rubric.example/` is the living documentation: `juice-shop.yaml`
is commented as a tutorial and its README covers the authoring workflow.
It is no longer what a default build bakes (that's the vendored
`scorer/rubric.owasp/`), but it is still what `scripts/acceptance-scorer.sh`
scores against, via `--build-arg RUBRIC_DIR=rubric.example`.

## The vacuous pass, and how it is detected

The stock-scores-zero rule catches a rubric that awards points against a
genuinely unpatched app. It cannot catch the failure underneath it: a rubric
that awards points against an app that **never did anything**.

Almost every exec check is phrased as *pass-on-patch* — it drives the exploit
and asserts it was BLOCKED. An app that answers nothing blocks every exploit
trivially, so such a check reports a solve for a security property nobody
verified. A fully **down** target is the easy case and is already handled:
every target's helpers open with a `waitFor…()` that polls until the app
answers, so an unreachable target throws at import and fails the file loudly.
The dangerous state is the one in between — health check green, but the
endpoint under test degraded or its fixture data missing.

That is not hypothetical. It is what
`rubric.owasp/vampi/tests/challenges/Challenge-7-Weak-JWT.test.js` hit: the app
was up, a seeding race left the admin account missing, `/me` could not report
admin for *anyone*, and "the forged token is not admin" passed for entirely
the wrong reason — handing out a free point on a **stock** target.

Its fix is the pattern to copy, an **anti-vacuous precondition**: before
trusting the block assertion, prove the oracle is alive by driving the
legitimate path.

```js
// A real admin login must reach /me and report admin — otherwise the
// forged-token assertion below passes for the wrong reason.
const legit = await vampiFetch('/me', { token: await getToken('admin', 'pass1') });
assert.equal(legit.status, 200, 'precondition: app seeded and reachable');
assert.equal(legit.json?.data?.admin, true, 'precondition: /me reports admin');

// Only now is this meaningful.
const forged = await vampiFetch('/me', { token: forgeJwt('admin', { secret: 'random' }) });
assert.ok(!(forged.status === 200 && forged.json?.data?.admin === true));
```

The precondition has to hold on both the vulnerable and the patched app —
otherwise it is not a precondition, it is a second assertion — and it must fail
loudly when the oracle itself is dead.

### Finding them mechanically

Auditing 200-plus challenge files by eye does not scale, and "does this assert
for the right reason" is exactly the judgement a reviewer cannot re-check
cheaply. `scorer/tools/vacuous-sweep.mjs` decides it mechanically instead:

```sh
cd scorer
node tools/vacuous-sweep.mjs                      # every target, every personality
node tools/vacuous-sweep.mjs --target vampi       # one target
node tools/vacuous-sweep.mjs --json findings.json # machine-readable
```

It points each target's URL env var at a stub that is **up but useless**
(`tools/vacuous-stub.mjs`) and runs the judge's own `runExec` over the real
catalogue. **Any challenge that reports a PASS is asserting nothing** — it
would score that point on an app that did nothing.

Three stub personalities run, because uselessness has more than one shape:
`empty-200` answers everything `{}` (the Weak-JWT shape); `not-found` catches
checks phrased as "the vulnerable endpoint must not return 200"; `server-error`
catches checks that read any non-200 as "fixed". A challenge only has to pass
under one of them to be suspect, so the report unions them.

Two results are **not** findings and are reported separately. A run marked
`ABORTED` means the exec runner gave up partway and skipped challenges — those
were never measured, and a clean result on an aborted run proves nothing. And
the stub counts the requests a rubric actually made, so "passed without issuing
a single request" is visible as its own, worse, bug.

A zero also has to be earned, so the sweep flags targets whose requests all
went to the **same path**. A rubric stuck at a login gate and a rubric whose
anti-vacuous preconditions are correctly firing both issue about one request
per challenge; the count cannot separate them, and reading it as a bailout
libels exactly the targets that have been hardened. Where the requests go does
separate them — one path repeated across every challenge means the rubric never
cleared a shared gate, while a path per challenge means it reached the app and
was turned away on the merits.

The sweep reuses `runExec` deliberately rather than running tests its own way:
a detector that disagreed with the judge would produce differences
indistinguishable from findings.

### Adding a target: give the stub its health path

Every target's helpers open with a `waitFor…()` that polls one specific path
until it answers, and the stub must answer *that* path or the target never
boots. `HEALTH_PATHS_BY_TARGET` in `tools/vacuous-stub.mjs` records it, read
off each target's own `helpers.js`:

| target | probe |
| --- | --- |
| `dvwa` | `/login.php` |
| `juice-shop` | `/rest/admin/application-version` |
| `securityshepherd` | `/login.jsp` |
| `vampi` | `/` |
| `vulnerableapp` | `/allEndPointJson` |
| `webgoat` | `/login` |

These are URL **suffixes**. Each target reads its base straight from the env
var the sweep overrides, so a path prefix carried by a default base URL is gone
— webgoat defaults to `…:8080/WebGoat`, but under the sweep its probe is plain
`/login`.

Get this wrong and the failure is silent in the worst direction. The probe
never goes green, every file in that target throws at module load, every
challenge reports a fail, and the sweep prints a confident **zero for a target
it never measured**. A guessed list did exactly that to `dvwa` and `webgoat`.
So the map is scoped per target and has no default: the stub refuses to start
without one, the sweep exits `2` rather than skipping a target quietly, and two
tests in `test/vacuous-stub.test.js` fail if a mapped path drifts out of sync
with the `helpers.js` it was copied from.

Scoping also runs the other way. Every listed path is answered `200` by the
degraded personalities, so a path that is *not* a probe hands that target's
rubric a real-looking response for free.

### …and, if its helpers log in, a handshake

Getting the probe right moved `dvwa`, `webgoat` and `securityshepherd` past
`waitFor…()` and straight into a second wall one stage later:

```
dvwa              No PHPSESSID after login
webgoat           No JSESSIONID after WebGoat login
securityshepherd  Login failed — no JSESSIONID in Set-Cookie
```

Every challenge in those three targets logs in before it asserts anything, so
all 164 died before touching the endpoint under test — and the sweep reported a
zero it had never measured. `AUTH_BY_TARGET` in `tools/vacuous-stub.mjs`
answers the minimum each helper checks:

| target | handshake |
| --- | --- |
| `dvwa` | `PHPSESSID` cookie, a `user_token` in the login form, and `/index.php` returning 200 that does not look like the login page |
| `webgoat` | `JSESSIONID` cookie, and `/service/reportcard.mvc` returning 200 |
| `securityshepherd` | `JSESSIONID` **and** `token` cookies straight off `POST /login` |

**Answering a login does not make the stub useful**, and that is the property
to protect when extending this. "The session store works, the application logic
does not" is an ordinary way for a real app to be broken — arguably the most
ordinary one. Past the handshake every path degrades exactly as before, so a
challenge that passes against a target which authenticated you and then
answered nothing is still asserting nothing.

Two rules keep it honest. Handshake traffic is **not counted** as a rubric
request, or every target would clear the "reached one distinct path" warning
without having gone anywhere. And handshake values are deliberately not hex:
`securityshepherd`'s `extractSolutionKey` accepts a bare 64-hex run, so a
token shaped like one could be echoed back and read as a solve — the detector
manufacturing the very thing it exists to find.

## Building and mirroring your own image

A stock event needs none of this: omit `RUBRIC_DIR` and the build bakes the
vendored `rubric.owasp/`. This section is the optional path — baking a rubric
of your own, private or not.

Docker `COPY` can only read paths inside the build context (`scorer/`), so
a rubric outside the repo cannot be referenced with `../my-rubric`. The
verified pattern: place your rubric at `scorer/rubric/` (gitignored) and
point the `RUBRIC_DIR` build arg at it:

```sh
cp -r /path/to/my-rubric scorer/rubric
docker build -t ghcr.io/<org>/score:latest --build-arg RUBRIC_DIR=rubric scorer/
```

Pass `--build-arg RUBRIC_DIR=rubric.example` to bake the example rubric
instead (useful for rehearsals, useless for a real event — three tutorial
probes on one target). Omit `--build-arg` entirely to bake the vendored
`rubric.owasp/` rubric — the stock default.

Then let the kit distribute it: set `SCORE_IMAGE` in `.env` to your image
and run `./setup/ctf-setup.sh org` — the mirror step pushes whatever
`SCORE_IMAGE` names into the event org's own GHCR
(`ghcr.io/<org>/score:latest`) so forked repos' Actions can pull it with
their own `GITHUB_TOKEN`. If the image carries a rubric you want hidden, keep
the package **private**: after the first push, check the package's settings in
the event org (GHCR packages inherit visibility from linked repos or default
per org settings — verify, don't assume) and leave it private until the event
ends.

## Installing the consumer workflow

`./setup/ctf-setup.sh org` renders `scorer/consumer-workflow.example.yml`
from the in-repo template — one file per target, placeholders pre-filled —
and **commits it** into each matching forked target repo as
`.github/workflows/ctf-score.yml` on the `ctf` branch, then disables the
fork's inherited upstream workflows. No manual install step.

For offline inspection or as a fallback, `./setup/ctf-setup.sh render` writes
the same rendered files to `dist/workflows/<target>.ctf-score.yml` without
committing (no upstream access either way); you can then commit each file into
the matching fork by hand and disable inherited workflows in the fork's
Settings → Actions. Filling the template in by hand works too; the
placeholders are:

| Placeholder | Meaning |
|---|---|
| `<EVENT_ORG>` | The GitHub org the scorer image was mirrored into (`ghcr.io/<EVENT_ORG>/score:latest`) |
| `<TARGET>` | The repo's rubric target id — must match a target the baked rubric defines: a `<target>/` directory holding `tests/challenges/catalogue.<target>.json` for an exec rubric (what `rubric.owasp/` ships), or a `<target>.yaml` for a declarative one (what `rubric.example/` ships). E.g. `juice-shop` |
| `<APP_URL>` | Where the app under test answers **on the ctf network**, e.g. `http://<TARGET>:3000` — no host ports are published |

The renderer fills `<APP_URL>` with each target's **stock** port
(`http://juice-shop:3000`, `http://dvwa:80`, `http://webgoat:8080/WebGoat`,
…) on the assumption that the target self-boots as a sibling container —
verify the URL against your rubric's boot strategy (see
[Booting hard targets](#booting-hard-targets)) before committing the file.

Poll vs push is decided by two optional org Actions secrets:

- **Poll** (default): leave `LEADERBOARD_URL` / `LEADERBOARD_TOKEN` unset.
  The judge skips the leaderboard POST; the PR comment's marker is the
  transport and the kit's `sync` service picks it up. Zero inbound network
  surface on your box.
- **Push**: set `LEADERBOARD_URL` (your box's public URL) and
  `LEADERBOARD_TOKEN` (the `SCORER_TOKEN` from `.env`) as org secrets, and
  run the box with `SCORE_INGEST=push` so Caddy exposes the `/score`
  route.

The workflow posts its comment via `actions/github-script` with the
default `GITHUB_TOKEN`, which makes the comment author
`github-actions[bot]` — exactly what `sync`'s trust filter requires. Don't
swap in a PAT or a third-party commenter action; that breaks the filter.

## Booting hard targets

**For the six kit targets there is no strategy to pick.** Each one ships a
bring-up script (`scorer/entrypoints/<target>.sh`) that the entrypoint runs
*instead of* the generic ladder below, and that script is responsible for
leaving the app reachable at `APP_URL` on the ctf network — a database
sibling, a schema seed, a readiness handshake, whatever the target needs.
What each one accepts:

- **`juice-shop`, `dvwa`, `vampi`, `vulnerableapp`** — run `APP_IMAGE` if it
  is set, else `docker build` the contestant's checked-out fork from a
  workspace `Dockerfile`, else exit non-zero.
- **`webgoat`** — the same three branches, with a two-stage source build. The
  fork's root `Dockerfile` is runtime-only (it `COPY target/webgoat-*.jar`), so
  the workspace is staged into a named volume, a JDK sibling runs the fork's own
  `./mvnw package`, and a docker-CLI sibling builds the image from the volume —
  both siblings on the default bridge, because `$NETWORK` is `--internal` and
  Maven needs the internet. It takes about two minutes end to end, gated by
  `scripts/acceptance-target.sh webgoat none`. (An earlier version of this file
  claimed a WebGoat fork's Maven build could not fit a runner's budget and made
  `APP_IMAGE` mandatory. That was wrong: upstream's own consumer workflow
  Maven-builds the PR's jar on a stock runner, and the measured build here is
  nowhere near the budget.)
- **`securityshepherd`** — ignores `APP_IMAGE` and always builds from pinned
  upstream source, because the WAR, the MariaDB schema and the Mongo seed are
  outputs of one Maven run and a prebuilt Tomcat image paired with freshly
  built siblings would boot against a schema it was never compiled for. The
  whole build (Maven, then three images) takes roughly a minute and a half on
  a stock runner, so it does fit an Actions job — that was the open question
  when this section was first written, and the answer turned out to be yes.

So **pointing the scorer at an instance you already run is not available for
these six**: the bring-up dispatch happens before the fallbacks below, and
every bring-up either boots something or fails.

A target with **no** bring-up script — one you add to your own rubric — falls
through to the entrypoint's generic ladder, which picks one of three boot
strategies in order:

1. **`APP_IMAGE` set** — pull that prebuilt image and run it as a sibling
   container on the internal network. Right for targets whose PR flow
   patches source that an existing image build consumes.
2. **Workspace `Dockerfile`** — the default PR-patch path: `docker build`
   the contestant's checked-out code and run it. This is how a fork with a
   Dockerfile at its root gets judged.
3. **Neither** — assume an organizer-managed app is already reachable at
   `APP_URL` and boot nothing. Right for heavyweight targets you keep
   running yourself.

A heavyweight target of your own stays your responsibility, but "heavyweight"
turns out to mean less than it sounds: strategy 2 handles a compiled app fine
(WebGoat's Maven build plus its image takes about a minute and a half here,
Security Shepherd's whole three-image build about the same). What strategy 2
does *not* handle is a fork whose `Dockerfile` cannot build the app on its own
— WebGoat's, for instance, is runtime-only and `COPY`s a jar Maven has to have
produced first. Give such a target its own bring-up script that runs the build
stage before the image stage (`scorer/entrypoints/webgoat.sh` is the worked
example, and it also shows the named-volume handoff a sibling `docker build`
needs). The alternatives remain: publish a prebuilt patched-app image per PR
and use `APP_IMAGE`, add a thin Dockerfile to the fork that layers the PR's
diff onto a prebuilt base, or run the target organizer-side (strategy 3 —
noting that then the judge probes *your* deployment, not the contestant's
patch, so it only fits challenges scored against a shared instance).

## Limits (v1)

- **Two probe shapes** — declarative HTTP request/expect probes
  (`<target>.yaml`) and exec probes that run a target's own `node:test` suite
  (`<target>/tests/challenges/`, priced by `catalogue.<target>.json`). Driving a
  headless browser is still out of scope.
- **`score serve` requires `SCORER_TOKEN`** (or `CTF_SCORE_BEARER_TOKEN`)
  and refuses to start without one — there is no unauthenticated write
  mode.
- **Redis via the SRH subset** — the serve store speaks the same
  POST-command-array subset of the Upstash REST API the rest of the kit
  uses (see the notes in `scripts/smoke.sh`); it is not a general Redis
  client.
- **The re-run rate cap lives in the workflow, not the engine** — the
  engine's monotonic writes mean re-runs gain nothing on the leaderboard,
  but every run still hands the contestant a fresh per-challenge ✅/❌
  verdict: a fast, free oracle to iterate a check-gaming patch against
  (tweak, push, read the ❌s, repeat) — that feedback loop, not Actions
  minutes, is the real threat. The shipped consumer workflow therefore
  enforces [docs/modules.md](modules.md) §6.3 itself: a `concurrency`
  group (one run per PR, superseded runs cancelled) plus a cooldown gate
  that skips scoring while the previous result comment is younger than
  `COOLDOWN_MINUTES` (default 5 — a plain env value at the top of the
  workflow) and annotates the comment with when the next push will be
  scored.

`scripts/acceptance-scorer.sh` is the offline proof of all of the above:
it builds the image with the example rubric, judges a fake target that
passes some probes and fails others, and asserts the report format, the
oracle discipline, the sync-marker contract, and the leaderboard shape —
no GitHub, no upstream image.
