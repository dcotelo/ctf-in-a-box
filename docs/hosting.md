---
title: Hosting
---

# Hosting

Everything you need to stand the kit up: prerequisites, the poll-vs-push
choice, the GitHub OAuth app contestants sign in with, and how event config
reaches the app. For the happy-path command sequence see the
[README Quickstart](https://github.com/dcotelo/ctf-in-a-box#quickstart); for
running the event once it is up see [docs/operations.md](operations.md).

## Quickstart: zero to a scored event

**The fastest path is the wizard** — run `ctf-setup.sh` with no subcommand and
it walks the whole sequence below. It **asks for each value inline** — your box
URL, the `event.yaml` fields (org, admins, targets, dates), and the App/OAuth
credentials — showing the instructions and GitHub URL for each, and writing
`.env` and `event.yaml` for you as you answer. No editing config by hand between
steps. It does every automatable step, guides + verifies each UI-only one, and
resumes if you stop:

```sh
./setup/ctf-setup.sh            # guided, prompts for values, resumable
```

The rest of this section is the same sequence as explicit commands, for when
you'd rather drive it yourself or script it. Each step is either a
`ctf-setup.sh` command or a **UI-only** step GitHub forces you through by hand
(marked below); `ctf-setup.sh` never mints credentials or creates orgs for you.

```sh
# 0. Verify tooling: gh auth, docker, docker compose v2, openssl.
./setup/ctf-setup.sh check

# 1. Clone the repo and work from its root.
git clone https://github.com/dcotelo/ctf-in-a-box && cd ctf-in-a-box

# 2. Generate .env — BETTER_AUTH_SECRET, SRH_TOKEN, SCORER_TOKEN, EVENT_URL,
#    SCORE_INGEST=poll, and empty App/OAuth/SCORE_IMAGE fields to fill later.
./setup/ctf-setup.sh secrets

# 3. Build + push the scorer image, then set SCORE_IMAGE in .env by hand.
#    Pin linux/amd64 — GitHub runners are amd64; an arm64 image (the default on
#    Apple Silicon) fails scoring with "no matching manifest for linux/amd64".
docker login ghcr.io   # token with write:packages
docker buildx build --platform linux/amd64 -t ghcr.io/<your-org>/score:latest --push scorer/
#    MANUAL: edit SCORE_IMAGE=ghcr.io/<your-org>/score:latest in .env
#    (the wizard builds + pins amd64 for you at step 4)

# 4. Create your event config from the example, then edit it.
cp event.yaml.example event.yaml
#    MANUAL edit: github.org, modules.secure-development.targets,
#    admins=[your login], event.url.

# 5. Create the disposable GitHub org — UI-ONLY, ctf-setup never creates it:
#    https://github.com/account/organizations/new
```

```sh
# 6. Sync GitHub App (poll auth). Opens a pre-filled creation form:
./setup/ctf-setup.sh app-manifest
#    UI-ONLY: Create App → Generate a private key (.pem) → note the App ID →
#    Install App on the event org. Then wire the key + App ID into .env:
./setup/ctf-setup.sh app-config --app-id <id> --pem ~/Downloads/<app>.private-key.pem
#    Add --installation-id <n> to pin the install; otherwise sync
#    auto-discovers it at runtime.

# 7. Sign-in OAuth app (separate from the App above). Opens the page and
#    prints the exact field values:
./setup/ctf-setup.sh oauth-app
#    UI-ONLY: fill the fields with callback <EVENT_URL>/api/auth/callback/github
#    → Register → Generate a client secret → copy Client ID + secret. Then:
./setup/ctf-setup.sh oauth-config --client-id <client id>
#    The secret is read from a hidden prompt — never on the command line.

# 8. Provision the event org. Dry-run first, then for real:
./setup/ctf-setup.sh org --dry-run
./setup/ctf-setup.sh org
#    org forks the targets, creates + protects the `ctf` branch, COMMITS
#    ctf-score.yml to each fork, disables inherited workflows, and mirrors
#    SCORE_IMAGE into the org's GHCR. Finish the UI-ONLY steps it prints:
#      (a) detach each fork from its fork network (Settings → Leave fork
#          network);
#      (b) keep ghcr.io/<org>/score PRIVATE and grant each fork Read under the
#          package's Manage Actions access;
#      (c) push mode only: org Actions secrets LEADERBOARD_URL / LEADERBOARD_TOKEN.
#    Then verify provisioning:
./setup/ctf-setup.sh doctor
```

```sh
# 9. Bring the containers up. EVENT_CONFIG_B64 is REQUIRED — building the app without
#    it yields neutral defaults (empty admins → /admin 403, generic branding).
EVENT_CONFIG_B64="$(base64 < event.yaml | tr -d '\n')" \
  docker compose --profile poll --profile app up -d --build app

# 10. Verify: watch the poller heartbeat, open the app, sign in, hit /admin.
docker compose logs -f sync
#     Open $EVENT_URL, sign in with GitHub, confirm /admin loads for an admin login.
```

## Prerequisites

- Docker with Compose v2 (`docker compose version` must work).
- [`gh` CLI](https://cli.github.com), authenticated (`gh auth login`).
- `openssl` — `ctf-setup.sh check` requires it (used for secret generation).
- A GitHub org for the event — one free org per event.
- `docker login ghcr.io` with a `write:packages` token. The `org` subcommand
  ends with `docker push ghcr.io/<org>/score:latest`, so it needs write access
  to your own org's packages.
- A scorer image named by `SCORE_IMAGE` in `.env`. There is no default, and
  `ctf-setup org` refuses to run until it is set.

Build your own scorer from the engine in `scorer/` — that is the
self-contained path and it needs no upstream access:

```sh
docker buildx build --platform linux/amd64 -t ghcr.io/<your-org>/score:latest --push scorer/
```

(`--platform linux/amd64` is required — GitHub runners are amd64, and
`ctf-setup org`'s mirror step refuses a non-amd64 image.)

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

`ctf-setup.sh org` forks each target into your event org, commits the scoring
workflow (`.github/workflows/ctf-score.yml`) to each fork's `ctf` branch, and
mirrors your `SCORE_IMAGE` into the org's GHCR. (The separate `render`
subcommand writes the workflows to `dist/workflows/` for offline inspection
without committing.) It automates the whole per-fork setup, is idempotent (safe to
re-run — each step is skipped once already satisfied), and leaves only three
GitHub-UI-only steps for you to finish by hand. Run `ctf-setup.sh doctor`
afterward: it prints a **status matrix** (one row per target, one column per
step) so the whole org's provisioning is scannable at a glance, and flags the
UI-only steps it can't perform — confirming the two it *can* verify by API.

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

**Manual — GitHub UI only, no API to perform them.** GitHub has no endpoint to
*do* these, but `doctor` confirms the first two by API (their result is
queryable) and shows ✅ once done — only the third is a blind reminder:

1. **Create the event org** itself.
2. **Detach each fork from the fork network** (repo Settings → *Leave fork
   network*, UI-only). This makes the event-org repo a standalone root, so
   contestant PRs default to *your* repo (not upstream) and contestants can
   fork it themselves. `doctor` verifies via the repo's `.fork` flag (✅
   detached / ⚠️ still a fork).
3. **Keep the `ghcr.io/<org>/score` package private** and **grant each fork
   Read** under the package's *Manage Actions access* (container visibility is
   UI-only). The rendered workflow logs in to GHCR with the runner
   `GITHUB_TOKEN`, which the Read grant makes sufficient. `doctor` verifies the
   package is private via its `.visibility`; the per-fork grant has no read
   endpoint, so that part stays a ⚠️ reminder to confirm by hand.

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

