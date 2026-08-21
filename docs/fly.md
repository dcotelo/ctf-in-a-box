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
| `srh` | Fly app (private) | **Required** — see below |
| `redis` | Managed Redis (`fly redis create`) | — |
| `caddy` | **not deployed** | Fly terminates TLS and issues certificates. |

### `srh` is required, and an earlier version of this page said otherwise

Fly's managed Redis is Upstash-operated, which made it tempting to conclude
that `srh` — whose whole job is faking the Upstash REST API in front of local
Redis — was redundant here. It is not.

`fly redis create` hands back a **`redis://` private URL and nothing else**.
The HTTP REST API (`UPSTASH_REDIS_REST_URL` / `_TOKEN`) is an Upstash **cloud**
feature, not part of the Fly integration. The app, scorer and sync speak REST
and only REST (`@upstash/redis` in the app, the same wire format hand-rolled in
`scorer/src/store.js` and `sync/src/redis.js`), so pointed at a `redis://` URL
they simply do not connect.

So `srh` is deployed as a fourth, private Fly app, pinned to the same image
digest as `docker-compose.yml`, and the other three reach Redis through it at
`http://<srh-app>.internal:80`. Exactly the compose topology.

If you have an Upstash **cloud** database — which does expose REST — you can
skip `srh` and set the two REST variables directly.

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
4. **Run `init`** — it prepares a Fly-specific env file and provisions Redis:

   ```sh
   ./deploy/fly/deploy.sh init --dry-run    # shows what it would do
   ./deploy/fly/deploy.sh init
   ```

   It copies your existing `.env`, rewrites `EVENT_URL` to
   `https://<app>.fly.dev`, generates an `SRH_TOKEN`, runs `fly redis create`,
   and captures the resulting `redis://` URL — all into `.env.fly`, mode `600`.

   Creating the database is **billable**, so it prints what it is about to
   make and requires a typed `create` first. It never overwrites an existing
   env file and reuses an existing database, so re-running is safe.

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
stays on your machine — and `--dry-run` **redacts secret values** rather than
echoing them, so previewing the deploy does not put your GitHub App private
key in a scrollback buffer or a screen share. Variable names and non-secret
values still print, which is what makes the preview worth reading.

If you also run a local compose stack, keep a **separate env file for Fly**
and pass it with `--env-file`. The two need different `EVENT_URL`s
(`http://localhost` for compose, the `https://` Fly hostname here), and
`deploy.sh` refuses the localhost one rather than deploying an app that would
answer `500` to every request.

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
      UPSTASH REST    |                              v
      over 6PN        |                          GitHub API
                      v                        (fork comments)
            +--------------------+
            |  ctf-in-a-box-srh  |   private; speaks REST, talks redis://
            +---------+----------+
                      |
                      v
              managed Redis (fly redis create)
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
