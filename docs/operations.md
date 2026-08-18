---
title: Operations
---

# Operations

Running the event once it is up: what organizers do during and after, the
admin panel, how teams work, how to verify the kit before an event, the local
dev-stack for clicking through the real experience, and the current status of
live-GitHub scoring. For standing the kit up in the first place, see
[docs/hosting.md](hosting.md).

## Running an event

**During:**

- The leaderboard and app live at the `EVENT_URL` you configured in `.env`.
- Poller logs: `docker compose logs -f sync`.
- All state lives in named Docker volumes, so a box reboot loses nothing.

**After** — preview the teardown, then run it:

```sh
./setup/ctf-setup.sh teardown --dry-run
./setup/ctf-setup.sh teardown
```

This archives each target repo in the event org. It does **not** revoke
credentials or delete secrets — do that yourself: uninstall the GitHub App,
and delete the event org's Actions secrets (`LEADERBOARD_TOKEN` if you used
push mode).

## Teams

Scoring is per team. Contestants self-register in the app: create a team to
become its captain and get a join code, or join an existing team by code.
Everyone ends up on a team — a solo player is simply a team of one. Captains
manage the roster from the app: rename the team, remove a member, transfer the
captaincy, regenerate the join code, or disband. Team size is capped at four
members.

The leaderboard ranks **teams**, and each row expands to show its members with
each member's individual points. A flag solved by several teammates counts
**once** for the team, so a team's total can be lower than its members' scores
added together — the leaderboard dedupes shared solves rather than
double-counting them. Organizers open or close the registration window from
the admin panel below.

## Organizer admin panel

Anyone listed in `event.yaml`'s `admins` (checked case-insensitively against
their GitHub login) can sign in and reach `/admin` — everyone else gets a
403, on both the page and its API routes.

The controls are grouped into **tabs**: an **Event** tab for the settings that
belong to the platform itself (freeze, team registration, the schedule, demo
seed, master reset), then **one tab per enabled module**, labelled with that
module's name as the organizer has set it. A module's own knobs live in its own
tab, so an event that doesn't run a module never sees its settings at all. The
tab strip is keyboard-operable (arrow keys move between tabs, Home/End jump to
the ends).

The panel offers:

- **Status** — the sync poller's heartbeat (last poll time, comments
  ingested, repos polled, last error) and a best-effort leaderboard
  freshness read.
- **Freeze** — a pause switch. Pausing **freezes ingestion, not fork
  Actions**: contestants' PRs keep getting judged and commented on exactly
  as before, poll mode's cursor just holds in place (nothing is lost, only
  deferred), and push mode's `POST /score` returns `503` so a contestant's
  Action retries instead of silently dropping the submission. Un-pausing
  picks up right where it left off.
- **Team registration** — an open/close switch for the team-forming window.
  While closed, players cannot create or join teams (and captain roster
  mutations are blocked); existing teams keep their scores.
