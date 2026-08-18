<h1 align="center">🛡 CTF-in-a-box</h1>

<p align="center">
  <em>A self-hosted control plane for security-learning events — one box, one free GitHub org.<br>
  Its first module runs the OWASP Secure Development CTF: for a university, a high school, an OWASP chapter, a meetup.</em>
</p>

<p align="center">
  <a href="https://github.com/dcotelo/ctf-in-a-box/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/dcotelo/ctf-in-a-box/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://dcotelo.github.io/ctf-in-a-box/"><img alt="docs" src="https://img.shields.io/badge/docs-github%20pages-blue"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-green"></a>
  <img alt="6 targets" src="https://img.shields.io/badge/targets-6-brightgreen">
  <img alt="321 challenges" src="https://img.shields.io/badge/challenges-321-brightgreen">
  <img alt="requires docker compose v2" src="https://img.shields.io/badge/requires-docker%20compose%20v2-lightgrey">
  <img alt="no cloud" src="https://img.shields.io/badge/cloud-none-informational">
</p>

<p align="center">
  <strong>This CTF was built for a conference. This kit is for everyone else.</strong>
</p>

**CTF-in-a-box is a control plane, not a single game.** It gives an event its
shared spine — a GitHub org, team registration, a live leaderboard, an
organizer admin panel, and the scoring pipeline that feeds it — and **modules**
plug challenge content into that spine. The first module is the **OWASP Secure
Development CTF**; the box is built to host further modules (forensics,
API-security, cloud, …) on the same spine as they land. The
[module contract](docs/modules.md) is the boundary between the two. What
follows describes the platform and that first module.

The OWASP Secure Development CTF teaches defence rather than attack: a
contestant forks a deliberately vulnerable app, finds the flaw, **patches** it,
and opens a pull request. A GitHub Action scores the patch and the score lands
on a leaderboard. It is a genuinely good way to teach secure coding — and until
now, running one meant standing up Vercel, Upstash, Lambda and DynamoDB, holding
the cloud bill, and having access to a private scoring image.

That is a reasonable ask for a conference with a budget. It is an unreasonable
ask for a university security course, a high-school club, an OWASP chapter
night, or a weekend workshop.

This kit removes it. Everything runs from Docker Compose on one machine you
already have — a laptop, a spare desktop, a small VPS — plus one free GitHub
org for the forks. The rubrics for all six targets ship inside the box, so there
is no private image to request and no scoring code to write. Nothing is billed,
nothing phones home, and when the event ends you archive the repos and stop the
stack.

**Who this is for:** anyone who wants to run this event and does not want to
become a cloud operator to do it — course instructors, club organizers, OWASP
chapter leads, workshop facilitators, security teams running an internal
training day.

## What you get

**The platform** — the control plane every event runs on, module-independent:

| Feature | What it means for you |
|---|---|
| **Team scoring** | Per-team standings with self-registration, captains and join codes. A flag solved by several teammates counts once (dedupe). Solo players are teams of one. |
| **Live leaderboard + score-over-time graph** | A ranked team leaderboard with a CTFd-style graph drawn from real per-solve timestamps. |
| **Organizer admin panel** | `/admin`, allowlisted: freeze the leaderboard, toggle hints and their cost, open/close team registration. |
| **Scoring pipeline** | A GitHub-Actions-fed pipeline (poll or push) with a single audited score writer — the transport a module submits scores through. |
| **Poll or push** | Poll mode (default) has zero inbound network surface — works behind NAT, on a laptop, on venue wifi. Push mode is near-instant if you have a public URL. |
| **One box, no cloud** | Runs from Docker Compose on a machine you already have, plus one free GitHub org. Nothing is billed, nothing phones home. |

**The Secure Development module** — the first challenge pack on that platform:

| Feature | What it means for you |
|---|---|
| **Patch-to-score scoring** | Contestants patch the vulnerability and open a PR; the pipeline scores the patch. Stock scores 0, a correct patch earns its points — gated both ways. |
| **6 targets, 321 challenges** | Juice Shop, DVWA, WebGoat, Security Shepherd, VulnerableApp and VAmPI. Rubrics ship in the box — no private image to request, no scoring code to write. |

