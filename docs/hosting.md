---
title: Hosting
---

# Hosting

Everything you need to stand the kit up: prerequisites, the poll-vs-push
choice, the GitHub OAuth app contestants sign in with, and how event config
reaches the app. For the happy-path command sequence see the
[README Quickstart](https://github.com/dcotelo/ctf-in-a-box#quickstart); for
running the event once it is up see [docs/operations.md](operations.md).

## Prerequisites

- Docker with Compose v2 (`docker compose version` must work).
- [`gh` CLI](https://cli.github.com), authenticated (`gh auth login`).
- A GitHub org for the event — one free org per event.
- `docker login ghcr.io` with a `write:packages` token. The `org` subcommand
  ends with `docker push ghcr.io/<org>/score:latest`, so it needs write access
  to your own org's packages.
- A scorer image named by `SCORE_IMAGE` in `.env`. There is no default, and
  `ctf-setup org` refuses to run until it is set.

Build your own scorer from the engine in `scorer/` — that is the
self-contained path and it needs no upstream access:

```sh
docker build -t ghcr.io/<your-org>/score:latest scorer/
```

The upstream image `ghcr.io/owasp-ctf/score` is private with no formal access
process; if the OWASP-CTF maintainers grant you access, point `SCORE_IMAGE` at
it instead. Either way `ctf-setup org` mirrors whatever `SCORE_IMAGE` names
into your event org so the forks' Actions can pull it. Authoring a rubric and
building the image is covered in [docs/scorer.md](scorer.md).

## Fork setup and the contest flow

Each target is a specific **upstream** app pinned to a source ref — that pin is
the source of truth (there is no middle-man fork). The scorer judges a fork of it
with the vendored rubric, and the *scoring baseline* image is the stock, unpatched
build that [`stock-scores-zero`](operations.md#verifying-it-works) proves scores
`0 / N`:

> The per-target upstream repo and pinned ref below are sourced from
> [`setup/targets.tsv`](https://github.com/dcotelo/ctf-in-a-box/blob/main/setup/targets.tsv),
> which `ctf-setup org` reads to fork each target. Keep this table in sync with that file.

| Target | Upstream repo | Source ref | Scoring baseline (pinned image) |
|---|---|---|---|
| `juice-shop` | `juice-shop/juice-shop` | tag `v20.0.0` | `bkimminich/juice-shop:v20.0.0` |
| `webgoat` | `WebGoat/WebGoat` | tag `v2025.3` | `webgoat/webgoat:v2025.3` |
| `vulnerableapp` | `SasanLabs/VulnerableApp` | tag `2.1.37` (commit `bad68b1`) | `sasanlabs/owasp-vulnerableapp:2.1.37` |
| `securityshepherd` | `OWASP/SecurityShepherd` | commit `662771b` | self-build (no stock image) |
| `dvwa` | `digininja/DVWA` | commit `d45ba3c` | `ghcr.io/digininja/dvwa@sha256:091498ce…` |
| `vampi` | `erev0s/VAmPI` | commit `f16052d` | `erev0s/vampi@sha256:0a5a224b…` |

`ctf-setup.sh org` forks each target into your event org, renders a scoring
workflow per target into `dist/workflows/`, and mirrors your `SCORE_IMAGE` into
the org's GHCR. It automates the whole per-fork setup, is idempotent (safe to
re-run — each step is skipped once already satisfied), and leaves only three
GitHub-UI-only steps for you to finish by hand. Run `ctf-setup.sh doctor`
afterward to verify each fork's provisioning and flag the manual UI-only
steps.

**Automated by `ctf-setup org`** (one pass per target):

1. **Fork** the target from its pinned upstream repo/ref into your event org.
2. **Create and default the `ctf` branch** at that pinned ref (and drop the
   fork's old `master`/`main` default branch).
3. **Protect the `ctf` branch** so a contestant can never merge their patch —
   the PR is *scored, not merged*. It installs a minimal rule requiring one
   approving review:

   ```sh
   gh api -X PUT repos/<org>/<repo>/branches/ctf/protection --input - <<'JSON'
   { "required_status_checks": null, "enforce_admins": false,
     "required_pull_request_reviews": { "required_approving_review_count": 1 },
     "restrictions": null, "allow_force_pushes": false, "allow_deletions": false }
   JSON
   ```

4. **Install the scoring workflow**: renders and commits
   `.github/workflows/ctf-score.yml` on the `ctf` branch from the in-repo
   template.
5. **Disable the fork's inherited/upstream workflows** (everything except
   `ctf-score.yml`), so only the scoring Action runs.
6. **Install the PR template** (`.github/PULL_REQUEST_TEMPLATE.md`) on the
   `ctf` branch.
7. **`vulnerableapp` only** — install the Dockerfile it needs to build.
8. **Mirror `SCORE_IMAGE`** into the org's GHCR (once, after all targets),
   refusing a non-amd64 image so scoring can't fail at runtime — GitHub
   runners are amd64; an arm64-only image (e.g. built on Apple Silicon) makes
   the scoring Action fail with `no matching manifest for linux/amd64`.

**Manual — GitHub UI only, no API** (`doctor` flags these with ⚠️):

1. **Create the event org** itself.
2. **Detach each fork from the fork network** (repo Settings → *Leave fork
   network*, UI-only). This makes the event-org repo a standalone root, so
   contestant PRs default to *your* repo (not upstream) and contestants can
   fork it themselves.
3. **Package visibility / Read grant**: either make the `ghcr.io/<org>/score`
   package public, or grant each fork Read under the package's *Manage Actions
   access* (container visibility is UI-only). The rendered workflow already
   logs in to GHCR with the runner `GITHUB_TOKEN`, which a Read grant makes
   sufficient.

**The contest flow:** a contestant **forks your event-org repo** into their own
account, patches the vulnerability, and opens a **pull request against
`<event-org>/<repo>:ctf`**. The scoring Action (`pull_request_target`, so a
cross-fork PR gets a writable token to comment) runs the scorer and posts the
score comment; the PR is never merged. Detaching the fork network (manual step
2 above) is what makes this fork-then-PR-back flow work.

## Poll vs push

Scores travel from the scoring Action back to your box one of two ways.
**`SCORE_INGEST` in `.env` is the operative switch** — it is what
`docker-compose.yml` and the Caddy profile actually read.
`modules.secure-development.score_ingest` in `event.yaml` documents the same
choice for readers; nothing syncs the two, so keep them matching.

| Mode | How it works | Requirements | Latency |
|---|---|---|---|
| `poll` (default) | The `sync` service polls the org's target repos for score comments | a GitHub App installed on the event org (see below) — otherwise nothing extra; works behind NAT, on a laptop, anywhere | ~30 s |
| `push` | The scoring Action POSTs the score directly to your box | A public URL; `SCORE_INGEST=push` and org Actions secrets `LEADERBOARD_URL` / `LEADERBOARD_TOKEN` | Near-instant |

Poll mode is what `scripts/smoke.sh` proves working today. Push mode
additionally depends on upstream item 2 in
[Status and upstream dependencies](operations.md#status-and-upstream-dependencies)
actually shipping, and Caddy only exposes the `/score` route externally when
running with the `push` Caddyfile.

Start the poll pipeline with `docker compose --profile poll --profile app up
-d` — the `poll` profile brings up `sync`, and `app` brings up the
contestant-facing app. Push mode does not need `sync` running.

### Poll auth: GitHub App

`sync` needs a token to read the event org's target repos, and a GitHub App
is the only supported poll auth: org-scoped, auto-expiring, revocable, and not
tied to a person. Create one from
[`sync/app-manifest.json`](../sync/app-manifest.json), install it on the
event org, then set `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY`
(base64-encoded PEM) and, optionally, `GITHUB_APP_INSTALLATION_ID` in `.env`.
Both `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are required — `sync` refuses
to start without them.

## GitHub OAuth app

Contestants sign in with GitHub, so you need an OAuth app:

1. In the event org (or your personal account), create a new OAuth app.
2. Set the callback URL to `<EVENT_URL>/api/auth/callback/github`, where
   `EVENT_URL` is the value in `.env` — that is what Caddy and the app's auth
   flow use. (`event.yaml`'s `event.url` is a separate, unsynced field.)
3. Put the client ID in `GITHUB_CLIENT_ID` and the secret in
   `GITHUB_CLIENT_SECRET` in `.env`.

## Configuration

`event.yaml` uses a **modules** schema. Platform settings (`event`, `github`,
`teams`, `hints`, `admins`) sit at the top level; challenge content is
namespaced under `modules.<name>`. v1 ships exactly one module,
`modules.secure-development`, holding the target list and `score_ingest`.

Copy `event.yaml.example` and fill in `github.org`,
`modules.secure-development.targets`, `admins` (GitHub logins), and
`event.url`. Team play is configured at the top level — `teams: { enabled:
true, max_size: 4 }` in `event.yaml.example`. What a module must provide to
plug in — config block, scoring contract, transports, security requirements,
provisioning — is documented in [docs/modules.md](modules.md).

### Rebuilding the app after a config change

The contestant app (`apps/web/`, vendored — see
[`apps/web/VENDORED.md`](https://github.com/dcotelo/ctf-in-a-box/blob/main/apps/web/VENDORED.md))
bakes its event name, dates, URL, enabled-target list, fork org and optional
Discord link from `event.yaml` at **image-build time**, via the
`EVENT_CONFIG_B64` build arg. The fork org also drives every "fork this repo"
link the app renders, so contestants are pointed at the org `ctf-setup org`
actually forked into.

Compose only rebuilds an image when told to, so `up -d` alone will not pick up
an `event.yaml` edit:

```sh
EVENT_CONFIG_B64=$(base64 < event.yaml | tr -d '\n') docker compose --profile app build app
docker compose --profile poll --profile app up -d
```

Building without `EVENT_CONFIG_B64` falls back to the neutral "OWASP CTF"
defaults. See `apps/web/scripts/generate-event-config.mjs` for the full
`EVENT_CONFIG` yaml > `EVENT_*` env var > default precedence, and
[docs/architecture.md](architecture.md#build-time-config-flow) for the whole
build-time config flow.