- **Hint controls** (Secure Development tab) — an override for whether hints are enabled and what
  they cost, on top of the build-time default. Hints are **on by default**
  (set `HINTS_ENABLED=false` to remove them entirely) and cost 10 points
  each. This takes effect immediately for whether a hint **can be bought**.
  It does **not** currently change, live, whether the challenges page
  **offers** the hint button, the hint-notice banner, or the leaderboard's
  hint-penalty display — those still reflect whatever `HINTS_ENABLED` was
  baked in at build time. See
  [docs/architecture.md](architecture.md#organizer-admin-panel-runtime-overrides)
  for the full breakdown of this limitation.
- **Hint gating** — two knobs that decide *who* may buy a hint and *when*,
  enforced server-side in `revealHint` (the API is the boundary; the UI only
  hides things):
  - **Solves required** (`hintsMinSolves`, default **1**) — a login must
    already have solved that many challenges **on that target** before it can
    buy any of that target's hints. This is the anti-farming gate: a hint's
    price lands on the account that reveals it, but the hint *text* is
    trivially relayed, so a throwaway account could otherwise buy hints, eat
    a penalty nobody cares about, and pass the text to a real team. Requiring
    earned progress makes that cost the same real work the event scores. Set
    to `0` to disable.
  - **Unlock after** (`hintsUnlockAfterMin`, default **0**) — minutes after
    the scheduled scoring start before *any* hint can be bought, so the early
    game is decided on unaided work. Needs a scoring start (see the schedule
    below) to have any effect; `0` means hints are available immediately.

  Both fail **closed**: if the solve lookup errors, the hint is refused
  rather than handed out unverified. Denials return `403` with a message
  naming what's missing. The gate also refuses outright when the
  `secure-development` module is not enabled — hint keys are per-challenge,
  so there is nothing for a quiz-only event to hint.
- **Hint penalties apply to teams too.** A team's displayed points are its
  scorer total minus the **sum** of its members' hint spend, floored at 0,
  and the team board re-ranks on the penalised figure (a `−N hints` chip
  shows the deduction). Note the deliberate asymmetry with flag scoring: a
  flag solved by two teammates counts **once**, but a hint bought by two
  teammates is charged **twice** — hints are individually purchased, so
  redundant buying is the team's own coordination cost.

- **Master reset** (danger zone) — wipes **all** event data so a test run or a
  botched setup can be cleared before the real event. It deletes every solve,
  team, per-player record, join code, and hint purchase; it **keeps** your admin
  settings and appends the reset to the audit log. It is server-side and
  admin-gated, and requires **typing the event name** to proceed (a single click
  can't fire it).

  The reset also **freezes scoring** and bumps a reset epoch that the sync poller
  honours by dropping its cursor. This is what makes a reset stick in **poll
  mode**: without it, the poller would re-ingest the same PR comments within a
  cycle and undo the wipe. So the intended flow is *reset → box is frozen →
  unfreeze when ready*. If you reset **after** real PRs exist and then unfreeze,
  the poller re-reads those still-present comments — for a post-event wipe that
  stays gone, also delete (or the org, archive) the source PR comments.

- **Quiz controls** (Quiz tab, present only when the `quiz` module is enabled) — the two
  retry-gate knobs (max attempts, retry cooldown) plus full question
  authoring: add, edit, and delete. See [Quiz](#quiz) below for what these
  do and their defaults.
- **Seed demo data** (demo mode only) — populates the leaderboard with fake
  contestants, teams, and real-challenge-id solves so you can preview the app
  without running real PRs. When the `quiz` module is enabled, this also seeds
  a small demo question bank with some already answered, so the board shows a
  genuinely combined score (patch points plus quiz points) rather than just
  one module. The button and its route only exist when the app is
  started with `DEMO_MODE=1` (the local `scripts/dev-stack up` sets it); they are
  absent in a normal event build, so a real leaderboard can't be polluted by
  accident. Clear the seeded data with the master reset.

Every settings change is recorded in a capped audit log (who, when, what
changed) alongside the setting itself. **Disruptive controls prompt for
confirmation**: the freeze and team-registration toggles ask a one-click "are
you sure?"; the master reset requires type-to-confirm.

When the `quiz` module is enabled, the master reset also clears every
contestant's quiz answers and attempts (and the two aggregate point/answered
counters the leaderboard reads) — but it deliberately **keeps your authored
questions and their answer keys**, the same way it keeps `event.yaml`-derived
admin settings. A reset event doesn't mean re-building the quiz from scratch.
See [Quiz](#quiz) below.

## Quiz

When `event.yaml`'s `modules:` map includes `quiz: {}` (see
`event.yaml.example`), contestants get a second, self-paced way to earn
points: single- and multiple-choice questions, answered directly in the app
alongside Secure Development's patch challenges. It doesn't touch GitHub,
the scorer, or `sync` at all — see
[docs/architecture.md](architecture.md#quiz-data-flow) for how it scores
entirely inside the app.

**Authoring** happens in `/admin`, under the Quiz module's section (see
"Quiz controls" above): add a question with a prompt, pick **single choice**
or **multiple choice**, give it two or more labeled choices, mark which
one(s) are correct, and set its point value and its `order` (position in the
list). Editing an existing question never shows you its current correct
answer(s) first — the answer key never reaches any client, admin session
included — so every save requires re-selecting the correct choice(s), even
when you're only fixing a typo in the prompt.

**Deleting a question removes it from the quiz and hides it from
contestants — but points already banked for it remain on the leaderboard.**
Deletion drops the question and its answer key, nothing else: nobody can
answer it any more, and it disappears from every contestant's board, but the
contestants who already answered it correctly keep those points, and their
answer/attempt history for it is left alone. If you need those points gone
too, use the master reset (which clears all quiz progress at once, for
everyone). There is no way to un-award a single question. The delete button
is still gated behind typing the question's own id to confirm, the same
pattern the master reset uses — deleting mid-event changes what contestants
see, even though it doesn't take points back.

**Grading is all-or-nothing and order-insensitive**: a submission scores
points only if its set of selected choices exactly matches the correct set —
not a subset, not a superset. Picking three choices when two are correct
scores 0, the same as picking only one of two correct choices; that's still
one spent attempt, exactly like any other wrong answer. Single-choice
questions follow the identical rule — they simply have exactly one correct
choice, so "exact match" reduces to "picked the right one." There is no
partial credit for either question type.

**Retry gate** — two admin-panel knobs, next to the question list:

- **Max attempts** (`quizMaxAttempts`, default **3**) — graded attempts a
  contestant gets on one question before the retry gate refuses further
  submissions. `0` means unlimited. Both settings are global — there is no
  per-question override.
- **Retry after** (`quizRetryAfterMin`, default **5**) — minutes a
  contestant must wait after an attempt before trying that question again.
  `0` means no cooldown.

Both are enforced by a server-side Redis script, not just a JS-side
pre-check, so a burst of near-simultaneous submissions can't outrun the
attempt cap. The cooldown is computed from the last attempt's timestamp on
every check, never a stored unlock time — so lowering it mid-event lifts an
active cooldown immediately, and raising it applies to the very next check.
A wrong attempt spends one of the allotted attempts; once a question is
answered correctly it's done — no more attempts to spend, right or wrong.

**Points and scoring.** A question's points are captured on the answer
record at the moment it's answered correctly, so re-pricing a question
later never changes what a contestant already earned — only a future
correct answer sees the new price. A team's quiz total dedupes by
question: if two teammates both answer the same question correctly, the
team's board still counts it once, the same rule already used for shared
flags. Quiz points show up as an addition on top of a contestant's or
team's other points, never folded silently into a single number with no
breakdown — see the architecture doc for how that addition happens.

**Quiz points reach the leaderboard only once a contestant has at least one
scored submission.** The board is built from contestants who already have a
scored PR, and the quiz overlay adds points to those rows — it never creates
a row of its own. So someone who answers questions before opening their
first PR sees their quiz points on their own `/profile`, correctly, but has
no row on `/leaderboard` yet. Their first scored submission brings the row
into existence with the quiz points already on it; nothing is lost in the
meantime. In a normal event (where the quiz sits alongside the patch
challenges) this resolves itself; it is most visible in the first hour, or
if you run the quiz as a warm-up before the challenges open.

**What the quiz doesn't do (yet):** free-text answers, partial credit, and
per-question attempt/cooldown overrides are all out of scope — the two
retry knobs are global settings, not per-question ones. A quiz-only event
(no `secure-development` module at all) is also still not supported
end-to-end: `sync` still requires the `secure-development` module to be
configured, and (per the note above) a leaderboard with no scored
submissions on it has no rows for quiz points to land on.

## Verifying it works

No GitHub org, Action runs, or scorer image access needed to check the kit
itself:

```sh
./scripts/smoke.sh
```

This brings the full poll pipeline up against fixture GitHub comments and a
mock scorer, then asserts: Redis and the Upstash-compatible REST proxy work,
`sync` ingests fixture score comments, scores match the fixtures, a forged
comment from an untrusted author is dropped, and unauthenticated `POST /score`
is rejected. It is what CI runs, and the fastest way to sanity-check a change
to `sync`, the compose stack, or the setup script.

The scorer engine has two more gates of its own:

```sh
./scripts/acceptance-scorer.sh                                   # declarative probe path
./scripts/acceptance-target.sh vampi erev0s/vampi@sha256:0a5a224b6e14ae7da6a6ea265178ff71286ff903aec74adee98f660bb0e4ca12  # a real target, end to end
```

`acceptance-scorer.sh` closes the judge → PR-comment marker → leaderboard loop
against a fake target app, in both push and poll mode.
`acceptance-target.sh` is the **stock-scores-zero gate**: it boots the real,
unpatched upstream image and asserts every challenge fails against it. Any
challenge that passes there asserts the exploit rather than the fix, and the
gate fails the build rather than handing every contestant a free point. The
full testing strategy is in
[docs/architecture.md](architecture.md#testing-strategy).

## Local dev-stack

Want to click through the actual contestant experience — leaderboard,
challenge browsing, teams, a score landing on the board — without a GitHub
org, an OAuth app, or a real contestant PR? One command:

```sh
./scripts/dev-stack up
```

This generates a throwaway `.env.dev-stack` if you have no `.env` (never
touches or overwrites a real one), builds the scorer image locally from
`scorer/` and the app image from `apps/web/` (falling back to
`event.yaml.example` if you have no `event.yaml` yet), brings up `redis`,
`srh`, `scorer`, `app` and `caddy`, and seeds a few demo players onto the
leaderboard through the scorer's real bearer-authed `POST /score` — the same
endpoint a scored PR hits, so it exercises the real validation and Redis-write
path rather than poking Redis keys directly. It prints the URL to open when
it's done.

Watch a new score land live, without a real PR:

```sh
./scripts/dev-stack score <login> juice-shop 3   # marks 3 catalogue challenges solved
```

Tear down with `./scripts/dev-stack down` (keeps seeded data in the Redis
volume for next time) or `./scripts/dev-stack down --wipe` (also drops it).

**What this does not do:** sign you in. `/admin` needs a real session whose
GitHub login is in `event.yaml`'s `admins`, which needs a real GitHub OAuth
app — there is no local bypass for that boundary, and the script does not add
one. `dev-stack up` tells you exactly what to add (an OAuth app's client
id/secret in `.env`, your login in `admins`) to unlock sign-in and `/admin` on
top of the leaderboard/challenge-browsing experience it gives you immediately.

## Status and upstream dependencies

The kit is complete and tested offline: `scripts/smoke.sh` exercises the whole
poll pipeline, `sync` has unit tests for parsing, cursors and idempotency, and
every target's rubric is gated against its stock image. Real, live-GitHub
scoring depends on two changes landing in other OWASP-CTF repos, plus items
still open here:

1. **upstream scorer** — a bearer-token auth mode for `POST /score` (accepting
   `Authorization: Bearer <token>` as an alternative to Actions OIDC), so both
   `sync` and push mode can authenticate without an OIDC provider.
2. **`score-action`** — optional `leaderboard-url` / `leaderboard-token`
   inputs, the scoring Action always emitting a machine-readable result
   comment (pass/fail and points only, no exploit detail), and a cap on
   scoring re-runs per PR.
3. **rubric fidelity, Security Shepherd** — the vendored helper that decides
   whether a challenge was solved (`extractSolutionKey`) accepts any 32-128
   character hex run found in the response. At least one challenge
   (`Challenge-10-IDOR-2`) echoes the attacker-supplied identifier — itself
   pure hex — back into the page precisely when a *correct* patch blocks the
   lookup, so the helper reads a "solution key" out of noise and the challenge
   scores as unpatched however good the fix. The bias runs toward "not
   patched", so the stock-scores-zero gate is unaffected and no contestant
   gains a free point; the cost is that one Shepherd challenge can
   under-credit a correct patch. The rubrics are vendored read-only, so the
   fix belongs upstream: tighten the helper to require a result-key-shaped
   match rather than any bare hex run.

`srh` (`hiett/serverless-redis-http`), the Upstash-compatible REST proxy in
front of Redis, implements only a subset of Upstash's REST API — no path-style
`GET /get/<key>` shortcut, for example. The app is wired to it today for real
team-membership and hint-purchase data. What remains unverified is whether the
app's Redis client stays inside that subset end to end (pipelining, `EVAL`).

Until items 1 and 2 land, treat `scripts/smoke.sh` as the source of truth that
the kit works; a live event additionally needs the scorer's bearer-auth mode
to authenticate `sync` or push against a running scorer.
