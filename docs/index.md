---
title: CTF-in-a-box
---

# CTF-in-a-box

**Run the OWASP Secure Development CTF at your own event** — a university, a
high school, an OWASP chapter, a meetup — from one box and one free GitHub org.

The OWASP Secure Development CTF teaches defence rather than attack: a
contestant forks a deliberately vulnerable app, finds the flaw, **patches** it,
and opens a pull request. A GitHub Action scores the patch and the score lands
on a leaderboard.

It is a genuinely good way to teach secure coding — and until now, running one
meant standing up Vercel, Upstash, Lambda and DynamoDB, holding the cloud bill,
and having access to a private scoring image. That is a reasonable ask for a
conference with a budget. It is an unreasonable ask for a security course, a
student club, or a chapter night.

This kit removes it. Everything runs from Docker Compose on a machine you
already have, plus one free GitHub org for the forks. The rubrics for all six
targets ship inside the box, so there is no private image to request and no
scoring code to write.

## What contestants see

![Leaderboard with score-over-time graph](assets/hero.jpg)

| Leaderboard | Challenge browser |
|---|---|
| ![Leaderboard standings with score-over-time graph](assets/leaderboard.jpg) | ![Challenge browser](assets/challenges.jpg) |

<sup>Captured from the contestant app running locally via <code>scripts/dev-stack up</code>
with seeded demo players — a fixed dark theme, a CTFd-style score-over-time graph drawn
from real per-solve timestamps, and per-contestant patched/non-patched standings. Branding
is the neutral "OWASP CTF" default; the event name, targets, and links are event-config driven.</sup>

## Targets

Enable any subset in `event.yaml` — nine challenges for a two-hour club
session, all 321 for a semester.

| Target | Challenges | Points |
|---|---:|---:|
| `vulnerableapp` | 110 | 187 |
| `webgoat` | 69 | 137 |
| `dvwa` | 55 | 108 |
| `securityshepherd` | 40 | 79 |
| `juice-shop` | 38 | 141 |
| `vampi` | 9 | 16 |

Every target's rubric is vendored from the upstream event repo, pinned to a
single commit, and gated: a test that passes against the *unpatched* app would
be a free point for every contestant, so the build refuses to ship it.

## Quickstart

```sh
./setup/ctf-setup.sh check
./setup/ctf-setup.sh secrets
cp event.yaml.example event.yaml   # edit: org, targets, admins, url
./setup/ctf-setup.sh org           # fork targets, render workflows, mirror image
docker compose --profile poll --profile app up -d
```

Poll mode is the default and needs no inbound network access — nothing has to
reach your box from the internet, so a campus network, a locked-down lab or
venue wifi works without a firewall change.

Full prerequisites, OAuth setup, and operational details live in the
[README on GitHub](https://github.com/dcotelo/ctf-in-a-box#quickstart).

## Organizer admin panel

Anyone in `event.yaml`'s `admins` list can sign in and reach `/admin` for a
live status view (poller heartbeat, last error, leaderboard freshness) and
two runtime controls: a **freeze** switch that pauses ingestion — not fork
Actions, so PRs keep getting judged, nothing is lost, only queued until you
resume — and a hint on/off + cost override on top of the build-time
default. Every change is recorded in a capped audit log. See the
[README](https://github.com/dcotelo/ctf-in-a-box#organizer-admin-panel) for
the full picture, including a known v1 limitation on the hint toggle's
reach.

## Learn more

- [Module contract](modules.md) — what a CTF vertical (target list,
  challenge catalogue, scoring transport) must satisfy to plug in.
- [Architecture](architecture.md) — what runs where, how a score gets
  from a contestant's PR to the leaderboard.
- [Scorer](scorer.md) — both rubric grammars, building your own scorer
  image from the in-repo engine, and wiring the self-contained scoring
  workflow.
- [Decisions](decisions.md) — numbered ADRs for why the kit is built the
  way it is.

## Status

The kit is complete and tested offline: the smoke test (`scripts/smoke.sh`)
exercises the whole poll pipeline end to end, and every target's rubric is
gated against the unpatched app — the published stock image where the target
has one, a build of pinned upstream source where it does not, and for WebGoat
both, so the path a contestant's own fork takes is gated too. Real,
live-GitHub scoring depends on a small
number of changes still landing in other OWASP-CTF repos. See
[Status and upstream dependencies](https://github.com/dcotelo/ctf-in-a-box#status-and-upstream-dependencies)
in the README for the current state.

---

[Source on GitHub](https://github.com/dcotelo/ctf-in-a-box) ·
[OWASP-CTF/dc34-owasp-secure-development-ctf](https://github.com/OWASP-CTF/dc34-owasp-secure-development-ctf)
(underlying spec and target apps)
