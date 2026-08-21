---
title: Deploy on fly.io
---

[← Docs home](index.md)

# Deploy on fly.io

Run the control plane as **three Fly apps** plus a managed Redis, with no box
to administer, no OS to patch, and TLS handled for you.

The module lives at
[`deploy/fly/`](https://github.com/dcotelo/ctf-in-a-box/tree/main/deploy/fly);
this page is the walkthrough. It stands up the **runtime** control plane only —
provisioning the GitHub org stays a separate one-time step you run from your
own machine.

## Why this fits, when a compose kit usually doesn't

Platforms like Fly run one process group per app, which normally makes a
six-service compose file awkward. Here it removes work instead, because **half
the stack exists only to emulate things Fly provides**:

| Compose service | On Fly | Why |
|---|---|---|
| `app` | Fly app (public) | The contestant UI |
| `scorer` | Fly app (private) | Leaderboard API + score writer |
| `sync` | Fly app (private, 1 volume) | Poll-mode ingest |
| `redis` | Managed **Upstash Redis** | — |
| `srh` | **not deployed** | It exists only to fake the Upstash REST API in front of local Redis. Against real Upstash there is nothing to fake. |
| `caddy` | **not deployed** | Fly terminates TLS and issues certificates. |

The app, scorer and sync already speak the Upstash REST protocol natively
(`UPSTASH_REDIS_REST_URL` / `_TOKEN`) — that is how the kit was built for its
original cloud deployment — so pointing them at managed Redis needs no code
change at all.

### The scorer needs no Docker here

This is what makes the whole thing possible. The scorer has two modes:

- **judge** — boots the target app as a sibling container through
  `docker.sock`, builds contestant-submitted source, runs the rubric. Needs
  privileged Docker.
- **serve** — an ordinary HTTP server: `GET /leaderboard`, `POST /score`.

**Judging happens on GitHub's runners, not on your infrastructure.** The
hosted scorer only ever runs `serve`, and `docker-compose.yml` mounts no
socket into it. So there is no privileged-Docker requirement to satisfy, and
Firecracker microVMs are enough.

## Prerequisites

1. **Provision the GitHub org** from your machine — `./setup/ctf-setup.sh org`.
   Fly provisions nothing on GitHub.
2. **Decide the hostname first.** `https://<app-name>.fly.dev` by default. The
   OAuth callback must match it exactly, and changing it later means updating
   the callback and redeploying.
3. **Create the two GitHub apps** (`ctf-setup.sh app-manifest` / `app-config`
   for the sync App, `oauth-app` / `oauth-config` for sign-in) with that
   hostname.
4. **Create the Redis** and put its REST credentials in `.env`:

   ```sh
   fly redis create
   fly redis status <name>
   ```

   ```
   UPSTASH_REDIS_REST_URL=https://<id>.upstash.io
   UPSTASH_REDIS_REST_TOKEN=<token>
   ```

5. **Set `EVENT_URL` to the https hostname** in `.env`.

## Deploy

```sh
./deploy/fly/deploy.sh --dry-run    # prints every fly command, runs none
./deploy/fly/deploy.sh
```

Order is **scorer → sync → app**, so the app never starts pointing at a scorer
that does not exist yet. Every step checks before acting, so a re-run after a
failure resumes rather than duplicating — the same idempotence rule
`ctf-setup.sh` follows.

Secrets go in through `fly secrets set`, never into a committed file. `.env`
stays on your machine.

## What runs where

```
              contestant browser
                      |
                      | HTTPS (Fly-terminated)
                      v
            +--------------------+
            |  ctf-in-a-box-app  |   public
            +---------+----------+
                      | http://…-scorer.internal:4000   (6PN private)
                      v
            +--------------------+        +---------------------+
            | ctf-in-a-box-scorer| <----- | ctf-in-a-box-sync   |
            +---------+----------+ POST   +----------+----------+
                      |          /score              | outbound only
                      |                              v
                      +---------> Upstash <---   GitHub API
                                  (REST)         (fork comments)
```

`*.internal` names resolve only inside your Fly organization, so the
leaderboard API and the poller are unreachable from the internet even though
the app is public.

## The two things that bite

### 1. `event.yaml` is baked at BUILD time — into two images

Editing it changes nothing until you redeploy.

- **app** takes it as the `EVENT_CONFIG_B64` build arg.
- **sync** gets it copied in by `deploy/fly/sync.Dockerfile`, because Fly has
  no bind mounts and sync's `EVENT_CONFIG` knob takes a *path*, not content —
  there is nothing to point it at unless a file is already in the image.

Deploying the app without that build arg **succeeds**, and yields an empty
`admins` list (so `/admin` 403s for everyone, including you) plus generic
branding. Nothing errors. Always deploy through `deploy.sh`.

> `deploy/fly/sync.Dockerfile` duplicates `sync/Dockerfile` with
> `sync/`-prefixed COPY paths, since a repo-root build context cannot use the
> bare ones. A test derives one from the other and fails if they diverge, so
> the copy cannot rot unnoticed.

### 2. `sync` needs its volume

The poll cursor lives at `/state/state.json`. Fly machines are ephemeral, so
without the `ctf_sync_state` volume the poller restarts from nothing and
re-reads every comment in every fork.

That is not incorrect — `recordSolves` is monotonic, so a replayed solve
changes neither points nor `lastSolveAt` — but it re-submits the event's
entire history on every deploy, and it makes the `ingested` / `dropped`
counters on `/admin` meaningless. `deploy.sh` creates the volume.

## Poll vs push

The module ships **poll mode**, and `scorer.fly.toml` / `sync.fly.toml`
publish no ports at all — the Fly equivalent of `caddy/Caddyfile.poll` having
no `/score` route. Nothing on the internet can reach the scorer.

Push mode requires giving the scorer a public `POST /score` guarded only by
`CTF_SCORE_BEARER_TOKEN`. `deploy/fly/README.md` shows the block to add;
`deploy/fly/test/fly.bats` asserts it is absent, so opening that surface also
means updating a test — deliberately.

## Cost and shape

Three shared-CPU machines (1 GB for the app, 512 MB each for scorer and sync),
one 1 GB volume, one managed Redis. The app keeps one machine warm
(`min_machines_running = 1`) so a contestant loading the leaderboard mid-event
never waits on a cold start; scorer and sync are always-on by nature.

## Tear down

```sh
fly apps destroy ctf-in-a-box-app ctf-in-a-box-sync ctf-in-a-box-scorer
fly redis destroy <name>
./setup/ctf-setup.sh teardown      # archives the forks
```

## CI

The `shell` job runs `shellcheck` on `deploy.sh` and `bats deploy/fly/test/`
on any change to the module. There is no Fly account in CI and nothing is ever
deployed — the same posture as the Terraform job, and for the same reason:
these files are the kind that look right and are wrong, so the invariants get
asserted rather than eyeballed.
