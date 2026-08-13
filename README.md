# CTF-in-a-box

Self-hosted OWASP CTF: run the DEF CON 34 patch-the-vulnerability format
(fork target app → find + patch the vuln → PR back → GitHub Actions scores
the patch) on your own hardware. One box, one free GitHub org, no cloud
dependencies. See
[OWASP-CTF/dc34-owasp-secure-development-ctf](https://github.com/OWASP-CTF/dc34-owasp-secure-development-ctf)
for the underlying spec and target apps.

Contestants sign in, pick from up to six vulnerable target apps
(`juice-shop`, `dvwa`, `webgoat`, `securityshepherd`, `vulnerableapp`,
`vampi`), fork the org's copy, patch it, and open a PR. A GitHub Action
scores the PR and the score lands on your box's leaderboard — either pushed
in directly or picked up by a poller, depending on your network.

## Prerequisites

- Docker with Compose v2 (`docker compose version` must work).
- [`gh` CLI](https://cli.github.com), authenticated (`gh auth login`).
- A GitHub org for the event (create one free org per event; see
  [Poll vs push](#poll-vs-push) and [After the event](#after-the-event)).
- Read access to `ghcr.io/owasp-ctf/score` — request it from the
  OWASP-CTF "self-host organizers" team. The scorer image bakes in the
  challenge rubric and stays private; `ctf-setup org` mirrors it into your
  own event org so your forks' Actions can pull it.
- `docker login ghcr.io` with a token that has `write:packages`. The
  `org` subcommand's image-mirror step ends with
  `docker push ghcr.io/<org>/score:latest`, which needs write access to
  your event org's GHCR packages, not just read access to the upstream one.

## Quickstart

```sh
./setup/ctf-setup.sh check
./setup/ctf-setup.sh secrets
cp event.yaml.example event.yaml   # edit: org, targets, admins, url
./setup/ctf-setup.sh org           # fork targets, install workflow, mirror image
docker compose --profile poll --profile app up -d
```

`check` and `secrets` run before `event.yaml` exists — they only touch your
local tools and `.env`. `org` (and later `teardown`) need `event.yaml`
because they read `github.org` and `modules.secure-development.targets`
from it.

`secrets` writes `.env` with generated `BETTER_AUTH_SECRET`, `SRH_TOKEN`,
and `SCORER_TOKEN`, plus empty `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
/ `GITHUB_PAT` for you to fill in (see [GitHub OAuth app](#github-oauth-app)
for the client id/secret; `GITHUB_PAT` is consumed at runtime by the `sync`
service for poll-mode comment polling, not by `ctf-setup.sh` — see
[Poll vs push](#poll-vs-push)). A classic-scope PAT with repo read on the
event org suffices. It refuses to overwrite an existing `.env`.

`event.yaml` uses a **modules** schema: platform settings (`event`,
`github`, `teams`, `hints`, `admins`) sit at the top level, and the actual
challenge content is namespaced under `modules.<name>`. v1 ships exactly one
module, `modules.secure-development`, holding the target list and
`score_ingest` mode. Future CTF verticals (forensics, API security, cloud,
...) are expected to plug in as sibling keys next to `secure-development`
without changing anything else in the file. Copy `event.yaml.example` and
fill in `github.org`, `modules.secure-development.targets` (any subset of
the six target keys above), `admins` (GitHub logins), and `event.url`.

`ctf-setup.sh org` authenticates via your existing `gh auth login` session
(the same one `check` verifies) and your local `docker` login to
`ghcr.io` — it doesn't read `.env` at all. It forks each target into the
org, fetches and reports where to install the scoring workflow, and
mirrors the scorer image into your org's GHCR. Every subcommand takes
flags *after* the subcommand name, e.g. `./setup/ctf-setup.sh org --dry-run`
to preview without touching anything.

## GitHub OAuth app

Contestants sign in with GitHub, so you need an OAuth app:

1. In the event org (or your personal account), create a new OAuth app.
2. Set the callback URL to `<EVENT_URL>/api/auth/callback/github` (the
   `event.url` you put in `event.yaml`).
3. Put the client ID in `GITHUB_CLIENT_ID` and the client secret in
   `GITHUB_CLIENT_SECRET` in `.env`.

## Poll vs push

Scores travel from the scoring GitHub Action back to your box one of two
ways, set via `modules.secure-development.score_ingest` in `event.yaml`
(and `SCORE_INGEST` in `.env`):

| Mode | How it works | Requirements | Latency |
|---|---|---|---|
| `poll` (default) | The `sync` service polls the org's target repos for score comments with your organizer PAT | Nothing extra — works behind NAT, on a laptop, anywhere | ~30 s |
| `push` | The scoring Action POSTs the score directly to your box | A public URL for the box; set `SCORE_INGEST=push` and org Actions secrets `LEADERBOARD_URL` / `LEADERBOARD_TOKEN` | Near-instant |

Push mode additionally depends on upstream item 2 below (`score-action`'s
`leaderboard-url`/`leaderboard-token` inputs) actually shipping — see
[Status / upstream dependencies](#status--upstream-dependencies). Poll mode
is what `scripts/smoke.sh` proves working today.

Poll mode has zero inbound network surface — nothing needs to reach your
box from the internet. Push mode needs `LEADERBOARD_URL` (the box's public
URL) and `LEADERBOARD_TOKEN` (a bearer token) set as secrets on the event
org, and Caddy only exposes the `/score` route externally when running
with the `push` Caddyfile.

Start the poll pipeline with `docker compose --profile poll --profile app up -d`
(the `poll` profile brings up the `sync` service; `app` brings up the
contestant-facing app). Push mode doesn't need the `sync` service running.

## During the event

- Leaderboard and app live at the `event.url` you configured.
- Poller logs: `docker compose logs -f sync`.
- All state (Redis data, sync cursor) lives in named Docker volumes, so a
  box reboot doesn't lose scores or progress.

## After the event

Preview the teardown, then run it for real:

```sh
./setup/ctf-setup.sh teardown --dry-run
./setup/ctf-setup.sh teardown
```

This archives each target repo in the event org. It does not revoke
credentials or delete secrets — do that yourself:

- Revoke the organizer `GITHUB_PAT`.
- Delete the event org's Actions secrets (`LEADERBOARD_TOKEN` if you used
  push mode).

## Offline verification

No GitHub org, GitHub Action runs, or scorer image access needed to check
the kit itself works:

```sh
./scripts/smoke.sh
```

This brings up the full poll pipeline against fixture GitHub comments and
a mock scorer, and asserts: Redis and the Upstash-compatible REST proxy
work, sync ingests fixture score comments, scores match the fixtures,
a forged comment from an untrusted author is dropped, and unauthenticated
`POST /score` is rejected. It's what CI runs (see `.github/workflows/ci.yml`)
and it's the fastest way to sanity-check a change to `sync`, the compose
stack, or the setup script without any live GitHub or scorer access.

## Status / upstream dependencies

This kit is complete and tested against fixtures — `scripts/smoke.sh`
exercises the whole poll pipeline offline, and `sync` has unit tests for
parsing, cursors, and idempotency. Real, live-GitHub scoring depends on
three changes landing in other OWASP-CTF repos:

1. **`dc34` scorer** — a bearer-token auth mode for `POST /score` (accept
   `Authorization: Bearer <token>` as an alternative to Actions OIDC), so
   both `sync` and push mode can authenticate without an OIDC provider.
2. **`score-action`** — optional `leaderboard-url` / `leaderboard-token`
   inputs (POST the result there instead of the OIDC → Lambda path), the
   scoring Action always emitting a machine-readable result comment
   (pass/fail and points only, no exploit detail), and a cap on scoring
   re-runs per PR.
3. **`ctf-owasp-org`** — a published container image and event-config
   support (event name, dates, targets, branding read from `event.yaml`
   instead of hardcoded DC34 values). Until this lands, `images/app/Dockerfile`
   in this repo builds the app from source as a bridge.

Until those land, treat `scripts/smoke.sh` as the source of truth that the
kit itself works; a real event additionally needs the scorer's bearer-auth
mode to actually authenticate `sync`/push against a live scorer.
