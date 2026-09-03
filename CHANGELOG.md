# Changelog

Releases are repo-level annotated tags cut from `main`
([SemVer](https://semver.org/)); GitHub Releases carry the generated
commit-level notes, and this file keeps the human summary. The version is
repo-level — `apps/web/package.json` tracks the current tag; `scorer` and
`sync` deliberately carry no version field.

## Unreleased

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
