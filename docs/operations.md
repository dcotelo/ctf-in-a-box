---
title: Operations
---

[← Docs home](index.md)

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
members by default; an organizer changes that from the admin panel's **Event**
tab ("Players per team") without a rebuild.

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

Those are the **bootstrap** admins: baked into the image, so changing them
needs a rebuild. Everyone else is granted from the panel itself, on the
**Admins** tab, and takes effect immediately (see below).

The controls are grouped into **tabs**: an **Event** tab for the settings that
belong to the platform itself (freeze, team registration, the schedule, demo
seed, master reset), an **Admins** tab, then **one tab per enabled module**, labelled with that
module's name as the organizer has set it. A module's own knobs live in its own
tab, so an event that doesn't run a module never sees its settings at all. The
tab strip is keyboard-operable (arrow keys move between tabs, Home/End jump to
the ends). **Event is the default tab** on load, regardless of how many
modules are enabled — unless the URL names another one (see the deep links
below).

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
title** (`/challenges` for Secure Development, `/quiz` for Quiz, `/flags` for
Classic). Two further
surfaces exist but are **suppressed on a single-module event**, which is what
most events are:

- the **leaderboard's per-module block heading** — hidden while only one
  module is enabled, because a row's points *are* that module's and the
  heading would only restate the column above it;
- the **landing page's per-module section heading** — a lone module's section
  is headed "What to expect" instead, and the page's uppercase kicker comes
  from the module's registry tagline, which is **not** overridable at all.
  (A module with no registry `home` block is the exception: its section
  heading *is* its title, override included, because there is no authored
  heading to prefer. Neither module shipped today is in that position.)

So on a one-module event a rename reaches three surfaces, not five. Nothing is
broken if you cannot find your new name on the leaderboard or the landing
page — those two only start naming modules once there are two to tell apart.

**The blurb is contestant-facing copy — write it as such.** It reaches three
places:

- the **meta description** of the module's own page (what a search result or a
  chat link preview shows);
- **`/quiz`'s and `/flags`'s page header**, as the lede under the title. This
  is the module describing itself; the "You've answered 2 of 5 questions."
  (or "You've solved N of M challenges.") line is *your* progress, and sits
  above the questions/challenges instead;
- the **landing page section lede**, but only for a module that ships no
  registry `home` block. All three modules that exist today have one, so
  today this
  is a fallback for a future module rather than something you can see —
  Secure Development's, Quiz's, and Classic's landing copy all come from the
  registry and are
  not organizer-editable.

Leaving it blank restores the module's registry default, which is a complete
sentence, so a blank blurb is a perfectly good answer — it is never an empty
line on a page.

The panel offers:

- **Status** — the sync poller's heartbeat (last poll time, comments
  ingested, comments **dropped**, repos polled, last error) and a
  best-effort leaderboard freshness read.

  **Read Ingested and Dropped together.** Ingested is points that reached the
  leaderboard; Dropped is points that reached a contestant's PR and stopped
  there — the scorer rejected the submission, or the comment carried a
  `ctf-score:` marker the poller could not read. Dropped should be **0** on a
  healthy event; it turns amber and a **Last drop** line names the repo, the
  PR, and the reason when it isn't. Neither figure resets on its own: a
  dropped score is still missing after the poller recovers, so the pointer to
  the PR that needs looking at stays up (unlike Last error, which describes
  only the most recent tick). A nonzero Dropped means a contestant is looking
  at a correct score on their PR that the leaderboard does not show — go read
  the poller's logs for the matching line, fix the cause, and re-run that PR's
  scoring workflow.

  Routine things are deliberately **not** counted here: a comment re-read at
  the cursor boundary, and the workflow's own "⏳ Scoring in progress…"
  placeholder, are both expected and leave Dropped at 0. The poller's logs
  carry a per-repo breakdown of those on any tick where something
  non-routine happened.
- **Freeze** — a pause switch. Pausing **freezes ingestion, not fork
  Actions**: contestants' PRs keep getting judged and commented on exactly
  as before, poll mode's cursor just holds in place (nothing is lost, only
  deferred), and push mode's `POST /score` returns `503` so a contestant's
  Action retries instead of silently dropping the submission. Un-pausing
  picks up right where it left off.
