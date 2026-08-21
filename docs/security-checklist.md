---
title: Security checklist
---

[← Docs home](index.md)

# Organizer security checklist

One page to walk before an event. Everything here is a **deployment**
decision — the kit cannot make any of these calls for you, and most of them
have no visible symptom when they are wrong.

Read it alongside [SECURITY.md](https://github.com/dcotelo/ctf-in-a-box/blob/main/SECURITY.md),
which covers what to report and the one trust boundary that is deliberate:
the scorer builds and runs contestant-submitted code, because judging
submitted code is the product.

## The short version

| # | Check | If you get it wrong |
|---|---|---|
| 1 | `EVENT_URL` is `https://` | Organizer session cookie sniffable → admin takeover |
| 2 | `BETTER_AUTH_SECRET` is the generated one | Session cookies forgeable → any identity |
| 3 | `REDIS_PASSWORD` is set and unique | Compose refuses to start (fails closed) |
| 4 | Scorer image is private, forks granted Read | Rubric readable; or scoring fails on every PR |
| 5 | Sync GitHub App is private and least-privilege | Third parties can install your event's App |
| 6 | Poll mode unless you need push | Push exposes `/score` to the internet |
| 7 | `admins:` lists only real organizers | `/admin` can freeze scoring and wipe the event |
| 8 | Treat `better-auth` bumps as security changes | The login-identity denylist can regress |

---

## 1. `EVENT_URL` must be HTTPS

The session cookie is only marked `Secure` over HTTPS, and this app keeps
**no server-side session store** — the cookie *is* the identity. Sniffing an
organizer's cookie on the venue wifi is a full admin takeover, not a
nuisance.

**This one is enforced.** A production start with an `http://` `EVENT_URL`
pointing at anything other than loopback refuses to serve: the container
comes up and answers `500` to everything, with the reason in the first lines
of `docker compose logs app`. `http://localhost` is for local trials and
stays allowed.

If a deployment is deliberately TLS-less — a closed lab, an isolated
classroom network — set `ALLOW_INSECURE_EVENT_URL=1` to downgrade the refusal
to a warning. It is **not** for TLS terminated upstream: there the public URL
is still `https://`, so `EVENT_URL` should say `https://` and the check passes
on its own.

> **What the kit cannot see:** if you front the box with a plain-HTTP proxy
> while `EVENT_URL` says `https://`, cookies are sniffable and nothing in the
> app can detect it. Terminate TLS at the edge that contestants actually
> reach.

## 2. Use the generated `BETTER_AUTH_SECRET`

Sessions are stateless JWE cookies; their integrity rests entirely on this
value. `./setup/ctf-setup.sh secrets` generates one. Do not hand-set a short
or memorable value, and do not reuse one across events — a leaked secret from
a past event forges identities in the current one.

Rotating it invalidates every live session, which is the correct response to
a suspected leak mid-event.

## 3. `REDIS_PASSWORD` is required

Redis runs with `requirepass`, and compose reads the variable with `:?` — so
a missing value **fails the bring-up** rather than starting an
unauthenticated instance. Nothing to remember to switch on.

Two things follow that are worth knowing rather than acting on:

- Only `srh` is given the password, and only `srh` can reach Redis. `app`,
  `scorer` and `sync` sit on a separate compose network with no route to
  `redis:6379` at all, so a compromised app container cannot side-step the
  bearer token.
- An event provisioned before this change needs one line added to `.env` —
  see [Hosting → Upgrading an event that predates the Redis password](hosting.md#upgrading-an-event-that-predates-the-redis-password).
  `doctor` flags it with a generated value to paste.

This protects against a compromised *service*. It is no defence against
someone with shell on the box, who can read `.env`.

## 4. Keep the scorer image private, and grant each fork Read

The image bakes in the rubric. Keep `ghcr.io/<org>/score` **private** and
grant each fork Read under the package's *Manage Actions access*.

Access control is the actual defence — reverse-engineering the rubric out of
the image is assumed possible; the goal is to limit who can pull it.

**This is the one manual step with no API**, and it fails as a `docker pull`
error inside a scoring run, which reads like a scoring bug rather than a
missing grant. If a target has never been scored, its grant is unverified.
Score one PR per target before the event.

## 5. Keep the sync GitHub App private and least-privilege

The App needs only **issues, pull requests and metadata: read**. Keep it
private to the event org — a public App can be installed by anyone, and its
installation is what mints tokens against your event's repos.

The App's private key lives in `.env` as `GITHUB_APP_PRIVATE_KEY`. Treat that
file as the event's secret store: it also holds the OAuth client secret and
the scorer bearer token.

## 6. Prefer poll mode

Poll mode has **zero inbound scoring surface** — `caddy/Caddyfile.poll` has no
`/score` route at all, and the box needs no public URL for scoring. The poller
reaches out to GitHub; nothing reaches in.

Push mode exposes `/score` through Caddy, protected by a bearer token. Use it
only when you actually need it (no outbound access from the box, or you want
scores to land the instant a run finishes), and rotate `SCORER_TOKEN` between
events.

## 7. Audit `admins:` before you open registration

Anyone listed in `event.yaml`'s `admins` can freeze scoring, rewrite module
settings, seed demo data, and **wipe the event**. Matching is
case-insensitive on the GitHub login.

Two failure modes worth checking for explicitly:

- **The list is baked at BUILD time** via `EVENT_CONFIG_B64`. Building
  without it yields an empty `admins` list, so `/admin` 403s for everyone —
  including you. See [Hosting](hosting.md).
- A leftover login from a previous event still has full control.

## 8. Treat `better-auth` upgrades as security changes

`apps/web/src/lib/auth.ts` closes a long list of default endpoints — most
importantly `/update-user`, which would otherwise let any signed-in
contestant rewrite their own `login` and spend another player's points.
`disabledPaths` is a **denylist**, so a new auth plugin can introduce new
endpoints it does not cover.

`src/lib/__tests__/auth.test.ts` fails when that happens. Keep it a required
check, and read its failure as "a new endpoint appeared", not "the test is
stale".

## What this kit deliberately does *not* protect

Stated plainly so it is not mistaken for an oversight:

- **The target apps are intentionally vulnerable.** Finding and patching
  their flaws is the exercise. Do not report them as kit vulnerabilities.
- **The scorer builds and runs contestant-submitted code.** It holds
  `docker.sock` to boot the app as a sibling container. That boundary is
  inherent to judging submitted code and predates every flag discussed here
  — see [ADR 37](decisions.md#37-opting-in-to-the-fork-pr-checkout-pull_request_target-now-guards).
- **Contestants can see each other's scores.** The leaderboard is the point.
- **Classic-module flags are stored in plaintext** and visible to anyone who
  reaches `/admin`. `/admin` access is the actual secrecy boundary — see
  [Operations → Classic](operations.md#classic).
