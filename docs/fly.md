---
title: Deploy on fly.io
---

[← Docs home](index.md)

# Deploy on fly.io

Stand the whole event up on [fly.io](https://fly.io) with one command. The
deployment is **one Fly app running one machine**, with every container of the
compose stack inside it — `app`, `scorer`, `sync`, `srh` and `redis`.

It runs the repo's real `docker-compose.yml`. Not a cloud-shaped copy of it:
the compose file Fly deploys is *rendered* from that file on every deploy, so
what runs at the event is what you exercised locally.

- [Prerequisites](#prerequisites)
- [Deploy](#deploy)
- [What actually runs](#what-actually-runs)
- [Why one machine](#why-one-machine)
- [The three things that bite](#the-three-things-that-bite)
- [Secrets](#secrets)
- [The rendered compose file](#the-rendered-compose-file)
- [Security differences from compose](#security-differences-from-compose)
- [Cost and shape](#cost-and-shape)
- [Tear down](#tear-down)
- [CI](#ci)
- [Who can read the secrets](#who-can-read-the-secrets)
- [Images are pinned by digest](#images-are-pinned-by-digest)

## Prerequisites

| Thing | Why |
| --- | --- |
| A Fly account and `flyctl` | [install](https://fly.io/docs/flyctl/install/), then `fly auth login` |
| Docker | Images are built here and pushed to Fly's registry; the render shells out to `docker compose` |
| A finished `event.yaml` | Baked into the app image at build time, and handed to `sync` at start-up |
| A `.env` from `ctf-setup.sh secrets` | `init` copies it and tops it up |
| A GitHub OAuth app | Its callback must match the deployed hostname exactly |
| Access to a `SCORE_IMAGE` | Mirrored into Fly's registry so the forks and the leaderboard judge with the same artifact |

Poll mode is the fit here — outbound only, no inbound scoring surface. Push
mode works, but it exposes `POST /score` publicly and is not what this module
is shaped for.

## Deploy

```sh
# 1. Prepare the Fly env file. Touches nothing on Fly, needs no CLI.
#    Asks which region to run in.
./deploy/fly/deploy.sh init

# 2. Preview. Makes NO fly calls, and redacts every secret value.
./deploy/fly/deploy.sh --dry-run

# 3. Go.
./deploy/fly/deploy.sh
```

`init` writes `.env.fly` (mode 600, gitignored) from `.env`, rewrites
`EVENT_URL` to your app's Fly hostname, and generates `SRH_TOKEN` and
`REDIS_PASSWORD` if they are absent. It never overwrites an existing file — it
tops one up, so re-running is safe.

After rotating anything at GitHub, re-sync the external credentials:

```sh
./deploy/fly/deploy.sh init --refresh   # then deploy again
```

Changed only `event.yaml` or a secret, and want to skip the image rebuild?

```sh
./deploy/fly/deploy.sh --skip-build
```

The script will remind you that `event.yaml` is baked at build time, so
`--skip-build` will *not* pick up a config change.

### Finish by hand

1. **OAuth callback** must be exactly `https://<app>.fly.dev/api/auth/callback/github`.
   Sign-in fails with a `redirect_uri` mismatch otherwise.
2. **Check `/admin` loads** for a login listed in `event.yaml`'s `admins`. A
   403 there almost always means the app image was built without
   `EVENT_CONFIG_B64`.

## What actually runs

One machine, five containers, sharing one network namespace:

| Container | Port | Reached at | Public? |
| --- | --- | --- | --- |
| `app` | 3000 | — | **yes**, via Fly's proxy |
| `scorer` | 4000 | `http://localhost:4000` | no |
| `srh` | 80 | `http://localhost:80` | no |
| `redis` | 6379 | `127.0.0.1:6379` | no |
| `sync` | — | outbound only | no |

Only one container receives inbound traffic, chosen by matching
`internal_port` in `fly.toml`. It is 3000, which is the app.

`caddy` is absent — Fly terminates TLS and issues certificates. It is left out
by naming the deployed services explicitly, *not* by giving caddy a compose
profile, so nothing about a local bring-up changes.

## Why one machine

Because the alternative does not work.

**Fly's private network (6PN) is IPv6-only. srh's Redis client is IPv4-only.**
srh is a prebuilt third-party image whose Elixir release bundles redix 1.1.5;
redix supports `socket_opts` — where `:inet6` would go — but srh builds its
options from the connection string alone and offers no knob for it.

An earlier version of this module deployed five Fly apps and could never get
srh to reach redis. The symptom is a liar: `nc` to `redis.internal:6379`
succeeds, redis looks healthy, and srh repeats `SRH was unable to connect to
the Redis server` forever.

Containers inside one machine reach each other over `localhost`, on IPv4. That
removes the problem instead of routing around it — and it is cheaper.

Full reasoning, and the alternatives that lost, in
[ADR 42](decisions.md#adr-42-one-fly-machine-running-the-real-compose-file-not-five-fly-apps).

## The three things that bite

### 1. `event.yaml` is baked at BUILD time

The app reads its config from a bundle generated during `next build`, from the
`EVENT_CONFIG_B64` build arg. Deploy without it and the build *succeeds*, with
an empty `admins` list and generic branding — `/admin` then 403s for everyone,
including you, with no error anywhere to explain it.

`deploy.sh` always passes it. This only bites if you build by hand, or use
`--skip-build` after editing `event.yaml`.

`sync` takes the same variable at **start-up** rather than build time, which
is how it gets the config on a machine with no repo checkout to bind-mount
from. Locally it still reads the mounted `./event.yaml`; the variable wins
only when it is set and non-empty.

### 2. Images are built here, not by Fly

Fly builds nothing. Its compose parser cannot pass build args, and refuses a
file where more than one service declares `build:` — `docker-compose.yml` does
so twice.

So `deploy.sh` builds `app` and `sync` locally, pushes them to
`registry.fly.io`, and mirrors the scorer image across. **Everything is built
`--platform linux/amd64`**: Fly machines are amd64, and an image built on
Apple Silicon without it fails at start with an exec format error, after a
deploy that looked fine.

The scorer is **mirrored, not rebuilt**. Fly cannot pull from a private
third-party registry and has no flag for credentials, so the image is copied
into Fly's own registry with `docker buildx imagetools create`, which
preserves the digest. The scorer serving your leaderboard must be the same
artifact the forks pull to judge PRs, or the totals disagree.

### 3. One volume, region-pinned, shared by two services

**A Fly machine permits exactly one volume** — `invalid config.mounts, only 1
volume supported`, reported only when the machine is created, after images are
pushed and IPs provisioned.

`redis`'s append-only file and `sync`'s cursor therefore share it, under
separate directories:

| | Local (compose) | Fly |
| --- | --- | --- |
| `REDIS_DIR` | `/data` | `/data/redis` |
| `STATE_PATH` | `/state/state.json` | `/data/sync/state.json` |

Both are knobs in `docker-compose.yml` defaulting to the local layout, with
`.env.fly` setting the Fly values — so nothing about a compose stack changes,
and you can see where your data lives rather than having a renderer decide it.

Compose's named volumes are **ignored** by Fly in a compose file; the mount is
declared as `[[mounts]]` in `fly.toml`.

`init` asks which region to run in and writes it to `.env.fly`, and that one
answer drives the volume and the deploy. Changing it later means destroying
and recreating it, so pick the one nearest your contestants.

Losing the sync cursor is not fatal but is noisy: the poller re-reads every
comment in every fork from scratch.

## Secrets

**Credentials travel in the rendered compose file**, which is therefore a
secret file: mode 600, gitignored, and deleted as soon as the deploy finishes.
The dry run redacts every value it prints — it shows which variables get set,
not what they are — and keeps the rendered file so you can review it.

This is not the arrangement the module was built with. Fly's documentation says
secrets set with `fly secrets` are "global and available to every container";
they are not. A machine's containers receive only their own environment, which
comes from the compose file. With the values stripped, every container started
without credentials while `fly secrets list` reported all fourteen as
`Deployed` — the app answering 500 from better-auth's default-secret error, the
scorer refusing to start, sync falling back to an `event.yaml` that does not
exist on a Fly machine.

`deploy.sh` still sets `fly secrets` as well, so nothing regresses if Fly
changes this.

**The upside is real scoping**, which Fly's global secrets could not give:
each credential appears only under the service `docker-compose.yml` grants it
to. The `app` container never receives `REDIS_PASSWORD`; `redis` never receives
`GITHUB_CLIENT_SECRET`.

`.env.fly` is gitignored, mode 600, and separate from `.env` on purpose: a
compose stack and a Fly deployment need different `EVENT_URL`s, and one file
cannot hold both.

## The rendered compose file

`deploy/fly/render-compose.sh` turns `docker-compose.yml` into
`compose.fly.yml` at the repo root (generated, gitignored, mode 600). Read it
after a dry run — it is exactly what Fly will deploy. It **does** hold
credentials, which is why a real deploy removes it when it finishes.

The render exists because **flyctl's compose parser is not Docker's**. It is a
hand-rolled `yaml.v3` unmarshal, and as of flyctl 0.4.87 it implements neither
`profiles:`, nor `${VAR}` interpolation, nor build `args:`. `docker compose
config` implements all three correctly, so the real file goes through Docker
first.

On top of that, the render:

- **keeps secret values, and refuses to write them anywhere git can see** —
  a fail-closed check asks `git check-ignore` directly and deletes the file if
  the answer is no
- **unescapes compose-only `$$`** — to compose it means a literal `$`, but Fly
  passes it straight through, and `sh -c` would expand `$$` as the shell's PID
- **rewrites service names to `localhost`** — there is no DNS between
  containers in one namespace, including hosts that follow userinfo, as in
  `redis://:PASSWORD@redis:6379`
- **drops** bind mounts, named volumes, networks and profiles

Never edit the rendered file. Every change belongs in `docker-compose.yml`,
which is the point of rendering it.

## Security differences from compose

Two properties the local stack has do **not** survive on Fly. Neither is new
to this module — the five-app version had already lost them — but they are
worth knowing before you run a public event.

**No `frontend`/`backend` network split.** [ADR 41](decisions.md) cuts the app
tier off from `redis:6379` so a compromised app cannot bypass srh's bearer
token. One machine has one network namespace, so that route is open, and
binding redis to `127.0.0.1` would not help because containers share loopback.
**`requirepass` is the whole control on Fly**, which is why `REDIS_PASSWORD`
is mandatory rather than optional.

**No per-service secret scoping**, as above.

What does hold: no inbound scoring surface in poll mode, TLS from Fly, srh
never public, and the datastore reachable from nothing outside the machine.

## Cost and shape

One machine — `shared-cpu-2x`, 2 GB — plus one 1 GB volume. Sized for five
containers with Next.js as the heavy one; the scorer only *serves* here, since
judging runs on GitHub's runners.

### Autostop

The machine **does not stop when idle**, by default. Autostop suits a stateless
web app an inbound request can wake; this one also holds redis and the sync
poller. While it is stopped the leaderboard does not advance — contestants' PRs
are still scored by GitHub Actions, but the comments pile up uncollected until
someone loads a page and wakes the machine.

That is wrong *during* an event and reasonable *between* them. A kit left
standing for a chapter that runs a CTF twice a year is paying for idle time,
so it is a knob in `.env.fly`:

```sh
FLY_AUTO_STOP=off       # default: always running
FLY_AUTO_STOP=stop      # stopped when idle, cold start on the next request
FLY_AUTO_STOP=suspend   # memory snapshotted and restored, much faster wake
```

`deploy.sh` warns on every deploy where it is not `off`, and refuses a value
that is not one of the three (`true` is the obvious guess and is not one of
them). It never edits `fly.toml`: the substitution goes to a temporary copy,
with `min_machines_running` dropped to 0 — leave that at 1 and Fly keeps a
machine up regardless, so the setting looks applied and does nothing.

**Turn it off before an event starts.**

## Tear down

```sh
fly apps destroy ctf-in-a-box
```

That takes the volume with it. Export anything you want to keep first.

## CI

`.github/workflows/ci.yml`'s `shell` job shellchecks both scripts and runs
`bats deploy/fly/test/` — 56 assertions covering `fly.toml`'s invariants, the
render's output (no secret values, no `$$`, every service on loopback with an
image, no leftover build/networks/volumes/profiles keys), and `deploy.sh`'s
guards. The render runs for real; nothing is ever deployed, and no Fly account
is involved.

## Who can read the secrets

Credentials reach the containers through the rendered compose file's
`environment:` blocks, because that is the only channel Fly gives a
compose-defined container. They therefore end up in the **machine
configuration**, and anyone who can reach the app on Fly can read them:

```sh
fly machines list --app <app> --json     # prints every container's env
fly ssh console --app <app> -C env
```

That is not unique to this module — `fly secrets` values are also readable from
inside the machine by anyone who can `fly ssh console` — but the machine config
makes them readable without a shell, and it is easy to paste one of those dumps
into a terminal, a screen share or an issue. Treat `fly machines list --json`
output as secret material.

The compensation is that each credential is scoped to the one service that
needs it: the app container never receives `REDIS_PASSWORD`, and `redis` never
receives `GITHUB_CLIENT_SECRET`. Fly's own global secrets cannot express that.

## Images are pinned by digest

`deploy.sh` resolves each image to its digest after pushing, so the rendered
compose names the exact artifact that was just built.

A tag is a moving pointer that Fly resolves when the machine starts, and a
rebuilt-and-repushed `:scorer` did **not** reach a running machine: the registry
held the new image, the machine kept serving the old one, and the only symptom
was a `404` on a route the new build has and the old one does not. Nothing in
the deploy output was wrong.

It also makes a deploy reproducible — redeploying the same file later brings up
the same bytes, not whatever the tag points at by then.