- **Team registration** — an open/close switch for the team-forming window.
  While closed, players cannot create or join teams (and captain roster
  mutations are blocked); existing teams keep their scores.
- **Hint controls** (Secure Development tab) — whether hints are enabled and
  what they cost. Hints are **on by default** and cost 10 points each. This is
  the **only** hint switch: there is no environment variable, and the toggle
  takes effect immediately across every surface — whether a hint **can be
  bought**, whether the challenges page **offers** the button and its notice
  banner, and whether the leaderboard shows the **hint-penalty** column.
  Turning hints off does not forgive points already spent: the spend stays
  recorded, so switching back on restores the penalties rather than wiping
  them. The one thing the toggle cannot do is turn hints on without
  `UPSTASH_REDIS_REST_*` credentials — the hint text lives only there.
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
  authoring: add, edit, reorder (drag, or Move up / Move down), and delete.
  See [Quiz](#quiz) below for what these do and their defaults.
- **Classic controls** (Classic tab, present only when the `classic` module
  is enabled) — the submission-cooldown knob (in **seconds**, not minutes)
  plus category management and full challenge authoring: add, edit, reorder
  (drag, or Move up / Move down), and delete. See [Classic](#classic) below
  for what these do and their defaults.
- **Seed demo data** (demo mode only) — populates the leaderboard with fake
  contestants, teams, and real-challenge-id solves so you can preview the app
  without running real PRs. When the `quiz` module is enabled, this also seeds
  a small demo question bank with some already answered, so the board shows a
  genuinely combined score (patch points plus quiz points) rather than just
  one module. When the `classic` module is enabled, it seeds a demo flag board
  the same way — categories, challenges (flags included), and a spread of
  solves — so a multi-module event previews as one combined board. See
  [Classic](#classic) below. The button and its route only exist when the app is
  started with `DEMO_MODE=1` (the local `scripts/dev-stack up` sets it); they are
  absent in a normal event build, so a real leaderboard can't be polluted by
  accident. Clear the seeded data with the master reset.

Tabs are deep-linkable: `/admin?tab=quiz` (or `?tab=classic`,
`?tab=secure-development`) opens straight into that module's panel. This is
what `/quiz` and `/flags` link an organizer to when the module has no content
yet — an empty board shows them **Author questions** / **Author challenges**
instead of the contestant's "check back soon". An unknown or not-enabled tab
name falls back to **Event**.

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

`classic` is scoped exactly the same way: the master reset clears every
contestant's flag solves and attempts (and the three aggregate
points/solved/solve-count hashes the leaderboard reads) but deliberately
**keeps your authored challenges, their flags, and your categories** — the
same organizer content/contestant progress line the quiz reset draws. A
rehearsal on the `classic` module wipes back to the challenge set you wrote,
ready to run for real. See [Classic](#classic) below.

### Re-run cooldown

On the **Secure Development** tab. It is the minimum minutes between *scored*
runs on the same PR — every run hands back a per-challenge pass/fail, so a
short cooldown lets a contestant iterate a check-gaming patch against the
rubric. `0` disables it.

It takes effect on the **next push**, with no re-rendering of any fork's
workflow: each fork's Action reads the current value from the event when it
runs. If the box is unreachable the Action uses the value baked into its
workflow instead, so scoring continues either way.

### Players per team

The cap defaults to four and is changed from the **Event** tab. It is enforced
**when someone joins**, inside the same atomic Redis script that adds them to
the roster — so the number the panel shows and the number the join path
enforces are always the same value, read through one resolver.

**Lowering it never evicts anyone.** A team already at five keeps its five
players when the cap drops to four; it simply cannot take another. Raising it
takes effect on the next join.

A cap of 0 is rejected: it would refuse every join, including into a captain's
own team, while the UI advertised "0 players max". The accepted range is 1 to
100.

If Redis is briefly unreachable the cap falls back to the default rather than
refusing joins — the opposite of the admin access check, and for the same
reason in reverse: a registration outage is a worse failure than being briefly
wrong about a team size.

### Adding and removing admins

The **Admins** tab grants organizer access at runtime. Type a GitHub login,
press *Add admin*, and they can reach `/admin` immediately — no rebuild, no
redeploy, no `event.yaml` edit.

Two kinds of admin appear in the list:

| Source | Where it lives | Removable from the panel? |
| --- | --- | --- |
| `event.yaml`'s `admins` | baked into the image at build time | **no** — marked `event.yaml` |
| Added on this tab | `ctf:admin:admins` in Redis | yes |

**A baked admin cannot be revoked here, and that is the point.** It is the
recovery path: no sequence of clicks, and no compromised admin session, can
lock every organizer out of the panel. If you genuinely need to remove one,
edit `event.yaml` and rebuild — the same cost as adding one used to be.

You *can* remove yourself, and the panel asks first. It is safe because a
baked admin always remains.

Only an admin can create an admin; there is no self-service path in. Every
grant and revocation is written to the same audit log as the rest of the
panel's changes, recording who did it and when.

**If Redis is unavailable**, runtime grants stop resolving and those admins
get a 403 — the access check fails **closed**, deliberately, and deliberately
unlike the freeze read, which fails *open* so a Redis blip cannot drop live
submissions. A baked admin still gets in, because that check never touches
Redis at all — which is exactly when you most need the panel.

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
one(s) are correct, and set its point value. **Editing an existing question
prefills its current correct answer(s)**, so fixing a typo in a prompt
doesn't mean re-picking the answer from memory — get that wrong and you'd
silently change what counts as correct for every contestant, with no warning
and no way to notice until the scores look off. The answer key is visible
only inside the edit form and only to an admin (`/admin` is gated, and anyone
through that gate can already rewrite or delete the answer outright); the
question list itself doesn't show it, and it never reaches a contestant —
`/quiz` is served from a separate, keyless read that never touches the answer
hash at all.

**You don't type a question id.** Adding a question mints one from its prompt
plus a short random suffix (`which-header-mitigates-clickjack-k3f9qa`) when
you save. The suffix is not decoration: two questions worded identically
would otherwise land on the same id, and the second would overwrite the first
*and* inherit every answer already banked against it.

**An existing question's id never changes.** The edit form shows it,
read-only, and there is no way to alter it. That is deliberate rather than
merely conservative: the id is the field name in `ctf:quiz:questions` and
`ctf:quiz:key` **and** the reference every contestant's answer row is
recorded against, so changing it would orphan every answer already banked —
the points would stay on the leaderboard with no question behind them. If a
question needs a different id, delete it and add a new one, and read the
paragraph below first about what deletion does and doesn't take with it.

**Ordering is done by dragging.** The question list in `/admin` is sortable:
drag a row to where you want it, or use its **Move up** / **Move down**
buttons (the keyboard-operable path — dragging is not the only way in). The
stored `order` field is rewritten from the resulting positions and the moved
questions are saved immediately; contestants see the new order on their next
page load. There is no order number to type any more, and nothing to
renumber by hand.

**Deleting a question removes it from the quiz and hides it from
contestants — but points already banked for it remain on the leaderboard.**
Deletion drops the question and its answer key, nothing else: nobody can
answer it any more, and it disappears from every contestant's board, but the
contestants who already answered it correctly keep those points, and their
answer/attempt history for it is left alone. If you need those points gone
too, use the master reset (which clears all quiz progress at once, for
everyone). There is no way to un-award a single question. The delete button
is still gated behind typing a phrase to confirm, the same pattern the master
reset uses — deleting mid-event changes what contestants see, even though it
doesn't take points back. The phrase is now the question's **prompt** (cut at
a word boundary for a long one; the dialog shows exactly what to type, and
names the id alongside it). It used to be the id, which stopped being a
useful gate once ids were generated: transcribing
`which-header-mitigates-clickjack-k3f9qa` proves you can copy a string, not
that you read which question you were about to remove.

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

Contestants can see the budget: each unanswered question carries a
`2 of 3 attempts left` chip next to its points badge, counted down from the
same attempts row the gate itself reads. The chip is absent when **Max
attempts** is `0` (nothing to ration) and once the question is answered.
Lowering the cap mid-event can leave a contestant holding more spent
attempts than the new cap allows; the chip floors at `0 of N` rather than
reporting a negative budget.

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

**Bulk authoring: import and export the whole question bank as one file.**
Beyond the admin form's one-question-at-a-time editing, the Quiz tab's own
panel has an **Export questions** button and an **Import a bundle** box
(paste JSON, or choose a `.json` file) for authoring — or backing up — a
whole bank in one pass. This is the same bundle format the Classic module
uses (see [ADR 36](decisions.md#36-quiz-adopts-classics-bundle-format-rather-than-inventing-a-second-one)),
so the rules below will look familiar if you have imported a flag board. A
bundle is a single JSON object: a `version` and a `questions` array where
each entry has exactly the fields the admin form itself collects, correct
answers included. For example, a two-question bundle:

```json
{
  "version": 1,
  "questions": [
    {
      "id": "clickjacking-x7k2",
      "prompt": "Which HTTP header mitigates clickjacking?",
      "type": "single",
      "choices": [
        { "id": "a", "label": "X-Frame-Options" },
        { "id": "b", "label": "Content-Length" }
      ],
      "points": 10,
      "order": 0,
      "correct": ["a"]
    },
    {
      "id": "injection-q9pm",
      "prompt": "Which of these are injection risks?",
      "type": "multi",
      "choices": [
        { "id": "a", "label": "String-concatenated SQL" },
        { "id": "b", "label": "Parameterized queries" },
        { "id": "c", "label": "eval() on user input" }
      ],
      "points": 15,
      "order": 1,
      "correct": ["a", "c"]
    }
  ]
}
```

Every id in `correct` must be one of that question's own `choices`, a
`"single"` question must have exactly one correct answer, and no two choices
within a question may share an id. The whole file is validated in one pass
before anything is written: every row's problems are reported together, and
if the file has even one bad row, nothing is imported — there is no partial
write from a mostly-good file.

**Import is upsert by id, and it never deletes.** Each question in the file
is created if its id is new to the bank, or overwritten in place if that id
already exists — that is the entire rule. A question currently in the bank
but simply not mentioned in the file is left completely untouched. Worth
stating plainly because the natural assumption runs the other way: importing
a 10-question file into a bank that already has 15 does **not** shrink it to
10. There is no way to delete a question through import; use the admin
form's own Delete button for that, one at a time.

**Ids round-trip, so an export is a genuinely usable backup.** Re-importing
an unmodified export updates every question in place instead of duplicating
it. Because a contestant's answer history is keyed by question id, this also
means re-importing your own backup never detaches anyone's already-banked
points from the question that earned them.

**Max attempts and Retry after are not part of a bundle.** They are event
policy rather than content, and they are shared by every question, so
importing a question set never changes the retry gate you set on the tab —
in either direction. Set those two where they live, in the panel.

**The exported file contains every answer key in plaintext.** Export is the
quiz's entire answer sheet in one JSON file. Do not commit it to a public
repository, paste it into a public issue or chat, or otherwise share it
casually; treat it with the same care as `/admin` access itself.

**What the quiz doesn't do (yet):** free-text answers, partial credit, and
per-question attempt/cooldown overrides are all out of scope — the two
retry knobs are global settings, not per-question ones.

## Classic

When `event.yaml`'s `modules:` map includes `classic: {}` (see
`event.yaml.example`), contestants get a jeopardy-style flag board: a set of
organizer-authored challenges, each hiding a flag, graded the instant a
contestant submits a matching string. Like the quiz, it doesn't touch
GitHub, the scorer, or `sync` at all — see
[docs/architecture.md](architecture.md#classic-data-flow) for how it scores
entirely inside the app.

**Authoring** happens in `/admin`, under the Classic module's tab (see
"Classic controls" above). Before adding a challenge you need at least one
**category** — categories are a simple ordered list (add, reorder by
dragging or Move up/Move down, remove), and a category can only be removed
while no challenge still files under it; the panel tells you exactly how
many challenges are blocking a removal. A challenge itself has a title, a
category (picked from that list), a Markdown description (a live preview
renders alongside the box as you type), a point value, and a flag.

**A flag is stored in plaintext, and it is visible to anyone with `/admin`
access.** The flag input is masked by default (a Reveal toggle uncovers it,
in case you're screen-sharing the panel), but there is no hashing and no
one-way transform anywhere in the store beyond the case/whitespace
normalization grading itself uses (below) — an organizer opening a
challenge to fix a typo sees the flag exactly as it was typed. That is a
deliberate trade-off, not an oversight: withholding it would buy nothing
(anyone through the `/admin` gate can already rewrite or delete the flag
outright) while costing real correctness — an edit form that starts blank
turns every typo fix into a chance to silently redefine what counts as
solved. Treat `/admin` access itself as the actual secrecy boundary for
every flag on the board.

**You don't type a challenge id.** Adding a challenge mints one from its
title plus a short random suffix when you save, exactly like the quiz's
question ids, and for the same reason: it's the reference every contestant's
solve is recorded against, so on an existing challenge it never changes.
Delete and re-add if a challenge genuinely needs a new one, after reading
the deletion paragraph below.

**Ordering is done by dragging**, the same as the quiz's question list: drag
a row, or use its Move up/Move down buttons, and the stored `order` is
rewritten from the resulting positions.

**Deleting a challenge removes it from the board and hides it from
contestants — but points already banked for it remain on the leaderboard.**
Nobody can submit against a deleted challenge's id again, but the
contestants who already solved it keep those points, and their solve/attempt
history for it is left alone. Deletion is gated behind typing the
challenge's own title to confirm (falling back to its id for a
blank/whitespace-only title), the same pattern the quiz's delete and the
master reset use.

**Matching is case- and whitespace-insensitive, normalized identically on
both the authoring and submission sides.** The stored flag is trimmed, then
Unicode-NFC-normalized, then lowercased before comparison — every submitted
flag goes through the same normalization before it's checked. A stray
leading/trailing space or a different capitalization never costs a
contestant a solve.

**There is no cap on attempts — only a cooldown, and it is set in
SECONDS.** The **Submission cooldown (sec)** field (`classicCooldownSec`,
default **5**, capped at **3600** — one hour) is the only throttle: a
contestant can try a challenge as many times as they like, but must wait
that many seconds between submissions on the *same* challenge once they've
made one. Set it to `0` to remove the cooldown entirely. This is worth
calling out plainly because every other retry-gate setting on this platform
(the quiz's retry cooldown, the hint gate's unlock delay) is in **minutes**
— classic's own knob is not.

**Points are static.** A challenge's point value is fixed by whoever wrote
it and is read off the challenge record at the instant of a correct solve;
there is no decay as more people solve it and no first-blood bonus for being
first. Re-pricing a challenge afterward never changes what a contestant
already banked, the same rule the quiz follows.

**Team totals dedupe by challenge**, the same rule already used for the quiz
and for secure-development's shared flags: if two teammates both solve the
same challenge, the team's board counts it once, not twice. Classic points
show up as an addition on top of a contestant's or team's other points,
using the exact same union-and-add mechanism the quiz does — see the
architecture doc for the details.

**A classic solve gets a contestant a leaderboard row on their own — a
scored PR is no longer required,** the same rule the quiz established: the
board's login set is the union of whoever the scoring backend reports and
whoever holds quiz or classic points, so a login with only classic points
(or an event running the `classic` module alone) still gets a row.

**The master reset clears classic progress, and demo mode seeds a classic
board** — both exactly as they do for the quiz; see the notes under
"Organizer admin panel" above. A rehearsal on the `classic` module resets
back to the challenges, flags, and categories you authored, which the reset
keeps.

**Bulk authoring: import and export the whole challenge set as one file.**
Beyond the admin form's one-challenge-at-a-time editing, the Classic tab's
own panel has an **Export challenges** button and an **Import a bundle**
box (paste JSON, or choose a `.json` file) for authoring — or backing up —
many challenges in one pass. A bundle is a single JSON object: a
`categories` list, and a `challenges` array where each entry has exactly the
fields the admin form itself collects, flag included. For example, a
two-challenge, two-category bundle:

```json
{
  "version": 1,
  "categories": ["Web", "Crypto"],
  "challenges": [
    {
      "id": "web-warmup-x7k2",
      "title": "Web Warmup",
      "category": "Web",
      "description": "Find the flag hidden in the page source.",
      "points": 100,
      "order": 0,
      "flag": "CTF{view_source_ftw}"
    },
    {
      "id": "crypto-basics-q9pm",
      "title": "Crypto Basics",
      "category": "Crypto",
      "description": "Decode the Base64 string to find the flag.",
      "points": 150,
      "order": 0,
      "flag": "CTF{base64_is_not_encryption}"
    }
  ]
}
```

Every challenge's `category` must appear in that same file's own
`categories` list — a bundle has to be self-contained, so importing it
never silently depends on categories the target event happens to already
have. The whole file is validated in one pass before anything is written:
every row's problems are reported together, and if the file has even one
bad row, nothing is imported — there's no partial write from a mostly-good
file.

**Import is upsert by id, and it never deletes.** Each challenge in the
file is created if its id is new to the board, or overwritten in place if
that id already exists — that is the entire rule. A challenge that's
currently on the board but simply isn't mentioned in the file is left
completely untouched. This is worth stating plainly because the natural
assumption runs the other way: importing a 10-challenge file into a board
that already has 15 does **not** shrink the board to 10 — the other 5 stay
exactly as they were. There is no way to delete a challenge through import;
use the admin form's own Delete button for that, one at a time.

**Ids round-trip, so an export is a genuinely usable backup.** Exporting
writes back the same ids the board already has, so re-importing an
unmodified export updates every challenge in place instead of duplicating
it. Because a contestant's solve history is keyed by challenge id, this
also means re-importing your own backup never detaches anyone's
already-banked points from the challenge that earned them.

**Categories are unioned, not replaced.** Importing a file appends any of
its categories that the board doesn't already have, in the order the file
lists them, after the categories already there — the existing order is
left exactly as it was. Importing a bundle can only grow the category
list, never reorder or drop anything from it.

**The exported file contains every flag in plaintext.** Export is the
event's entire answer key in one JSON file — every challenge's flag,
unmasked. Do not commit it to a public repository, paste it into a public
issue or chat, or otherwise share it casually; treat it with the same care
as `/admin` access itself, since a saved copy of the file protects nothing
on its own.

**What classic still doesn't do (in this PR):** no file attachments (a
challenge's description is text only — nowhere to attach an image, a
capture file, or a binary for contestants to download), and no hint system
of its own (the hint gate and its knobs apply to secure-development targets
only). Both are planned for later PRs in this series, not this one.

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

**The pre-event gate's page block (`proxy.ts`) is page-only.** With
`CHALLENGES_GATE_ENABLED=true`, every enabled module's own page route
(`/challenges`, `/quiz`, `/flags`) redirects a visitor without a valid unlock
cookie to `/gate`. That list is exact-match and it is *pages* — the proxy
matcher deliberately does not widen over `/api/*` (doing so would put the
gate in front of `/api/auth/*`, breaking the sign-in a contestant needs in
order to pass the gate, and in front of `/api/gate` itself, and would answer
API calls with a page redirect an API client can't act on).

Instead, the three module routes that bank points or leak challenge content
— `POST /api/quiz/answer`, `POST /api/classic/submit`, and
`POST /api/hints/reveal` — run their own server-side gate check
(`requireGatePassed()`) beside their other rules, and refuse with
**403 `{ error: "gate" }`** while the lock screen is up. Everything else the
API routes already enforced independently still holds regardless: a session
is required, the admin **pause** and the **scheduled scoring window** are
checked on every write, and per-question attempt caps and cooldowns (or
classic's own submission cooldown) apply. So an organizer who additionally
sets the scoring window (or keeps the event paused) is not exposed even if
they somehow rely on the password gate alone — the schedule/pause pair in
the admin panel (see [Organizer admin panel](#organizer-admin-panel)) is
still the control that actually stops early scoring.

Read the gate for what it is: a "the board opens at the keynote" curtain over
the contestant-facing pages and the handful of API routes that bank points or
leak content, and a way to keep the challenge list unpublished until the
event starts. It is **not** an authorization boundary — every API route
(gated or not) still enforces its own rules independently, including
`/api/admin/*` (organizers must be able to configure the event before
kickoff) and `/api/team/*` (registration has its own separate window and is
meant to be open pre-event). If you need scoring genuinely shut until a
moment in time, set the scoring window (or keep the event paused) as well as
— or instead of — the password gate.

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