<p align="center">
  <img alt="Contestant leaderboard with a row expanded to its per-app challenge breakdown, each flag marked patched or open" src="docs/assets/hero.jpg" width="820">
</p>

| Team leaderboard | Challenge browser |
|---|---|
| ![Team standings with a row expanded to members and the team's flags grouped by target, each marked patched or open](docs/assets/leaderboard.jpg) | ![Challenge browser](docs/assets/challenges.jpg) |

<sup>Captured from the contestant app running locally via <code>scripts/dev-stack up</code>
with seeded demo players. The app ships a fixed dark theme. The leaderboard ranks
<strong>teams</strong>, with a CTFd-style score-over-time graph drawn from real
per-solve timestamps; each row expands to show its members and every member's
points. The expanded team shows the shared-flag dedupe at work — the team's total
is less than its members' individual scores added up, because a flag solved by more
than one teammate counts once. Branding is the neutral "OWASP CTF" default — the
event name, targets, and links are all event-config driven.</sup>

## Quickstart

**Just run the wizard.** It asks for each value as it goes — your box URL, the
event details, the GitHub App + OAuth credentials — shows the instructions and
GitHub link for each, writes `.env` and `event.yaml` for you, does every
automatable step, guides you through the GitHub-UI ones, and resumes if you stop
and come back:

```sh
./setup/ctf-setup.sh            # guided, prompts for values, resumable
```

<p align="center">
  <img alt="The ctf-setup.sh guided wizard: ASCII banner and step-by-step prompts" src="docs/assets/wizard.jpg" width="820">
</p>

That takes you from an empty checkout to a running, scored event. Preview any
mutating step first by adding `--dry-run`. When it's provisioned,
`ctf-setup.sh doctor` shows a per-fork status matrix so you can see the whole
org at a glance.

**Want the details?** The full walkthrough — every discrete subcommand, each
UI-only step, and how the two GitHub apps differ — lives in
[docs/hosting.md](docs/hosting.md#quickstart-zero-to-a-scored-event).

Running on a cloud VM instead of your own machine? [docs/aws.md](docs/aws.md)
ships a Terraform module for a single-shot AWS deploy — `terraform apply` up,
`terraform destroy` down.

## The Secure Development module: targets and rubrics

The first module's content is a set of vulnerable **targets** and their
scoring **rubrics**. Contestants pick a target, fork the org's copy, patch it,
and open a PR. Each target's challenges are executable `node:test` suites,
priced by difficulty.

| Target | Challenges | Points | Notes |
|---|---:|---:|---|
| `vulnerableapp` | 110 | 187 | Largest target; scored 8-way parallel |
| `webgoat` | 69 | 137 | Two-stage build: Maven, then the fork's runtime-only Dockerfile |
| `dvwa` | 55 | 108 | Needs a MariaDB sibling and a schema init |
| `securityshepherd` | 40 | 79 | HTTPS, three-container stack, strictly serial |
| `juice-shop` | 38 | 141 | The only target whose difficulty runs to 6 stars |
| `vampi` | 9 | 16 | Self-contained; the quickest end-to-end proof |

<sup>Challenge/points counts are maintained by hand — re-check them after a
`vendor-rubric.sh` bump. Reference **patches** that prove a correct fix scores
(the positive-direction gate) live separately under [`patches/`](patches/README.md).</sup>

Enable any subset in `modules.secure-development.targets`. The rubrics live in
`scorer/rubric.owasp/`, vendored from
[OWASP-CTF/dc34-owasp-secure-development-ctf](https://github.com/OWASP-CTF/dc34-owasp-secure-development-ctf)
and pinned to a single upstream commit recorded in
`scorer/rubric.owasp/PROVENANCE.md`. Re-vendor against a newer commit with:

```sh
./scripts/vendor-rubric.sh --all --ref <sha>
```

Two rubric shapes are supported at once, and a single rubric directory may mix
them: `<target>.yaml` files use the declarative HTTP request/expect probe
grammar, and `<target>/tests/challenges/` directories use executable tests
priced by `catalogue.<target>.json`. Authoring guide:
[docs/scorer.md](docs/scorer.md).

**On rubric secrecy.** These rubrics are public. The targets are open source and
their solutions are already published, so the kit treats rubric privacy as
protection against check-gaming rather than against knowing the answers — an
accepted trade-off for a self-hosted event. Override with your own private
rubric at any time:

```sh
cp -r /path/to/private-rubric scorer/rubric
docker build -t ghcr.io/<org>/score:latest --build-arg RUBRIC_DIR=rubric scorer/
```

`scorer/rubric/` is gitignored and reserved for exactly this.

## Teams

Scoring is per team. Contestants self-register in the app — create a team to
become its captain and get a join code, or join an existing team by code.
Everyone ends up on a team; a solo player is simply a team of one. Captains
manage the roster from the app (rename, remove a member, transfer the
captaincy, regenerate the join code, or disband), and team size is capped at
four members. The leaderboard ranks **teams**, each row
expanding to its members and their individual points — and a flag solved by
several teammates counts **once**, so a team's total can be lower than its
members' scores added up. Organizers open or close registration from the admin
panel. Full details: [docs/operations.md](docs/operations.md#teams).

## Running an event

Once the stack is up at your `EVENT_URL`:

- Contestants sign in with GitHub, form or join a team, pick a target, fork it,
  patch the vuln, and open a PR back to the org's copy. The scoring Action runs
  and the score lands on the team leaderboard (~30 s in poll mode).
- Watch the poller: `docker compose logs -f sync`. All state lives in named
  Docker volumes, so a box reboot loses nothing.
- Manage the event from `/admin` (allowlisted): freeze the leaderboard, toggle
  hints, open/close team registration.
- When it's over, `./setup/ctf-setup.sh teardown` archives the target repos —
  then uninstall the GitHub App and delete the org's Actions secrets yourself.

Prerequisites, poll-vs-push, OAuth setup and config all live in
[docs/hosting.md](docs/hosting.md); the admin panel, verifying the kit, the
local dev-stack and event teardown in [docs/operations.md](docs/operations.md).

## Why it is built this way

- **Self-contained, no cloud.** Everything runs from Docker Compose on one box
  plus one free GitHub org. The rubric ships in the kit — no private image to
  request, no scoring code to write — and everything survives a reboot on named
  Docker volumes.
- **Stock scores zero, a patch earns its points.** Every target is gated: a
  test that passes against the *unpatched* app would be a free point for every
  contestant, so the build refuses to ship it.
- **Poll mode has zero inbound network surface.** Nothing has to reach your box
  — it polls GitHub for score comments — so a campus network, a locked-down
  lab, or venue wifi works without a firewall change.

The full reasoning, alternatives, and trade-offs are recorded as numbered ADRs
in [docs/decisions.md](docs/decisions.md).

## Documentation

| Document | What it covers |
|---|---|
| [docs/hosting.md](docs/hosting.md) | Standing the kit up — prerequisites, poll vs push, the GitHub OAuth app, and event config |
| [docs/aws.md](docs/aws.md) | Single-shot deploy on AWS — a Terraform module (`deploy/aws-terraform/`) for one ephemeral EC2 box: `apply` up, `destroy` down |
| [docs/operations.md](docs/operations.md) | Running an event — teams, the admin panel, verifying the kit, the local dev-stack, teardown, and status |
| [docs/architecture.md](docs/architecture.md) | How the stack fits together — diagram, score data flow, security model, testing strategy |
| [docs/scorer.md](docs/scorer.md) | The scorer engine: serve + judge modes, both rubric grammars, authoring and building |
| [docs/modules.md](docs/modules.md) | The module contract — the platform/module boundary, and what a new module must provide to plug into the control plane |
| [docs/decisions.md](docs/decisions.md) | Why it is built this way instead of the alternatives |

Rendered at **[dcotelo.github.io/ctf-in-a-box](https://dcotelo.github.io/ctf-in-a-box/)**.

## License

MIT — see [LICENSE](LICENSE). The vendored target apps under the rubric keep
their own upstream licenses.
