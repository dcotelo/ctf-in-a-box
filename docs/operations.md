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
the ends). **Event is always the default tab** on load, regardless of how many
modules are enabled.

Hints moved from a flat settings list into the Secure Development tab as part
of this reorganization. **This is a UI relocation only** — the underlying
storage keys (`hintsEnabled`, `hintCost`, `hintsMinSolves`,
`hintsUnlockAfterMin`) and their validation are completely unchanged, so no
deployed event's settings, or their meaning, changed by upgrading to this
tabbed panel.

**Module identity.** Every module's tab opens with a title/blurb editor for
that module's display name. The title is capped at 60 characters, the blurb at
200; both are plain text only — control characters and Unicode bidi-override
characters are rejected, since there is no markup to sanitise, only rendered
text to keep intact. **Leaving a field blank clears the override and restores
the module's registry default** — the field's placeholder shows what that
default is, so clearing it is discoverable rather than a guess. Changes are
live on the next request; there is no rebuild and no cache to wait out.

**Where a rename actually shows up.** Set a title and it replaces the module's
name in three places on every event: **the tab's own label**, **the nav link**
(header and footer alike), and **the module's own page header and browser tab
title** (`/challenges` for Secure Development, `/quiz` for Quiz). Two further
surfaces exist but are **suppressed on a single-module event**, which is what
most events are:

- the **leaderboard's per-module block heading** — hidden while only one
  module is enabled, because a row's points *are* that module's and the
  heading would only restate the column above it;
- the **landing page's per-module section heading** — a lone module's section
  is headed "What to expect" instead, and the page's uppercase kicker comes
  from the module's registry tagline, which is **not** overridable at all.

So on a one-module event a rename reaches three surfaces, not five. Nothing is
broken if you cannot find your new name on the leaderboard or the landing
page — those two only start naming modules once there are two to tell apart.

**Leave a field blank if you have nothing to say — especially the blurb.** The
blurb is *not rendered on any page*. Its only effect today is the meta
description of the module's own page (what a search result or a chat link
preview shows), and only `/quiz` uses it; Secure Development's blurb reaches
nothing at all. Treat it as SEO text for the quiz, not as contestant-facing
copy.

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

**Quiz points get a contestant a leaderboard row on their own — a scored PR
is no longer required.** The board's login set is the union of whoever the
scoring backend reports and whoever holds quiz points, so someone who
answers a question before ever opening a PR (or on an event that has no
`secure-development` module at all) gets a row the moment they earn any quiz
points, not on their first scored submission. A team gets the same
treatment: a team with no per-flag data of its own (no members with a
scored PR yet) still shows its members' combined quiz total, deduped by
question. See [docs/architecture.md](architecture.md#leaderboard-with-no-scoring-backend)
for how the board is built when there's no scoring backend behind it at all.

**What the quiz doesn't do (yet):** free-text answers, partial credit, and
per-question attempt/cooldown overrides are all out of scope — the two
retry knobs are global settings, not per-question ones.

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

## Known limitations

**The pre-event gate is page-only.** With `CHALLENGES_GATE_ENABLED=true`,
every enabled module's own page route (`/challenges`, `/quiz`) redirects a
visitor without a valid unlock cookie to `/gate`. That list is exact-match and
it is *pages*: the module **API routes are not behind it**. A signed-in
contestant who knows the endpoint can `POST /api/quiz/answer` while the lock
screen is up and be scored before the doors open — the answer is still graded,
the points still post.

What still holds while the gate is up: the API routes enforce their own rules
regardless of it — a session is required, the admin **pause** and the
**scheduled scoring window** are checked on every write, and per-question
attempt caps and cooldowns apply. So the operator control that actually stops
early scoring is the schedule/pause pair in the admin panel (see [Organizer
admin panel](#organizer-admin-panel)), not the access password.

Read the gate for what it is: a "the board opens at the keynote" curtain over
the contestant-facing pages, and a way to keep the challenge list unpublished
until the event starts. It is not an authorization boundary. If you need
scoring genuinely shut until a moment in time, set the scoring window (or keep
the event paused) as well as — or instead of — the password gate.

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
