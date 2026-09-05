# Changelog

Releases are repo-level annotated tags cut from `main`
([SemVer](https://semver.org/)); GitHub Releases carry the generated
commit-level notes, and this file keeps the human summary. The version is
repo-level — `apps/web/package.json` tracks the current tag; `scorer` and
`sync` deliberately carry no version field.

## Unreleased

- **The profile page names the team hash through `teamKey`, and the judge's
  network comments say what the network is.** `profile/page.tsx` still
  open-coded `ctf:team:<slug>` twice — the reader ADR 48 moved the builders
  into `team-keys.ts` for — behind a comment excusing it; it now imports
  `teamKey` like every other reader, and a source-scan test keeps the literal
  from coming back. `scorer/entrypoint.sh` and `scorer/entrypoints/webgoat.sh`
  described `$NETWORK` as `--internal`; it is a plain `docker network create`
  bridge (as `docs/scorer.md` already said), and the app under test stays off
  the host because it publishes no ports. Comments only — no `docker network
  create` line changed.
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
