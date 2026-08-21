# Deploy on fly.io

Run the whole event as **one Fly app, one machine, five containers**, instead
of a box you administer. `deploy/fly/deploy.sh` up, `fly apps destroy` down.

Full walkthrough: [`docs/fly.md`](../../docs/fly.md).
Why it is shaped this way: [ADR 42](../../docs/decisions.md).

## What is in here

| File | Job |
|---|---|
| `fly.toml` | The app: which container serves the public, the volume, the machine size |
| `render-compose.sh` | Turns the repo's `docker-compose.yml` into the compose file Fly deploys |
| `deploy.sh` | `init` (env file) and the deploy: build, push, mirror, render, secrets, deploy |
| `test/fly.bats` | 51 assertions, run by CI's `shell` job. Nothing is ever deployed |
| `compose.fly.yml` | **Generated**, gitignored. The rendered file Fly actually reads |

## It runs the real compose file

`fly.toml` points at a compose file through `[build.compose]`, and that file is
*rendered* from the repo's `docker-compose.yml` on every deploy. There is no
hand-maintained cloud twin to drift — the same five services, wired the same
way, from one source.

| Compose service | On Fly |
|---|---|
| `app` | container, the only one reachable from the internet (port 3000) |
| `scorer` | container, `http://localhost:4000` |
| `sync` | container, outbound only, one volume |
| `srh` | container, `http://localhost:80` |
| `redis` | container, `127.0.0.1:6379`, one volume |
| `caddy` | **absent** — Fly terminates TLS and issues certificates |

caddy is excluded by naming the deployed services explicitly in the render,
**not** by giving it a compose profile. Profiling it would make the edge
opt-in for every *local* bring-up, so one forgotten flag would mean an event
with no ingress.

## Why one machine and not five apps

**Fly's private network (6PN) is IPv6-only. srh's Redis client is IPv4-only.**

srh is a prebuilt third-party image whose Elixir release bundles redix 1.1.5.
redix supports `socket_opts` — where `:inet6` would go — but srh builds its
connection options from the connection string alone and exposes no knob for
it. A five-app deployment therefore has no way for srh to reach redis, and the
symptom lies: `nc` to `redis.internal:6379` succeeds, redis looks healthy, and
srh repeats `SRH was unable to connect to the Redis server` forever.

Containers inside one machine share a network namespace and reach each other
over `localhost`, on IPv4. That removes the failure rather than working around
it.

Reproducing it takes about a minute and needs no Fly account: create an IPv6
docker network, run redis and srh on it, point srh at the address. Identical
image, redis and password — IPv4 literal works, IPv6 literal does not.

## Why the compose file is rendered, not copied

flyctl's compose parser is **not** Docker's. It is a hand-rolled `yaml.v3`
unmarshal (`internal/containerconfig/compose.go`), and as of flyctl 0.4.87 it
implements none of:

- `profiles:` — every service in the file is deployed
- `${VAR}` interpolation — `${SRH_TOKEN}` arrives as that literal string
- build `args:` — so `EVENT_CONFIG_B64` could never be baked

and it rejects a file where more than one service declares `build:`
(`only one service can specify build`), which `docker-compose.yml` does twice.

`docker compose config` implements all of them correctly, because it *is*
Docker's parser. So the real file goes through Docker first and Fly receives
the result. On top of that the render:

1. **Keeps secret values, and guards the file instead.** Per-container
   `environment:` is the only channel that reaches a container in a Fly
   machine — `fly secrets` does not, despite Fly's docs saying secrets are
   "global and available to every container". So the output is a credential
   file: mode 600, deleted once the deploy succeeds, and a fail-closed check
   asks `git check-ignore` directly and deletes it if the answer is no. The
   compensation is scoping Fly cannot express: the app never receives
   REDIS_PASSWORD, redis never receives GITHUB_CLIENT_SECRET.
2. **Unescapes `$$`.** To compose it means a literal `$`; Fly passes it
   through untouched, so `sh -c` would expand it as the shell's PID and redis
   would come up with a password like `12345REDIS_PASSWORD` — healthy, and
   impossible to authenticate against.
3. **Rewrites service names to `localhost`.** No DNS exists between containers
   in one namespace. Both URL forms are rewritten — `//host:` and the
   userinfo form `//user:pass@host:`, which srh's connection string uses and
   which an earlier version missed.
4. **Drops** bind mounts, named volumes, networks and profiles — none of which
   mean anything on a Fly machine.

Never edit `compose.fly.yml`. Every change belongs in `docker-compose.yml`.

## Guards `deploy.sh` carries

Each of these caught a real mistake:

- non-https `EVENT_URL` refused (the app refuses to serve production over
  plain HTTP — ADR 39)
- `<placeholder>` left in `EVENT_URL` refused
- `EVENT_URL` host vs app name → **warns**, never fails; a custom domain is
  legitimate
- secret values redacted in `--dry-run`, which makes no `fly` calls at all
- env file chmod 600 even when it already existed
- a missing variable is named individually, not as a list
- `--skip-build` says plainly that `event.yaml` will not be picked up, because
  that config is baked into the app image at build time
- images built `--platform linux/amd64`; an arm64 image deploys cleanly and
  then dies with an exec format error

## Two things this deployment cannot give you

Both were already true of the five-app version. See ADR 42.

- **No `frontend`/`backend` network split** (ADR 41). One machine, one network
  namespace — every container can reach `redis:6379`, and binding to
  `127.0.0.1` would not help because loopback is shared too. `requirepass` is
  the whole control here, which is why `REDIS_PASSWORD` is mandatory.
- **No per-service secret scoping.** Fly's secrets are global to the machine.
