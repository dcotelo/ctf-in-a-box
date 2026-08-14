<h1 align="center">🛡 CTF-in-a-box</h1>

<p align="center">
  <em>Run the OWASP Secure Development CTF at your own event.<br>
  A university, a high school, an OWASP chapter, a meetup — one box, one free GitHub org.</em>
</p>

<p align="center">
  <a href="https://github.com/dcotelo/ctf-in-a-box/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/dcotelo/ctf-in-a-box/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://dcotelo.github.io/ctf-in-a-box/"><img alt="docs" src="https://img.shields.io/badge/docs-github%20pages-blue"></a>
  <img alt="6 targets" src="https://img.shields.io/badge/targets-6-brightgreen">
  <img alt="321 challenges" src="https://img.shields.io/badge/challenges-321-brightgreen">
  <img alt="requires docker compose v2" src="https://img.shields.io/badge/requires-docker%20compose%20v2-lightgrey">
  <img alt="no cloud" src="https://img.shields.io/badge/cloud-none-informational">
</p>

<p align="center">
  <strong>This CTF was built for a conference. This kit is for everyone else.</strong>
</p>

The OWASP Secure Development CTF teaches defence rather than attack: a
contestant forks a deliberately vulnerable app, finds the flaw, **patches** it,
and opens a pull request. A GitHub Action scores the patch and the score lands
on a leaderboard. It is a genuinely good way to teach secure coding — and until
now, running one meant standing up Vercel, Upstash, Lambda and DynamoDB, holding
the cloud bill, and having access to a private scoring image.

That is a reasonable ask for a conference with a budget. It is an unreasonable
ask for a university security course, a high-school club, an OWASP chapter
night, or a weekend workshop.

This kit removes it. Everything runs from Docker Compose on one machine you
already have — a laptop, a spare desktop, a small VPS — plus one free GitHub
org for the forks. The rubrics for all six targets ship inside the box, so there
is no private image to request and no scoring code to write. Nothing is billed,
nothing phones home, and when the event ends you archive the repos and stop the
stack.

**Who this is for:** anyone who wants to run this event and does not want to
become a cloud operator to do it — course instructors, club organizers, OWASP
chapter leads, workshop facilitators, security teams running an internal
training day.

<p align="center">
  <img alt="Leaderboard and challenge browser" src="docs/assets/demo.gif" width="720">
</p>

| Leaderboard | Challenge browser |
|---|---|
| ![Leaderboard](docs/assets/leaderboard.jpg) | ![Challenges](docs/assets/challenges.jpg) |

<sup>Captured from the contestant app in mock-data mode — it ships demo data by
design, so the kit is inspectable before an event exists. These shots predate
the event-config work and show DEF CON 34 branding; a fresh build now defaults
to a neutral "OWASP CTF". Re-capturing them is a known follow-up.</sup>

```console
$ ./setup/ctf-setup.sh check
$ docker compose --profile poll --profile app up -d
$ ./scripts/acceptance-target.sh vampi erev0s/vampi:latest
PASS: stock vampi scores 0 / 9
```

### Why it is built this way

- **The rubric ships with the kit.** A stock `docker build scorer/` bakes
  executable rubrics for all six targets — 321 challenges, vendored from the
  upstream event repo and pinned to one commit. No private-image access, no
  upstream permissions, no rubric to write yourself.
