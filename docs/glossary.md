---
title: Glossary
---

[← Docs home](index.md)

# Glossary

The words this kit uses precisely, for the reader who keeps tripping on one.
Each entry links the doc that owns the full story. If you're trying to *do*
something rather than decode a term, start at the [docs home](index.md)
instead.

**Control plane** — what this kit is: the shared spine every event runs on
(GitHub org, team registration, leaderboard, admin panel, scoring pipeline),
as opposed to the challenge content plugged into it. The boundary is the
[module contract](modules.md).

**Module** — a CTF vertical plugged into the control plane: its own
challenges, scoring logic, and provisioning. Three ship today:
`secure-development`, `quiz`, `classic`. Any subset runs alone or together.
See [modules.md](modules.md).

**Target** — one deliberately vulnerable app the Secure Development module
scores (Juice Shop, DVWA, WebGoat, Security Shepherd, VulnerableApp, VAmPI).
Each event forks its targets from their own upstreams at pinned versions
(`setup/targets.tsv`); targets are never vendored into this repo.

**Fork** — the event org's copy of a target, which a contestant forks again
and patches. The fork's own GitHub Action is what scores a PR — the box never
runs contestant code.

**Rubric** — the scoring content for one target: what to check and what each
challenge is worth. Two grammars exist — declarative HTTP **probes**
(`<target>.yaml`) and executable `node:test` suites priced by a
**catalogue** (`catalogue.<target>.json`) — and one rubric directory may mix
them. See [scorer.md](scorer.md).

**Probe** — one declarative request/expect check inside a YAML rubric: send
this HTTP request, expect this status/body. The executable grammar replaces
probes with real test code.

**Catalogue** — the priced challenge list for an executable-grammar target:
challenge ids, names, and difficulty (which is the point value).

**Marker** — the machine-readable score comment the fork's Action posts on a
PR: `<!-- ctf-score: {json} -->`. The marker is trust-authoritative — the
poller ingests it only from `github-actions[bot]`-authored comments, and the
workflow writes it only from the judge's own output. See
[architecture.md](architecture.md)'s score data flow.

**Poll vs push** — the two score transports. **Poll** (default): the `sync`
service pulls score comments from GitHub every ~30 s — zero inbound network
surface, works behind NAT and venue wifi. **Push**: the fork's Action POSTs
the score straight to the box — near-instant, needs a public URL. Canonical
comparison: [hosting.md](hosting.md#poll-vs-push).

**Scorer** — the one score writer in the system: an engine (`scorer/`) with
two modes — **serve** (the leaderboard API and the bearer-authed
`POST /score`) and **judge** (runs a rubric against a target inside the
fork's Action). See [scorer.md](scorer.md).

**Freeze vs scoring window** — two ways scoring stops. **Freeze** is the
manual switch: ingestion holds (queued, never lost), fork Actions keep
running. The **scoring window** (`scoringStartsAt`/`scoringEndsAt`) does the
same on a schedule. Both are evaluated at read time by three independent
readers that must agree. See [operations.md](operations.md) and
[ADR 32](decisions.md#adr-32-scheduled-windows-evaluated-at-read-time-in-three-readers).

**Vacuous pass** — a rubric check that "passes" only because the app wasn't
actually up or useful — it proves nothing and would hand out free points.
The kit's sweep (`scorer/tools/vacuous-sweep.mjs`) points every rubric at a
deliberately useless stub and fails if anything passes. See
[scorer.md](scorer.md).

**Oracle discipline** — the rule that contestant-visible scoring output is
pass/fail and points only, never which assertion failed or how. An
information-rich comment tells a contestant exactly which check to game.
See [modules.md, Section 6](modules.md#section-6-security-requirements-non-negotiable).

**srh** — `hiett/serverless-redis-http`, the Upstash-compatible REST proxy in
front of Redis. It exists so the vendored app's `@upstash/redis` client works
unchanged against local Redis, and it is the only service on both compose
networks — the app tier has no route to `redis:6379` at all.

**event.yaml vs .env** — `event.yaml` is the event's identity (name, org,
modules, admins), baked into the app image at build time via
`EVENT_CONFIG_B64`; `.env` is the box's secrets and its URL. One
`event.yaml` deploys to any hostname because the URL deliberately lives only
in `.env` ([ADR 43](decisions.md#adr-43-one-url-and-it-lives-in-env-not-eventyaml)).
Its `modules:` list is the *starting* set, not the live truth: modules are
switched at runtime from `/admin` (`enabledModules` on `ctf:admin:settings`,
[ADR 52](decisions.md#adr-52-modules-are-switched-at-runtime-secure-development-is-configured-at-setup))
with the baked set as the outage fallback — Secure Development's *targets*
stay setup-configured, and no module toggle needs a rebuild.

## The project's names

Six names orbit "the project"; they are not interchangeable:

| Name | What it is |
|---|---|
| **CTF-in-a-box** | The product / brand (README, `dcotelo.github.io/ctf-in-a-box`). |
| **OWASP CTF** | The default event name a bare build shows (real events set `event.name`). |
| `owasp-ctf` | The local repo directory and the lowercase image namespace. |
| `OWASP-CTF` | The GitHub **org** the canonical targets are forked into (`github.org` default). |
| `ghcr.io/owasp-ctf/score` | The scorer image path. The lowercase `owasp-ctf` here is a registry-namespace convenience, not the `OWASP-CTF` org; override `SCORE_IMAGE` to your own org's GHCR. |
| `dc34-owasp-secure-development-ctf` | The upstream repo the rubrics are vendored from (see `scorer/rubric.owasp/PROVENANCE.md`). |

This project is not affiliated with or endorsed by the OWASP Foundation;
OWASP® is a registered trademark of the OWASP Foundation.
