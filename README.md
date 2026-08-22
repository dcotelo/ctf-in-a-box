<h1 align="center">🛡 CTF-in-a-box</h1>

<p align="center">
  <em>A self-hosted control plane for security-learning events — one box, one free GitHub org.<br>
  Run it for a university, a high school, an OWASP chapter, a meetup.</em>
</p>

<p align="center">
  <a href="https://github.com/dcotelo/ctf-in-a-box/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/dcotelo/ctf-in-a-box/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://dcotelo.github.io/ctf-in-a-box/"><img alt="docs" src="https://img.shields.io/badge/docs-github%20pages-blue"></a>
  <a href="LICENSE"><img alt="license MIT" src="https://img.shields.io/badge/license-MIT-green"></a>
  <img alt="3 modules" src="https://img.shields.io/badge/modules-3-blue">
  <img alt="secure development module: 6 targets, 321 challenges" src="https://img.shields.io/badge/secure%20dev-6%20targets%20%C2%B7%20321%20challenges-brightgreen">
  <img alt="requires docker compose v2 and the gh CLI" src="https://img.shields.io/badge/requires-docker%20compose%20v2%20%2B%20gh-lightgrey">
  <img alt="no cloud" src="https://img.shields.io/badge/cloud-none-informational">
</p>

<p align="center">
  <strong>This CTF was built for a conference. This kit is for everyone else.</strong>
</p>

## What this is

**A control plane, not a single game.** The box gives an event its shared
spine — a GitHub org, team registration, a live leaderboard, an organizer
admin panel, and the scoring pipeline that feeds it. **Modules** plug
challenge content into that spine, and any subset can run alone or together:

| Module | How it's played | How it's scored |
|---|---|---|
| **Secure Development** | Fork a deliberately vulnerable app, find the flaw, **patch** it, open a PR | A GitHub Action runs the rubric against the patch |
| **Quiz** | Answer single- and multi-select security questions | Graded in the app, instantly — no GitHub needed |
| **Classic CTF** | Find the flag on a jeopardy-style board, submit the string | Graded in the app, instantly — no GitHub needed |

The [module contract](docs/modules.md) is the boundary between spine and
content, so the box is built to host further modules — forensics,
API-security, cloud — as they land.

**Why it exists.** The Secure Development CTF teaches defence rather than
attack, and it is a genuinely good way to teach secure coding. Until now,
running one meant standing up Vercel, Upstash, Lambda and DynamoDB, holding
the cloud bill, and having access to a private scoring image. That is a
reasonable ask for a conference with a budget. It is an unreasonable ask for
a university security course, a high-school club, an OWASP chapter night, or
a weekend workshop.

This kit removes it. Everything runs from Docker Compose on one machine you
already have — a laptop, a spare desktop, a small VPS — plus one free GitHub
org for the forks. The rubrics for all six targets ship inside the box, so
there is no private image to request and no scoring code to write. Nothing is
billed, nothing phones home, and when the event ends you archive the repos
and stop the stack.

**Who it's for:** anyone who wants to run this event and does not want to
become a cloud operator to do it — course instructors, club organizers, OWASP
chapter leads, workshop facilitators, security teams running an internal
training day.

<p align="center">
  <img alt="Walkthrough of the contestant leaderboard: hovering the score-over-time graph to read every team's points at that instant, then expanding a team to its members and its per-target flags, each marked patched or open with its OWASP category" src="docs/assets/demo.gif" width="820">
</p>

## Quickstart