- **A test that passes on the unpatched app fails the build.** Every target has
  a gate that boots the *stock* vulnerable image and asserts every challenge
  fails against it. A challenge that passes there would be a free point for
  every contestant, so the kit refuses to ship it. See
  [Verifying it works](#verifying-it-works).
- **Poll mode has zero inbound network surface.** Nothing has to reach your box
  from the internet — it polls GitHub for score comments instead. That is what
  makes a campus network, a locked-down lab, a NAT'd office, or venue wifi
  workable without asking anyone for a firewall change or a public hostname.
  [Push mode](#poll-vs-push) is there if you do have a public URL.
- **Everything survives a reboot.** Redis data and the sync cursor live in named
  Docker volumes, so power-cycling the box mid-event does not lose scores.
- **Nothing is branded until you brand it.** Event name, dates, URL, enabled
  targets, fork org and Discord link all come from one `event.yaml`; a fresh
  build ships as a neutral "OWASP CTF". Scale the event by picking a subset of
  targets — nine challenges for a two-hour club session, all 321 for a semester.
- **It is one module, not one event.** `event.yaml` namespaces challenge content
  under `modules.<name>`; `secure-development` is simply the first. Future
  verticals plug in as sibling keys. See [docs/modules.md](docs/modules.md).

**Contents** · [Quickstart](#quickstart) · [Targets and rubrics](#targets-and-rubrics) ·
[Prerequisites](#prerequisites) · [Poll vs push](#poll-vs-push) ·
[Configuration](#configuration) · [GitHub OAuth app](#github-oauth-app) ·
[Running an event](#running-an-event) · [Verifying it works](#verifying-it-works) ·
[Status and upstream dependencies](#status-and-upstream-dependencies)

## Quickstart

Four steps. `check` and `secrets` run before `event.yaml` exists — they only
touch your local tools and `.env`.

```sh
# 1. verify tooling, then generate .env with fresh secrets
./setup/ctf-setup.sh check
./setup/ctf-setup.sh secrets

# 2. describe the event: org, targets, admins, url
cp event.yaml.example event.yaml

# 3. fork the targets, render the scoring workflows, mirror the scorer image
./setup/ctf-setup.sh org

# 4. bring up the stack
docker compose --profile poll --profile app up -d
```

Every subcommand takes flags *after* the subcommand name — `./setup/ctf-setup.sh
org --dry-run` previews the whole of step 3 without touching anything.

`secrets` writes `.env` with a generated `BETTER_AUTH_SECRET`, `SRH_TOKEN` and
`SCORER_TOKEN`, plus empty `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` /
`GITHUB_PAT` for you to fill in. It refuses to overwrite an existing `.env`.
`GITHUB_PAT` is read at runtime by the `sync` service for poll-mode comment
polling, not by the setup script; a classic-scope PAT with repo read on the
event org is enough.

`org` authenticates with your existing `gh auth login` session and your local
`docker login ghcr.io`. It forks each target into the org (the targets are
public OSS — the only upstream repos touched), renders the scoring workflow per
target from `scorer/consumer-workflow.example.yml` into `dist/workflows/` and
tells you where to install each file, and mirrors the scorer image into your
org's GHCR.

## Targets and rubrics

Contestants pick a target, fork the org's copy, patch it, and open a PR. Each
target's challenges are executable `node:test` suites, priced by difficulty.

| Target | Challenges | Points | Notes |
|---|---:|---:|---|
| `vulnerableapp` | 110 | 187 | Largest target; scored 8-way parallel |
| `webgoat` | 69 | 137 | Prebuilt image only — a Maven fork build exceeds a runner's budget |
| `dvwa` | 55 | 108 | Needs a MariaDB sibling and a schema init |
| `securityshepherd` | 40 | 79 | HTTPS, three-container stack, strictly serial |
| `juice-shop` | 38 | 141 | The only target whose difficulty runs to 6 stars |
| `vampi` | 9 | 16 | Self-contained; the quickest end-to-end proof |

Enable any subset in `modules.secure-development.targets`. The rubrics live in
`scorer/rubric.owasp/`, vendored from
[OWASP-CTF/dc34-owasp-secure-development-ctf](https://github.com/OWASP-CTF/dc34-owasp-secure-development-ctf)
and pinned to a single upstream commit recorded in
`scorer/rubric.owasp/PROVENANCE.md`. Re-vendor against a newer commit with:

```sh
./scripts/vendor-rubric.sh --all --ref <sha>
```

Two rubric shapes are supported at once, and a single rubric directory may mix
them: `<target>.yaml` files use the declarative HTTP request/expect probe
grammar, and `<target>/tests/challenges/` directories use executable tests
priced by `catalogue.<target>.json`. Authoring guide:
[docs/scorer.md](docs/scorer.md).

**On rubric secrecy.** These rubrics are public. The targets are open source and
their solutions are already published, so the kit treats rubric privacy as
protection against check-gaming rather than against knowing the answers — an
accepted trade-off for a self-hosted event. Override with your own private
rubric at any time:

```sh
cp -r /path/to/private-rubric scorer/rubric
docker build -t ghcr.io/<org>/score:latest --build-arg RUBRIC_DIR=rubric scorer/
```

`scorer/rubric/` is gitignored and reserved for exactly this.

## Prerequisites

- Docker with Compose v2 (`docker compose version` must work).
- [`gh` CLI](https://cli.github.com), authenticated (`gh auth login`).
- A GitHub org for the event — one free org per event.
- `docker login ghcr.io` with a `write:packages` token. The `org` subcommand
  ends with `docker push ghcr.io/<org>/score:latest`, so it needs write access
  to your own org's packages.
- A scorer image named by `SCORE_IMAGE` in `.env`. There is no default, and
  `ctf-setup org` refuses to run until it is set.

Build your own from the engine in `scorer/` — that is the self-contained path
and it needs no upstream access:

```sh
docker build -t ghcr.io/<your-org>/score:latest scorer/
```

The upstream image `ghcr.io/owasp-ctf/score` is private with no formal access
process; if the OWASP-CTF maintainers grant you access, point `SCORE_IMAGE` at
it instead. Either way `ctf-setup org` mirrors whatever `SCORE_IMAGE` names into
your event org so the forks' Actions can pull it.

## Poll vs push

Scores travel from the scoring Action back to your box one of two ways.
**`SCORE_INGEST` in `.env` is the operative switch** — it is what
`docker-compose.yml` and the Caddy profile actually read.
`modules.secure-development.score_ingest` in `event.yaml` documents the same
choice for readers; nothing syncs the two, so keep them matching.

| Mode | How it works | Requirements | Latency |
|---|---|---|---|
| `poll` (default) | The `sync` service polls the org's target repos for score comments using your organizer PAT | Nothing extra — works behind NAT, on a laptop, anywhere | ~30 s |
| `push` | The scoring Action POSTs the score directly to your box | A public URL; `SCORE_INGEST=push` and org Actions secrets `LEADERBOARD_URL` / `LEADERBOARD_TOKEN` | Near-instant |

Poll mode is what `scripts/smoke.sh` proves working today. Push mode
additionally depends on upstream item 2 in
[Status and upstream dependencies](#status-and-upstream-dependencies) actually
shipping, and Caddy only exposes the `/score` route externally when running with
the `push` Caddyfile.

Start the poll pipeline with `docker compose --profile poll --profile app up -d`
— the `poll` profile brings up `sync`, and `app` brings up the contestant-facing
app. Push mode does not need `sync` running.

## Configuration

`event.yaml` uses a **modules** schema. Platform settings (`event`, `github`,
`teams`, `hints`, `admins`) sit at the top level; challenge content is
namespaced under `modules.<name>`. v1 ships exactly one module,
`modules.secure-development`, holding the target list and `score_ingest`.

Copy `event.yaml.example` and fill in `github.org`,
`modules.secure-development.targets`, `admins` (GitHub logins), and
`event.url`. What a module must provide to plug in — config block, scoring
contract, transports, security requirements, provisioning — is documented in
[docs/modules.md](docs/modules.md).

### Rebuilding the app after a config change

The contestant app (`apps/web/`, vendored — see
[`apps/web/VENDORED.md`](apps/web/VENDORED.md)) bakes its event name, dates,
URL, enabled-target list, fork org and optional Discord link from `event.yaml`
at **image-build time**, via the `EVENT_CONFIG_B64` build arg. The fork org also
drives every "fork this repo" link the app renders, so contestants are pointed
at the org `ctf-setup org` actually forked into.

Compose only rebuilds an image when told to, so `up -d` alone will not pick up
an `event.yaml` edit:

```sh
EVENT_CONFIG_B64=$(base64 < event.yaml | tr -d '\n') docker compose --profile app build app
docker compose --profile poll --profile app up -d
```

Building without `EVENT_CONFIG_B64` falls back to the neutral "OWASP CTF"
defaults. See `apps/web/scripts/generate-event-config.mjs` for the full
`EVENT_CONFIG` yaml > `EVENT_*` env var > default precedence.

## GitHub OAuth app

Contestants sign in with GitHub, so you need an OAuth app:

1. In the event org (or your personal account), create a new OAuth app.
2. Set the callback URL to `<EVENT_URL>/api/auth/callback/github`, where
   `EVENT_URL` is the value in `.env` — that is what Caddy and the app's auth
   flow use. (`event.yaml`'s `event.url` is a separate, unsynced field.)
3. Put the client ID in `GITHUB_CLIENT_ID` and the secret in
   `GITHUB_CLIENT_SECRET` in `.env`.

## Running an event

**During:**

- The leaderboard and app live at the `EVENT_URL` you configured in `.env`.
- Poller logs: `docker compose logs -f sync`.
- All state lives in named Docker volumes, so a box reboot loses nothing.

**After** — preview the teardown, then run it:

```sh
./setup/ctf-setup.sh teardown --dry-run
./setup/ctf-setup.sh teardown
```

This archives each target repo in the event org. It does **not** revoke
credentials or delete secrets — do that yourself: revoke the organizer
`GITHUB_PAT`, and delete the event org's Actions secrets (`LEADERBOARD_TOKEN`
if you used push mode).

## Verifying it works

No GitHub org, Action runs, or scorer image access needed to check the kit
itself:

```sh
./scripts/smoke.sh
```

This brings the full poll pipeline up against fixture GitHub comments and a mock
scorer, then asserts: Redis and the Upstash-compatible REST proxy work, `sync`
ingests fixture score comments, scores match the fixtures, a forged comment from
an untrusted author is dropped, and unauthenticated `POST /score` is rejected.
It is what CI runs, and the fastest way to sanity-check a change to `sync`, the
compose stack, or the setup script.

The scorer engine has two more gates of its own:

```sh
./scripts/acceptance-scorer.sh                                   # declarative probe path
./scripts/acceptance-target.sh vampi erev0s/vampi:latest         # a real target, end to end
```

`acceptance-scorer.sh` closes the judge → PR-comment marker → leaderboard loop
against a fake target app, in both push and poll mode.
`acceptance-target.sh` is the **stock-scores-zero gate**: it boots the real,
unpatched upstream image and asserts every challenge fails against it. Any
challenge that passes there asserts the exploit rather than the fix, and the
gate fails the build rather than handing every contestant a free point.

## Status and upstream dependencies

The kit is complete and tested offline: `scripts/smoke.sh` exercises the whole
poll pipeline, `sync` has unit tests for parsing, cursors and idempotency, and
every target's rubric is gated against its stock image. Real, live-GitHub
scoring depends on two changes landing in other OWASP-CTF repos, plus one item
still open here:

1. **upstream scorer** — a bearer-token auth mode for `POST /score` (accepting
   `Authorization: Bearer <token>` as an alternative to Actions OIDC), so both
   `sync` and push mode can authenticate without an OIDC provider.
2. **`score-action`** — optional `leaderboard-url` / `leaderboard-token` inputs,
   the scoring Action always emitting a machine-readable result comment
   (pass/fail and points only, no exploit detail), and a cap on scoring re-runs
   per PR.
3. **admin panel** — an organizer panel (score adjustments, player removal, hint
   toggles) gated by the `admins` allowlist is specified but not yet built.
   Event-config support and module-driven UI already ship in-repo. Offering the
   vendoring delta back to `OWASP-CTF/ctf-owasp-org` waits on upstream write
   access; see the "Intent" note in `apps/web/VENDORED.md`.

`srh` (`hiett/serverless-redis-http`), the Upstash-compatible REST proxy in
front of Redis, implements only a subset of Upstash's REST API — no path-style
`GET /get/<key>` shortcut, for example. The app is wired to it today for real
team-membership and hint-purchase data. What remains unverified is whether the
app's Redis client stays inside that subset end to end (pipelining, `EVAL`);
that check is tracked alongside item 3.

Until items 1 and 2 land, treat `scripts/smoke.sh` as the source of truth that
the kit works; a live event additionally needs the scorer's bearer-auth mode to
authenticate `sync` or push against a running scorer.

## Documentation

| Document | What it covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | How the stack fits together — diagram, score data flow, security model, testing strategy |
| [docs/scorer.md](docs/scorer.md) | The scorer engine: serve + judge modes, both rubric grammars, authoring and building |
| [docs/modules.md](docs/modules.md) | The module contract — what a new CTF vertical must provide to plug in |
| [docs/decisions.md](docs/decisions.md) | Why it is built this way instead of the alternatives |

Rendered at **[dcotelo.github.io/ctf-in-a-box](https://dcotelo.github.io/ctf-in-a-box/)**.
