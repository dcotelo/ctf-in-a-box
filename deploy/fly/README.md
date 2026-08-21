# Deploy on fly.io

Run the control plane as **three Fly apps** plus a managed Redis, instead of a
box you administer. `deploy/fly/deploy.sh` up, `fly apps destroy` down.

Full walkthrough: [`docs/fly.md`](../../docs/fly.md).

## Why this is simpler than the box

Half the compose stack does not exist here:

| Compose service | On Fly |
|---|---|
| `app` | Fly app, the only public one |
| `scorer` | Fly app, private (`.internal` only) |
| `sync` | Fly app, private, one volume |
| `srh` | Fly app, private — **still required**, see below |
| `redis` | **Managed Redis** (`fly redis create`) |
| `caddy` | **Gone** — Fly terminates TLS and issues certificates. |

### Why `srh` is still here

An earlier version of this module did not deploy it, on the reasoning that
`srh` only fakes the Upstash REST API in front of local Redis. **That was
wrong.** `fly redis create` provisions Upstash-*managed* Redis, which speaks
only the Redis protocol and hands back a `redis://` private URL — there is no
REST endpoint. The REST API (`UPSTASH_REDIS_REST_URL` / `_TOKEN`) is an Upstash
**cloud** feature, not part of the Fly integration.

The app, scorer and sync speak REST and only REST. Point them at a `redis://`
URL and nothing connects. So `srh` is not optional here; it is the translator
that makes the managed Redis usable, exactly as on the compose path.

If you already have an Upstash **cloud** database, which does expose REST, you
can skip the `srh` app and set `UPSTASH_REDIS_REST_URL` / `_TOKEN` directly on
the other three.

**The scorer needs no Docker.** It runs in `serve` mode: an ordinary HTTP
server. Judging boots target containers as siblings through `docker.sock`, and
that happens on GitHub's runners, never here. Without that, none of this would
fit on Firecracker.

**Images follow compose, service by service.** `docker-compose.yml` uses a
pre-built `image:` for the scorer (`$SCORE_IMAGE`) and `srh`, and `build:` only
for `app` and `sync` — this module does the same. The scorer in particular
deploys the *same image the forks pull to judge PRs*, rather than a second
build from source: same code today, but nothing keeps two builds in step, and
a rubric or catalogue difference between them shows up as leaderboard totals
that disagree with the scores.

## Prerequisites (done once, before deploying)

1. **Provision the GitHub org** from your machine: `./setup/ctf-setup.sh org`.
   Fly does not provision anything on GitHub.
2. **Create the two GitHub apps** with the OAuth callback at the final
   hostname — so decide the hostname first. `https://<app>.fly.dev` is the
   default; a custom domain is below.
3. **Run `init`.** It writes a Fly-specific env file from your existing
   `.env`, rewrites `EVENT_URL` to the app's Fly hostname, generates an
   `SRH_TOKEN`, and provisions the managed Redis:

   ```sh
   ./deploy/fly/deploy.sh init                 # --dry-run first if you like
   ```

   It **tops up an existing env file** rather than overwriting it — so a
   hand-made one just gains what it is missing, and its permissions are
   tightened to `600` either way. It **asks before creating the database** (a billable resource) and will not
   proceed without a typed `create`. It never overwrites an existing env file
   and reuses an existing database, so it is safe to re-run.

   A separate env file is the point: a compose stack and a Fly deployment need
   different `EVENT_URL`s, and one file cannot hold both.

## Deploy

```sh
./deploy/fly/deploy.sh --dry-run    # prints every fly command, runs none
./deploy/fly/deploy.sh
```

`--dry-run` **redacts secret values** — it prints
`BETTER_AUTH_SECRET=<redacted>`, not the secret. Variable names and
non-secret values (app ids, the Upstash URL) still show, so the preview tells
you which secrets land on which app without putting any of them in your
scrollback.

**Running a local compose stack too?** Keep a separate env file for Fly and
pass it with `--env-file`. The two need different `EVENT_URL`s — `http://localhost`
for compose, the `https://` Fly hostname here — and `deploy.sh` refuses the
localhost one rather than deploying an app that would 500 on every request.

Order is scorer → sync → app, so the app never comes up pointing at a scorer
that does not exist yet. Every step checks before it acts, so re-running after
a failure resumes instead of duplicating.

## Tear down

```sh
fly apps destroy ctf-in-a-box-app ctf-in-a-box-sync ctf-in-a-box-scorer
fly redis destroy <name>
```

Then archive the forks: `./setup/ctf-setup.sh teardown`.

## The two things that bite

**1. `event.yaml` is baked at BUILD time, into two images.** Editing it does
nothing until you redeploy. The app takes it as the `EVENT_CONFIG_B64` build
arg; `sync` gets it copied in by `sync.Dockerfile`, because Fly has no bind
mounts and sync's `EVENT_CONFIG` takes a *path*, not content.

Deploy the app without that build arg and the build **succeeds** with an empty
`admins` list — `/admin` then 403s for everyone, including you — and generic
branding. There is no error to notice. Always deploy through `deploy.sh`,
which passes it.

**2. `sync` needs its volume.** The poll cursor lives at
`/state/state.json`. Fly machines are ephemeral, so without the
`ctf_sync_state` volume the poller starts from scratch after every restart and
re-reads every comment in every fork.

That is not a correctness bug — `recordSolves` is monotonic, so replaying a
solve changes neither points nor `lastSolveAt` — but it re-submits the event's
whole history on every deploy and makes the `ingested`/`dropped` counters on
`/admin` meaningless. `deploy.sh` creates the volume; do not remove the
`[mounts]` block.

## Poll mode, and what push mode would open

This module is **poll mode**: `sync` reaches out to GitHub, and nothing on the
internet needs to reach the scorer. That is why `scorer.fly.toml` and
`sync.fly.toml` publish no ports at all — the Fly equivalent of
`caddy/Caddyfile.poll` having no `/score` route.

Push mode needs a public `POST /score` on the scorer:

```toml
[http_service]
  internal_port = 4000
  force_https = true
```

Understand what that opens before adding it: it puts a score-writing endpoint
on the internet, guarded only by `CTF_SCORE_BEARER_TOKEN`. `test/fly.bats`
asserts the block is absent, so adding it is a deliberate act that also
updates a test — which is the intent.

## Custom domain

```sh
fly certs add ctf.example.org --app ctf-in-a-box-app
```

Then set `EVENT_URL` to it, update the OAuth callback to match, and redeploy
the app. `BETTER_AUTH_URL` is a secret derived from `EVENT_URL`, and the
session cookie's `Secure` flag follows its scheme.

## CI

`.github/workflows/ci.yml`'s `shell` job runs `shellcheck` on `deploy.sh` and
`bats deploy/fly/test/` on any change here. There is no fly account in CI and
nothing is ever deployed — the same posture as the terraform job.

The suite asserts what a broken port would violate: no public scoring surface,
the cursor volume matching `STATE_PATH`, the `EVENT_CONFIG_B64` build arg
present in `deploy.sh` and absent from the committed toml, `serve` mode, no
secrets in committed files, `--dry-run` making zero `fly` calls, and a **drift
guard** deriving `deploy/fly/sync.Dockerfile` from `sync/Dockerfile` so the
duplicate cannot silently rot.
