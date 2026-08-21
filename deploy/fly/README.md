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
| `redis` | Fly app — **the same `redis:7-alpine` compose runs**, with a volume |
| `caddy` | **Gone** — Fly terminates TLS and issues certificates. |

### Why `srh` is still here, and why Redis is a plain container

`srh` translates the Upstash REST API the app, scorer and sync speak into the
Redis protocol. That was true on compose and it is true here — nothing about
Fly removes the need for it.

Redis itself is **our own `redis:7-alpine` app**, not `fly redis create`. The
managed option works, but it was the wrong default for this kit:

- **It is not the same Redis.** The kit's testing story is that what you
  exercise locally is what runs at the event. A managed Redis-compatible
  service is a different implementation with its own command coverage and
  eviction behaviour.
- **It adds a billable add-on** to a kit whose premise is "one box, no cloud
  bill".
- **It needed credentials nothing else needed** — `fly redis create`, then
  scraping a `redis://` URL out of `fly redis status` output. That was the
  most fragile step in the whole deploy.
- **`REDIS_PASSWORD` already exists.** `setup/ctf-setup.sh secrets` generates
  it, and every compose deployment carries one (ADR 41). The managed path
  ignored it and invented a second credential.

What Fly genuinely provides that compose does not — TLS termination and
certificates — is why `caddy` is absent. Redis was never in that category.

If you *do* want a managed database (Upstash cloud, which exposes REST), you
can skip both the `redis` and `srh` apps and set `UPSTASH_REDIS_REST_URL` /
`_TOKEN` directly on the other three.

## Prerequisites (done once, before deploying)

1. **Provision the GitHub org** from your machine: `./setup/ctf-setup.sh org`.
   Fly does not provision anything on GitHub.
2. **Create the two GitHub apps** with the OAuth callback at the final
   hostname — so decide the hostname first. `https://<app>.fly.dev` is the
   default; a custom domain is below.
3. **Run `init`.** It writes a Fly-specific env file from your existing
   `.env`, rewrites `EVENT_URL` to the app's Fly hostname, and fills in
   `SRH_TOKEN` and `REDIS_PASSWORD` if they are absent:

   ```sh
   ./deploy/fly/deploy.sh init
   ```

   It **touches nothing on Fly and needs no CLI** — it is pure env-file
   preparation. It tops up an existing file rather than overwriting it, so a
   hand-made one just gains what it is missing, and tightens it to `600`
   either way since it holds every secret the event has.

   An env file copied from a working compose deployment **already has
   `REDIS_PASSWORD`**, and `init` carries it over rather than generating a
   second one — the deployed redis and the deployed srh have to agree on it.

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

## How the private apps stay private

Only `app` declares a public service (`[http_service]`). `redis`, `srh`,
`scorer` and `sync` declare **no service block at all** — and that is the
mechanism, not an omission.

`[[services]]` is Fly's *public-edge* construct: it puts an app behind Fly's
proxy on an anycast IP, and Fly rejects the config if it has no
`[[services.ports]]`. An earlier version of this module had portless service
blocks on the assumption they meant "internal only"; a real `fly deploy`
answered:

```
Service has no processes set but app has 1 processes defined
WARNING: Service must expose at least one port. Add a [[services.ports]] section
✘ invalid app configuration
```

Private access needs nothing declared. `<app>.internal` resolves to the
machine's 6PN address and is reachable only from apps in the same
organization. A service block would have been the thing that *exposed* the
datastore.

One consequence worth knowing: **Fly's private network is IPv6-only**, so a
process bound to `0.0.0.0` alone is unreachable over `.internal`. That is why
redis runs with `--bind "* -::*"` (all IPv4 *and* all IPv6). The failure mode
is srh timing out against a redis that looks perfectly healthy in `fly logs`.

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

## The hostname the app is actually served from

`deploy.sh` compares `EVENT_URL`'s host against the app it deploys, and says
something when they disagree:

```
WARNING: EVENT_URL is https://ctf-in-a-box-test.fly.dev, but the app deploys
         as 'ctf-in-a-box-app' and will be served at
         https://ctf-in-a-box-app.fly.dev.
         Sign-in will fail with a redirect_uri mismatch.
```

It **warns and continues** — renaming the apps in `deploy/fly/*.fly.toml` to
match your event is a perfectly good answer, and failing would turn a choice
into a gate. A custom domain gets a note naming the `fly certs add` it needs,
not a warning, because that setup is entirely legitimate.

The failure it prevents is a late and opaque one: rename the apps and forget
the env file (or the reverse) and the deploy *succeeds*, while
`BETTER_AUTH_URL` claims a hostname nothing answers on. The only symptom is a
`redirect_uri` mismatch at sign-in, with nothing pointing back at the cause.

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