Prefer a cloud VM over your own machine? [Deploy on AWS](aws.md) ships a
Terraform module for a single-shot EC2 deploy — `terraform apply` up,
`terraform destroy` down.

### Poll auth: GitHub App

`sync` needs a token to read the event org's target repos, and a GitHub App
is the only supported poll auth: org-scoped, auto-expiring, revocable, and not
tied to a person. Each organizer creates their **own** App from
[`sync/app-manifest.json`](../sync/app-manifest.json) and installs it on their
event org — there is no shared, central App, so the private key stays yours.

`ctf-setup.sh` assists the two error-prone parts; you still click Create and
Install in GitHub's UI (the script cannot mint credentials for you):

```bash
# 1. Open a pre-filled App-creation form against your event org.
ctf-setup.sh app-manifest
#    In the browser: Create the App, "Generate a private key" (downloads a
#    .pem), note the App ID, then "Install App" on the event org.

# 2. Wire the downloaded key + App ID into .env (base64-encodes the PEM).
ctf-setup.sh app-config --app-id <id> --pem ~/Downloads/<app>.private-key.pem
#    Add --installation-id <n> to pin the install; otherwise sync
#    auto-discovers it at runtime.
```

This sets `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` (base64-encoded PEM) and,
optionally, `GITHUB_APP_INSTALLATION_ID` in `.env`. Both `GITHUB_APP_ID` and
`GITHUB_APP_PRIVATE_KEY` are required — `sync` refuses to start without them.
You can also set all three by hand instead of using the helpers.

## GitHub OAuth app

Contestants (and admins) sign in with GitHub, so you need an OAuth app —
separate from the sync GitHub App above. OAuth apps have no manifest/create
API, so this is a guided flow rather than an auto-filled one:

```bash
# 1. Open GitHub's new-OAuth-App page for the event org and print the exact
#    field values to paste (callback = <EVENT_URL>/api/auth/callback/github).
ctf-setup.sh oauth-app
#    In the browser: fill the printed fields, Register, then "Generate a new
#    client secret" and copy the Client ID + secret.

# 2. Wire them into .env. The secret is read from a hidden prompt — never on
#    the command line or in shell history.
ctf-setup.sh oauth-config --client-id <client id>
```

This sets `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `.env`; the app
reads them at runtime. `EVENT_URL` is the value in `.env` — that is what Caddy
and the app's auth flow use (`event.yaml`'s `event.url` is a separate, unsynced
field). You can also set both by hand instead of using the helpers, and you may
register the OAuth app on your personal account rather than the org.

> **Use HTTPS for any real event.** Set `EVENT_URL` to `https://<your-domain>`
> (not `http://`) for anything beyond local testing. Caddy auto-provisions TLS
> for a real domain, and the sign-in session cookie is only marked `Secure`
> when the URL is HTTPS — over plain `http://` the session cookie can be sniffed
> on the wire, which for an organizer login means admin takeover. `http://localhost`
> is fine for a local trial only.

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
