# Changelog

Releases are repo-level annotated tags cut from `main`
([SemVer](https://semver.org/)); GitHub Releases carry the generated
commit-level notes, and this file keeps the human summary. The version is
repo-level — `apps/web/package.json` tracks the current tag; `scorer` and
`sync` deliberately carry no version field.

## Unreleased

- **Every AI endpoint now demonstrates itself.** The panel shipped a
  ready-to-run curl for one route — `/api/ai/event`, on each challenge's own
  row — and left the other two as a URL and nothing else: an organizer could
  copy `/api/ai/submit` and still not know whether it wanted a header, what
  came back, or what a wrong flag looks like next to a refusal. Each of the
  three endpoint URLs now carries a collapsed demo answering **send /
  receive / expect**: a runnable request, the `200` it returns, and the
  refusals worth designing for (a wrong flag and a cooldown for Submit;
  `invalid-signature`, `stale-request` and `replay` for Event; an expired
  token and the 120/min budget for State). **State** is marked *read-only* —
  the one route of the three that writes nothing, so it can be tried against
  a live event with no consequence. Every value is a placeholder; the real
  signing key and the one-click dry run stay on the per-challenge row, and a
  test asserts no key- or token-shaped string reaches the demos.

- **The AI panel says what the external site has to do, and the token
  handshake has a diagram.** The panel handed an organizer the endpoint URLs,
  a per-challenge signing key and a Send test button, then told them to
  "stand up the external challenge site against the integration contract" —
  fine for whoever writes that site, no help to the organizer standing
  between them and it. A new **Wiring the external site** drawer, collapsed
  above the challenge list, gives the handshake in five steps (take the token
  from `{token}`, verify it with the public launch key, re-read State for
  live progress, report the solve signed over
  `"<timestamp>.<raw body>"` within ±300s, expect one award per `jti`) and
  sets the two keys side by side — the **launch key** is public, one per
  event, and fetched; the **signing key** is secret, one per challenge, and
  pasted — because conflating them produces a signature failure that looks
  exactly like a wrong key. The AI module's setup checklist now names those
  four external-side requirements instead of deferring all of them to a link.
  `docs/ai-module.md` opens with a new animated diagram of the whole
  handshake, and the operations guide's AI section carries it too, above a
  checklist of what an operator configures on the far end. No store, key or
  API change; no secret is rendered by the new drawer.

- **Module screens are content screens (admin redesign, PR 3 of 3).** Each
  module's admin screen opens with a sticky header — its name and an
  **Enabled** switch, the same control as Event's Modules row — and a setup
  status line ("Setup complete · 4 categories · 12 challenges") that opens
  into the checklist only while a verifiable step is still to do; steps done
  outside the panel are no longer repeated, and the safe / not-safe mid-event
  lists move into their own drawer. One compact **Settings** card holds the
  title, blurb, the module's knobs and a link to Hints. Categories are a row
  of inline chips (move left/right, remove on hover or focus). Challenge lists
  are grouped by category with a count per heading, and each row keeps Edit
  on the row with Move up / Move down / Delete in a **⋯** menu; the AI board
  renders through the same list with its integration disclosure under each
  row. Danger red is reserved for what cannot be undone: Delete and Remove
  are neutral until their confirmation, Rotate is amber, and a **solved** or
  **would-award** Send test is green. The admin's type floor rises: nothing
  under 12 px, explanatory text at 14 px, dense tables and eyebrows keep
  12 px. Stored keys, API routes and validation are unchanged.
- **The admin's live views refresh themselves, and every switch says whether
  it saved (admin redesign, PR 2 of 3).** Overview, Activity and Insights
  load when opened — never on page load, so reaching Support still costs no
  Redis read for the O(contestants) metrics fold — and, while the event
  phase is live, refresh every 15 s (Insights every 30 s), each with an
  "updated Ns ago · refreshes every 15 s" stamp that turns into
  "auto-refresh paused while the event is not live" before scoring opens or
  after a freeze; a hidden browser tab never polls, and Activity's timed
  refresh re-reads as many rows as were paged in rather than snapping back
  to page one. The Refresh buttons become secondary and share the timer's
  code path. A new `AdminSwitch` replaces every native checkbox in the panel
  (module switches, Freeze scoring, Team registration, Overview's Scoring and
  Registration, Hints enabled) with a real `role="switch"` that reports
  "Saving… / Saved / <the refusal>" beside the row, through the same status
  line the numeric fields use — the numeric fields, in turn, lose the native
  spinner that clipped five-figure values. The settings audit line ("last
  changed by …") no longer appears under Activity or Insights, and the
  Insights sparkline gets a time axis. Stored keys, API routes and validation
  are unchanged.
- **The admin panel has a sidebar, an Overview, and a compact header (admin
  redesign, PR 1 of 3).** The nine flat tabs are now a left sidebar in three
  groups — Run (Overview, Activity, Insights, Support), Content (one per
  enabled module), Setup (Event, Hints, Admins) — collapsing to a drawer on
  narrow screens. Deep links stay `?tab=<id>`; an unknown id falls back to
  the new **Overview** instead of Event. Overview answers "is scoring on, how
  many teams, is anything stuck" in one screen: phase and time remaining,
  Scoring and Registration as switches, the four funnel figures (Stuck first
  when non-zero), the sync health line folded in from the old Status card,
  the five most recent activity rows, and a setup-status line per module —
  read-only apart from the two switches, and a snapshot for now (the 15 s
  refresh is PR 2). The header is one row (`Admin · event · phase · until
  date`) reusing the public phase strip's vocabulary; the "Organizer / Admin"
  block and the outer Controls frame are gone. The hint policy moved out of
  Event onto its own **Hints** destination — stored keys and validation
  unchanged, as with its earlier moves. Every existing tab renders unchanged
  inside the new shell.
- **Every fail-direction gate in the pause/schedule contract is now pinned by
  a test (#232).** `hint-store.ts` `revealHint` documents and pins fail-CLOSED
  on a settings-read error (never charge on uncertainty); `team-store.ts`
  `isRegistrationClosed` now catches a transport failure the same way it
  already tolerated a per-command error, failing OPEN on both (a Redis blip
  must not itself block registration — the join/create Lua script still
  validates every real invariant atomically) — matching
  `resolveTeamMaxMembers`'s existing reasoning right above it. A new shared
  differential corpus, `test/fixtures/window-corpus.json`, is run verbatim by
  all three `outsideWindow` readers (`apps/web`, `scorer`, `sync`) so a
  `<`→`<=` flip at the exact scheduled-window boundary in any one of them
  fails CI even if that reader's own hand-written cases miss it.
- **Every numeric setting says whether it saved.** The nine numeric knobs and
  the four schedule fields now report beside the field: "Saving…" while the
  write is in flight, "Saved" for a moment after, or the reason it was refused
  — junk, a fraction, a negative or a blanked field snaps back to the stored
  value *with* that reason, and a server rejection is rewritten through the
  field's label ("Hint cost must be a whole number between 0 and 100,000.")
  instead of landing as `hintCost must be an integer in [0, 100000]` under
  the whole panel while the rejected text stayed in the box (admin UX audit
  F2). The refusal is announced (`role="alert"`) and tied to its input
  (`aria-invalid`, `aria-describedby`). One shared component,
  `components/admin-number-field.tsx`, replaces the hand-written pair on
  every tab; stored keys and server validation are unchanged.
- **The AI tab is a list again.** The three module-wide endpoint URLs render
  once above the challenge list instead of inside every row, and each row's
  integration panel (signing key, test curl, Send test) is collapsed until
  opened — three challenges had made the tab 2,253 px tall, 542 px a row
  (F5). A flag-only row's summary says the panel is not needed for it.

- **Hint policy moved to the Event tab.** The four hint knobs (enabled, cost,
  solves required, unlock after) govern Secure Development, Classic and AI
  hints alike, but rendered only on the Secure Development tab — so a
  classic-only or ai-only event sold hints at the default price with no switch
  anywhere in the panel (admin UX audit F1). They now sit in a **Hints**
  section on Event, under the schedule, and the unlock-after help names the
  **Scoring opens** field instead of pointing "below" at a tab that no longer
  held it (F6). Secure Development keeps its re-run cooldown. Stored keys and
  server-side validation are unchanged.
- **The blurb help tells the truth.** The module-identity blurb's help text
  said it was "not shown on any page"; it is the lede under the title on the
  quiz, flags and AI boards and those pages' meta description. The help now
  says so (admin UX audit F3).
- **Support shows AI progress.** The contestant lookup reads the AI solves,
  attempts and points alongside quiz and classic, the card shows them, the
  attempts total includes them, and the reset-progress confirm names "classic
  and AI solves" and sums all three modules' points — the total the reset
  actually removes (F4). "Sec-dev solves" is spelled out as Secure Development.
- **Every module tab opens with a setup checklist.** A new registry contract,
  `ModuleDef.setup` (module contract §5.9): what contestants experience, the
  minimum to make the module playable in dependency order with each step
  marked in-panel or outside, what is safe to change mid-event, and a link to
  the module's operations guide. Rendered by one shared component ahead of the
  identity editor; where the panel holds the count (questions, challenges,
  categories) the step shows it live, and says "Checking…" until it does.

- **`pnpm lint` is green and CI runs it.** The app's lint had sat red (4
  errors, 5 warnings) with nothing running it — hygiene audit T1. Each
  finding is fixed in the code rather than excused: the three
  `set-state-in-effect` errors by parking the nav dropdown's focus request in
  a ref and moving the admin panels' mount-time fetch to a module-level
  function whose result the effect applies in a callback; the render-time
  `Date.now()` in the Event tab's schedule readout by stamping "now" in the
  handlers that apply settings; the rest by deleting the dead imports, the
  dead `hasSecureDev`, and a `next/image` mock nothing under its subject
  rendered. No `eslint-disable` added, no rule downgraded. The `app` CI job
  now runs `corepack pnpm lint` right after install, and AGENTS.md,
  CONTRIBUTING and the README's command lines carry the same step. Dead code
  the audit proved dead goes with it: the never-wired `score-check.tsx` (and
  the `check-land` keyframe only it used), the unused `tsx` devDependency,
  the whole-catalogue totals in `apps.ts`, the dead re-exports in `ai-keys`
  and `admin-store`, the exported-but-in-file-only `toCatalogChallenge`,
  `enabledModuleRoutes` (the proxy gates the registry's full route list on
  purpose — see the comment on `GATED_ROUTES`), and the single-team
  `getTeamQuizTotals` wrapper whose only caller was its test. All internal to
  `apps/web`; no behaviour changes.
- **The profile page names the team hash through `teamKey`, and the judge's
  network comments say what the network is.** `profile/page.tsx` still
  open-coded `ctf:team:<slug>` twice — the reader ADR 48 moved the builders
  into `team-keys.ts` for — behind a comment excusing it; it now imports
  `teamKey` like every other reader, and a source-scan test keeps the literal
  from coming back. `scorer/entrypoint.sh` and `scorer/entrypoints/webgoat.sh`
  described `$NETWORK` as `--internal`; it is a plain `docker network create`
  bridge (as `docs/scorer.md` already said) on which the app under test
  publishes no host ports. Comments only — no `docker network
  create` line changed.
- **Every live Redis suite runs in CI now, not just the grading Lua.** The
  `hint-store` and `team-store` `.upstash` suites had rotted (#235): the
  reveal path grew an anti-burner gate that refused every purchase the suite
  made (it seeded a hint but no solve), and a populated team's captain can no
  longer simply leave. Both are repaired against the current rules — the hint
  suite seeds its policy through `updateAdminSettings` and earns the gate
  with a solve, asserting on the way that the refusal charges nothing; the
  team suite asserts the captain refusal is a no-op, then transfers and
  leaves — and each still goes red when the store it covers is mutated by
  one line. The three older suites gate through `live-redis.ts` like the Lua
  ones, so `CTF_LUA_SUITES_REQUIRED=1` covers them too, and the CI step runs
  every `*.upstash.test.ts` file (`vitest run upstash
  --no-file-parallelism`, serial because two suites share
  `ctf:admin:settings`). No runtime behaviour changes.
- **Four HIGH Dependabot alerts in the app lockfile cleared.** `browserslist`
  (two advisories), `js-yaml` and `brace-expansion` — all dev/build-side
  transitives of `next` and `eslint-config-next` — re-resolved to patched
  versions. `browserslist` needed an `overrides:` floor in
  `apps/web/pnpm-workspace.yaml` because pnpm would not move a package that
  is also a peer of `update-browserslist-db`; the comment there says when to
  drop it. pnpm is now pinned for corepack via `packageManager`
  (`pnpm@11.25.0`, the version CI was already resolving), so the settings
  file's semantics no longer depend on whichever pnpm corepack fetched that
  day. No runtime behaviour changes.
- **Store `catch` blocks log a redacted label, never the exception object,
  and a bulk import refuses to write after a failed read.** The classic and
  quiz stores logged the raw caught value at six sites, three of them the
  `catch` around the grading call whose arguments are the submitted flag or
  answer — hardening, not a reported leak: no error shape reachable today
  carries them, but a driver that attached its failed request would have put
  the event's flags in the log. The ai store's `errorLabel` (#241) is now a
  shared `lib/error-label.ts` used by all three (#244). Classic's and quiz's
  `importBundle` also inspected neither reply of their membership read, so a
  transient `GET ctf:classic:categories` failure became an empty category
  list that the write pipeline then made permanent; both now throw before
  any write, as the ai store already did (#261).
- **Docs reconciled with the code the hygiene audit compared them against.**
  The review guideline's public-surface list names all five unauthenticated
  `/api` routes (it said three), the same-origin carve-out and rate-limit
  lists include the ai module's routes, and the team-required boundary names
  `/api/ai/submit`; CONTRIBUTING counts ten CI jobs and four modules and
  lists `acceptance-ai-only.sh`; the README's copy-pasteable scorer test line
  runs `acceptance-scorer.sh` from the repo root, where it lives; the
  pre-event gate's scope is stated once and correctly (`apps/web/.env.example`
  said the module APIs were not behind it — they are). Two shipped planning
  files (`docs/DOCS-PLAN.md`, `docs/DOCS-CHANGELOG.md`) and the
  `github.oauth_client_id` key in `event.yaml.example`, which no reader ever
  read, are removed.
- **The grading Lua is executed by tests now, against a real Redis.** Classic's
  `SUBMIT_SCRIPT`, quiz's `GRADE_SCRIPT` and ai's `AWARD_SCRIPT` — the
  scripts that decide points — had never been run by any test; the mocked
  suites pinned only the arguments handed to them. Three
  `*.lua.upstash.test.ts` suites now run the real scripts against redis +
  srh (skipped locally without the env, required in CI), and each of the
  six one-line Lua mutations the August review found survivable now fails a
  test. The three script constants are exported for that purpose; nothing
  else about them changed.
- **The event archive now carries the AI catalogue** (#250, #155's ai half).
  Export writes an `ai` section — challenges with their mode, launch URL
  template, flag, hint, categories and per-challenge signing key — and
  import clears and replaces the AI board like the classic and quiz ones, so
  an archived event no longer loses its AI challenges and an external site
  configured against a signing key keeps working after a restore. The
  module's launch keypair is deliberately not in a bundle and an import
  leaves the box's own pair alone. Bundles exported before this change
  still import unchanged (the section is optional); a bundle with an `ai`
  section imports into an older box only after removing it.
- **`ctf-setup.sh --dry-run` is dry again, and `--out` is honoured
  everywhere.** The wizard's org step probed the org with `gh api` and ran a
  full `doctor` sweep even under `--dry-run`, and step 1 probed `gh auth
  status` / `docker compose version`; all are narrated instead. `secrets`
  writes its env file owner-only (`0600`) regardless of the caller's umask.
  `org` read `SCORE_IMAGE` from a hardcoded `.env` even when `--out` named
  another file. A value-taking flag left without a value now fails with the
  script's own message rather than bash's "unbound variable".
- **Acceptance scripts fail loudly, not silently.** The bare `grep -q`
  assertions in `acceptance-app.sh` and `acceptance-quiz-only.sh` died under
  `set -e` with no output; each now names what was missing.
  `acceptance-patched.sh`'s "no challenges found" guard was unreachable for
  the same reason. `scripts/dev-stack` (no `.sh` suffix) is now in CI's
  shellcheck list.
- **Redis reads that fail now say so, everywhere.** `sync`'s pipeline client
  used to swallow a per-command error reply (`WRONGTYPE`, `NOAUTH`, an
  unsupported command) as `undefined`, which its callers read as "not paused",
  "no reset" and "status written" without a log line; it now throws like the
  scorer's client, so every caller's documented fail-open direction still
  applies but is visible. The scorer's own pause read logged nothing on
  failure; it does now.
- **A hung Redis proxy can no longer stall the poller or a score POST.** All
  three Upstash/SRH pipeline clients (`apps/web`, `scorer`, `sync`) abort a
  round trip after 10 s instead of waiting forever.
- **Numeric knobs are validated instead of silently misbehaving.** A
  non-numeric `POLL_INTERVAL_MS` used to poll GitHub in a tight loop
  (`setTimeout(NaN)` fires immediately — and so does any value past
  `setTimeout`'s 2^31−1 ms cap, so the accepted range is now 1 to
  1 789 569 705 ms) and a non-numeric or blank scorer `PORT` bound a random
  port (`PORT` must now be an integer 0–65535; the default stays 4000).
  Both refuse to start with a clear message; a running event is unaffected
  unless it already carried an invalid value, which never worked. An
  installation token whose `expires_at` is missing, unparseable or already
  past is rejected instead of being re-minted on every call.

## v0.4.0 — 2026-09-01

A playable Classic CTF, an event you can carry somewhere else, and a
front end that tells the truth.

- **Classic CTF** became a board rather than a form: a category-grouped tile
  grid with a dedicated page per challenge (#208), and **paid hints** sold
  through the same gate, price and penalty machinery as secure-development
  (#190). The hint penalty nets the FINAL total as the scoring pipeline's
  last stage, so a hint bought against one module can never be discounted by
  another module's points.
- **Event archive**: export a whole event — catalogues, teams, solves,
  settings — to a JSON bundle and import it back (#155). An event is now
  portable between boxes, and a finished one can be kept without keeping its
  infrastructure.
- **Teams first.** Team setup is the first step after sign-in (#219), rather
  than something a contestant discovers after their first solve banks into no
  team total.
- **Admin activity log**: login timestamps plus a filterable event stream on
  a new Activity tab (#213) — the mid-event question "did anyone sign in
  yet?" answered without a Redis console.
- **Visual identity**: the original navy/blue terminal look enhanced rather
  than replaced, with progress displays that read at a glance (#207).
- **Accessibility and resilience**: per-route loading states, error
  boundaries that keep a failure inside the segment that caused it, a skip
  link, focus handling that survives a control being replaced, and mobile
  fixes (#240).
- **A contestant-facing copy/UX truth pass** (#200, tiers 1–4): honest
  claims, state-aware affordances, an effective-state readout, and every
  module accounted for on the leaderboard and profile.
- **Audit and correctness fixes**: quiz freeze reads fail open like classic
  (#215); hint penalties and roster rows match case-insensitively (#216);
  signing out of a session-gated page redirects home (#214); classic carries
  `caseSensitive` back out of the store, so a case-sensitive challenge stays
  badged and exports correctly (#196); a challenge page's 404 now attaches to
  the right boundary and says which of its two causes fired (#208
  follow-ups).
- **Sign-in and navigation fixes**: post-signin redirects are relative rather
  than derived from `request.url`, fixing a localhost bounce (#227); the
  avatar menu survives session revalidation (#228); the user menu closes
  reliably and its links work in Brave (#223).
- **Documentation overhaul** (#218): README rewritten (status above the fold,
  a fair comparison, a working no-GitHub quickstart), stale-doc drift fixed
  across the set, ADR and section anchors made renderer-stable, a new
  troubleshooting runbook and glossary, and an explanation of how Insights
  computes each figure (#198). The landing copy's false "each app is an OWASP
  project" claim is corrected and the baked "OWASP CTF area" strings now
  follow `event.name`; the OWASP-CTF default branding is kept.
- **Review and CI**: a tuned CodeRabbit configuration carrying this repo's
  own invariants as pre-merge checks (#220, #225, #236), with the
  breaking-change documentation check demoted to a warning after it blocked a
  PR on a stale snapshot of its own description (#242); cross-area CI
  path-filter edges closed so a touched area can no longer skip its jobs
  (#236); every fork-repo-name reader pinned to `setup/targets.tsv` (#199);
  a reference patch for Security Shepherd's `Challenge-10-IDOR-2` (#221).
- **Dependencies**: Redis 8-alpine, the Next.js group, and
  `github/codeql-action` v4.

No breaking changes: no `event.yaml` key, `ctf:*` Redis key, scorer payload
or `ctf-setup.sh` flag changed shape. An event running v0.3.0 upgrades by
redeploying — which also moves Redis from 7-alpine to 8-alpine. Redis 8 reads
a 7 AOF dataset, and the compose file keeps it on the named `redis-data`
volume, so scores survive the container being replaced. Pause the event from
`/admin` before redeploying a live one, and do not bring the stack down with
`-v` — that removes the volume, which is the one action here that loses data.

## v0.3.0 — 2026-08-23

Three modules, runtime admin controls, zero vacuous passes.

- **Quiz** and **Classic CTF** shipped as full modules — authored from
  `/admin` (single and bulk JSON-bundle authoring), graded in the app,
  each able to run an event alone with no scorer or GitHub org.
- The admin panel became the runtime control plane: grant/revoke admins,
  switch modules on and off mid-event, set the team cap, scoring cooldown,
  scheduled scoring and registration windows, per-module titles — all
  without a rebuild. Support actions (reset/delete a contestant, take over
  a team) and engagement metrics (Insights) landed alongside.
- Teams: required to score, one-click solo play, shareable `/join/<code>`
  links.
- Security hardening: Redis authenticated and cut off from the app tier,
  same-origin assertions on mutating routes, rate limits on join/reveal,
  HTTPS enforced for production events.
- The vacuous-pass war: a sweep that points every rubric at an
  up-but-useless stub reached **0 of 321** and became a CI gate.
- Deploys: the whole stack as one Fly machine running the repo's own
  compose file; workflow version-stamping with a per-fork `upgrade` path;
  `doctor` verifies the package Read grant by observation.

## v0.2.0 — 2026-08-16

Guided wizard, AWS deploy, verifying doctor.

- `ctf-setup.sh` became a resumable guided wizard that prompts for every
  value inline and does each automatable step.
- Single-shot AWS deploy: a Terraform module for one ephemeral EC2 box.
- `doctor` grew into the per-fork provisioning status matrix.

## v0.1.0 — 2026-08-15

First tagged release: the full offline-tested kit — compose stack, poll
pipeline, six vendored target rubrics.

- **Security (critical):** closed the score-comment forge — the scoring
  workflow could be made to post a contestant's own forged
  `<!-- ctf-score: -->` marker as `github-actions[bot]`. The judge's report
  now lives outside the PR checkout (`CTF_OUT_DIR`) and is posted only when
  the scorer step succeeded.
- Hardening: baseline security headers in both Caddyfiles; the srh proxy
  image pinned by digest.