You need **Docker with Compose v2**, the **[`gh` CLI](https://cli.github.com)**
(authenticated), **`openssl`**, and **one free GitHub org** for the event.
`./setup/ctf-setup.sh check` verifies all of it before you start.

**Then just run the wizard.** It asks for each value as it goes — your box
URL, the event details, which modules to run, the GitHub App + OAuth
credentials — shows the instructions and GitHub link for each, writes `.env`
and `event.yaml` for you, does every automatable step, guides you through the
GitHub-UI ones, and resumes if you stop and come back. It asks only what the
modules you enabled actually need, so a quiz-only event is never asked to
pick vulnerable apps:

```sh
./setup/ctf-setup.sh            # guided, prompts for values, resumable
```

<p align="center">
  <img alt="The ctf-setup.sh guided wizard: ASCII banner and step-by-step prompts" src="docs/assets/wizard.jpg" width="820">
</p>

That takes you from an empty checkout to a running, scored event. Preview any
mutating step first with `--dry-run`. Once provisioned,
`./setup/ctf-setup.sh doctor` shows a per-fork status matrix so you can see
the whole org at a glance.

**Want the details?** Every discrete subcommand, each UI-only step, and how
the two GitHub apps differ:
[docs/hosting.md](docs/hosting.md#quickstart-zero-to-a-scored-event).

**On a cloud VM instead?** [docs/aws.md](docs/aws.md) ships a Terraform module
for a single-shot AWS deploy — `terraform apply` up, `terraform destroy` down.

## What you get

**The platform** — the control plane every event runs on, module-independent:

| Feature | What it means for you |
|---|---|
| **Team scoring** | Per-team standings with self-registration, captains, join codes and shareable `/join/<code>` invite links. A team is required to score; **Play solo** makes a team of one in a click. A flag solved by several teammates counts once (dedupe). |
| **Live leaderboard + score-over-time graph** | A ranked team leaderboard with a CTFd-style graph drawn from real per-solve timestamps. |
| **Organizer admin panel** | `/admin`, allowlisted: freeze the leaderboard, schedule the scoring and registration windows, toggle hints and their cost, set the team cap and the score cooldown, grant admin to co-organizers, author each module's content, and reset the event between rehearsals. All without a rebuild. |
| **Live-event support** | Act on one contestant or one team instead of wiping the event: look someone up, reset their progress, delete them, or take over a team whose captain has disappeared. Every action audited with actor and target. |
| **Engagement metrics** | Participation funnel, solves over time, per-challenge difficulty (solve rate, average tries, time-to-solve) and hint usage — folded out of data the box already stores. No telemetry is collected from contestants' forks. |
| **Scoring pipeline** | A GitHub-Actions-fed pipeline (poll or push) with a single audited score writer — the transport for modules scored outside the app. Modules that grade in-app (quiz, classic) bank points directly and never touch it. |
| **Poll or push** | Poll mode (default) has zero inbound network surface — works behind NAT, on a laptop, on venue wifi. Push mode is near-instant if you have a public URL. |
| **One box, no cloud** | Runs from Docker Compose on a machine you already have, plus one free GitHub org. Nothing is billed, nothing phones home. |

**Secure Development** — graded through GitHub, not in the app:

| Feature | What it means for you |
|---|---|
| **Patch-to-score scoring** | Contestants patch the vulnerability and open a PR; the pipeline scores the patch. Stock scores 0, a correct patch earns its points — gated both ways. |
| **6 targets, 321 challenges** | Juice Shop, DVWA, WebGoat, Security Shepherd, VulnerableApp and VAmPI. Rubrics ship in the box — no private image to request, no scoring code to write. |

**Quiz** — a self-paced question bank, graded in the app:

| Feature | What it means for you |
|---|---|
| **Instant grading, no GitHub** | Single- or multi-select questions marked the moment they are answered, all-or-nothing on multi-select. Needs no forks, no org provisioning and no scoring pipeline. |
| **Authored from `/admin`** | Prompt, choices, correct answers, points and order — with a global attempt cap and retry cooldown. Changes are live on the next request; no rebuild. |
| **Bulk authoring** | Author one question at a time, or import and export the whole bank as one JSON bundle — the same versioned format the classic board uses. |

**Classic CTF** — a jeopardy-style flag board, graded in the app:

| Feature | What it means for you |
|---|---|
| **Flags, checked instantly** | Organizer-authored challenges in categories with per-challenge point values. Submissions are normalised before comparison, so casing and stray whitespace never cost someone a solve. |
| **Rich descriptions, bulk authoring** | Descriptions take a sanitised Markdown subset — links, formatting, code. Author one at a time in `/admin`, or import and export the whole board as a single JSON bundle. |

| Contestant breakdown | Challenge browser |
|---|---|
| ![A contestant's row expanded to its per-app breakdown and the per-challenge catalogue, each flag marked patched or open](docs/assets/hero.jpg) | ![Challenge browser](docs/assets/challenges.jpg) |

<sup>Captured from the contestant app running locally via <code>scripts/dev-stack up</code>
with seeded demo players. The app ships a fixed dark theme. The board ranks
<strong>teams</strong> by default, with a CTFd-style score-over-time graph drawn from
real per-solve timestamps (above), and switches to individual standings (left). A flag
solved by more than one teammate counts <strong>once</strong>, so a team's total is
less than its members' individual scores added up. Branding is the neutral "OWASP CTF"
default — the event name, targets, and links are all event-config driven.</sup>

## Secure Development: targets and rubrics

This module's content is a set of vulnerable **targets** and their scoring
**rubrics**. Contestants pick a target, fork the org's copy, patch it, and
open a PR. Each target's challenges are executable `node:test` suites, priced
by difficulty.

| Target | Challenges | Points | Notes |
|---|---:|---:|---|
| `vulnerableapp` | 110 | 187 | Largest target; scored 8-way parallel |
| `webgoat` | 69 | 137 | Two-stage build: Maven, then the fork's runtime-only Dockerfile |
| `dvwa` | 55 | 108 | Needs a MariaDB sibling and a schema init |
| `securityshepherd` | 40 | 79 | HTTPS, three-container stack, strictly serial |
| `juice-shop` | 38 | 141 | The only target whose difficulty runs to 6 stars |
| `vampi` | 9 | 16 | Self-contained; the quickest end-to-end proof |
| **Total** | **321** | **668** | Enable any subset in `modules.secure-development.targets` |

<sup>Counts are maintained by hand and pinned to the vendored rubric by
<code>apps/web/src/lib/__tests__/apps-catalogue.test.ts</code> — re-check them
after a <code>vendor-rubric.sh</code> bump. Reference <strong>patches</strong>
that prove a correct fix scores (the positive-direction gate) live separately
under <a href="patches/README.md"><code>patches/</code></a>.</sup>

The rubrics live in `scorer/rubric.owasp/`, vendored from
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

**On rubric secrecy.** These rubrics are public. The targets are open source
and their solutions are already published, so the kit treats rubric privacy as
protection against check-gaming rather than against knowing the answers — an
accepted trade-off for a self-hosted event. Override with your own private
rubric at any time:

```sh
cp -r /path/to/private-rubric scorer/rubric
docker build -t ghcr.io/<org>/score:latest --build-arg RUBRIC_DIR=rubric scorer/
```

`scorer/rubric/` is gitignored and reserved for exactly this.

## Running an event

Once the stack is up at your `EVENT_URL`:

- **Contestants** sign in with GitHub and form or join a team — create one to
  become its captain and get a join code, or join an existing team by code.
  Everyone ends up on a team; a solo player is a team of one, and teams cap at
  four members. Then they play whichever modules you enabled: patch-and-PR for
  secure development (the score lands ~30 s later in poll mode), or answer and
  submit in the app for quiz and classic.
- **Organizers** drive `/admin`: freeze the leaderboard, open and close team
  registration, set the schedule, toggle hints, grant admin to co-organizers,
  author quiz questions and classic challenges — and, when one contestant gets
  stuck, fix that one contestant rather than resetting the event.
- **Watch the poller** with `docker compose logs -f sync` — poll mode only, and
  only with `secure-development` enabled (`sync` runs under the `poll`
  profile). All state lives in named Docker volumes, so a box reboot loses
  nothing.
- **When it's over**, `./setup/ctf-setup.sh teardown` archives the target
  repos — then uninstall the GitHub App and delete the org's Actions secrets
  yourself. An event without `secure-development` has no forks to archive.

Teams, the admin panel, verifying the kit before the day, and the local
dev-stack are all covered in
[docs/operations.md](docs/operations.md); prerequisites, poll-vs-push, OAuth
setup and event config in [docs/hosting.md](docs/hosting.md).

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
| [docs/fly.md](docs/fly.md) | Deploy on fly.io — the whole stack as one Fly machine running the repo's own `docker-compose.yml` |
| [docs/security-checklist.md](docs/security-checklist.md) | The one-page pre-event walk: what to check, in order, before contestants arrive |
| [docs/operations.md](docs/operations.md) | Running an event — teams, the admin panel (including per-contestant support actions and engagement metrics), the quiz and classic organizer guides, verifying the kit, the local dev-stack, teardown, and status |
| [docs/architecture.md](docs/architecture.md) | How the stack fits together — diagram, score data flow, security model, testing strategy |
| [docs/scorer.md](docs/scorer.md) | The scorer engine: serve + judge modes, both rubric grammars, authoring and building |
| [docs/modules.md](docs/modules.md) | The module contract — the platform/module boundary, and what a new module must provide to plug into the control plane |
| [docs/decisions.md](docs/decisions.md) | Why it is built this way instead of the alternatives |

Rendered at **[dcotelo.github.io/ctf-in-a-box](https://dcotelo.github.io/ctf-in-a-box/)**.

## License

MIT — see [LICENSE](LICENSE). The vendored target apps under the rubric keep
their own upstream licenses.
