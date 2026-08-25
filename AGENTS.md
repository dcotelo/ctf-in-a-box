# AGENTS.md

Guidance for AI coding agents (and humans who want the short version) working
in this repo. This follows the tool-agnostic [AGENTS.md](https://agents.md)
convention: any agent operating here should read this file first.

## Build/test/lint

These are the authoritative commands — they match what CI runs in
`.github/workflows/ci.yml` exactly. Node 22 is used across the board.

**sync** (poll/push transport service):

```sh
cd sync && npm ci && npm test
```

**scorer** (judge + leaderboard engine):

```sh
cd scorer && npm ci && npm test
node tools/vacuous-sweep.mjs      # the vacuous-pass gate — must report 0
cd .. && ./scripts/acceptance-scorer.sh   # repo root — the script lives in scripts/
```

**app** (contestant web app):

```sh
cd apps/web
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm test
```

CI also runs a production build (`corepack pnpm build`, with dummy
`BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`) and `./scripts/acceptance-app.sh`
after the test step — run those too if you touched build-affecting config.
Between the two, CI asserts `apps/web/.next/server/app/index.html` does
**not** exist: `/` must never be statically prerendered, or the module nav
(resolved through a build-time-unreachable Redis read) freezes at build time.
Check it after any build you run here.

**quiz-only / classic-only** (single-module compose bring-ups):

```sh
./scripts/acceptance-quiz-only.sh
./scripts/acceptance-classic-only.sh
```

**shell / setup** (provisioning and automation scripts):

```sh
shellcheck scripts/*.sh scripts/lib/*.sh setup/*.sh scorer/entrypoint.sh \
  deploy/fly/deploy.sh deploy/fly/render-compose.sh
bats setup/test/
bats deploy/fly/test/
```

(CI additionally lints `scorer/entrypoints/*.sh` as POSIX `sh` fragments with
`shellcheck -s sh --exclude=SC2034` — those are sourced by `entrypoint.sh`,
never run standalone.)

**smoke** (full stack):

```sh
./scripts/smoke.sh
```

## CI

`.github/workflows/ci.yml` has a `changes` job that path-filters which areas
a PR touches, and every other job `needs: changes` and is gated on that
job's output — a job for an untouched area is *skipped* (which still
satisfies a required check), not run needlessly. A push to `main` (i.e.
post-merge) always sets every area `true`, so `main` gets the full run as a
safety net regardless of what the merged PR touched.

The `vacuous` job runs `scorer/tools/vacuous-sweep.mjs`, which points every
target at a stub that is UP but USELESS and fails if any challenge still
passes. It needs no Docker — the stub is an in-process HTTP server — so it is
minutes of plain Node rather than a container bring-up. It was wired in only
once the count reached 0/321: a gate adopted while findings remain is a gate
somebody has to disable.

Two heavier workflows, `stock-scores-zero.yml` and `patched-scores-right.yml`,
are scoped with their own `paths:` filters to judge-relevant scorer inputs
(rubrics, judge/exec/probe/catalogue source, the scorer Dockerfile/entrypoint)
rather than the full `scorer/` tree — they run real target containers, so
they're reserved for changes that could actually move the score.

## Conventions & gotchas

These are real failure modes this project has hit — treat them as rules, not
suggestions.

- **Commits.** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`,
  `chore:`, `ci:`, ...). No AI attribution — no "Generated with", no
  `Co-authored-by:` trailers for an AI tool or agent.
- **Bash (`setup/`, `scripts/`) must be bash-3.2/macOS compatible.** No
  `jq` or `python` on the provisioning path (`gh api --jq ...` is fine —
  that's `gh`'s own built-in JSON filtering, not a `jq` dependency). Quote
  your expansions. **Avoid `A && B || C`** — CI's shellcheck flags this as
  SC2015 (the `C` branch also runs if `B` fails); use `if ...; then ...; fi`
  instead.
- **bats assertions must be the test's last statement to gate pass/fail.** A
  `[[ ... ]]` conditional, or a `! ... | grep ...` pipeline, that is *not*
  the final statement in a `@test` block does **not** fail the test on a bad
  result — bash's `!` prefix combined with a non-last compound command is
  errexit-exempt, so the shell just keeps going. Make the decisive check the
  last thing in the test, and prefer a form that actually exits nonzero on
  failure: single-bracket `[ ... ]`, `[ -z "$(... | grep -F ...)" ]`, or a
  trailing `grep -qx ...`.
- **`ctf-setup.sh --dry-run` must make zero `gh`/`docker` calls.** Every
  provisioning step must be idempotent (check-then-skip if already done).
  Every `check_step` must **fail closed** — a `gh` API error or nonzero exit
  must never be interpreted as "the step is already satisfied."
- **Scorer stock-scores-zero invariant.** A stock, unpatched target must
  score 0 on every challenge. Watch for vacuous passes: a test that "blocks"
  an exploit only because the app wasn't actually up/reachable yet looks
  like a pass but proves nothing.
- **The app bakes `event.yaml` at BUILD time via the `EVENT_CONFIG_B64`
  build-arg.** Building the app without it (`docker compose build app` with the
  arg unset) silently yields neutral defaults — an empty `admins` list (so
  `/admin` 403s for everyone) and generic branding. Always bring the box up as
  `EVENT_CONFIG_B64="$(base64 < event.yaml | tr -d '\n')" docker compose
  --profile poll --profile app up -d --build`. `scripts/dev-stack` already
  does this.
- **Compose profiles follow the enabled MODULES.** `app` is always on.
  `secure-development`'s two services are profiled *differently*, and that is
  deliberate: `scorer` carries `["poll", "push"]` (both ingest modes need it),
  `sync` carries `["poll"]` only — in push mode the fork's Action POSTs to the
  scorer directly, so there is no poller to run. A quiz-only event boots with
  `--profile app` alone — it has no scorer image to pull, and the compose
  fallback is a private upstream one. So: never give a secure-development
  service the default (profile-less) treatment, and never add a `depends_on`
  from `app` to a profiled service — that drags it into every `up` and
  re-breaks the quiz-only boot.
- **Every compose service must name its network.** `docker-compose.yml`
  assigns each service to `frontend` or `backend` explicitly (only `srh` is on
  both — that split is what keeps `app` from reaching `redis:6379`; see ADR
  41). Compose's rule is that a service declaring NO `networks:` key joins
  `default` — a **third** network, isolated from both — so an override file
  that adds a service without one produces a container nothing else can
  resolve. This already broke `smoke.sh` once: `mock-github` is defined only
  in `docker-compose.smoke.yml`, inherited no network, and `sync` failed every
  poll with nothing but `fetch failed` to go on.
- **`REDIS_PASSWORD` is required, not optional.** Compose reads it with
  `${REDIS_PASSWORD:?}`, so anything that brings the stack up — a script, a
  test, `docker compose config` — must set it or fail at interpolation. Note
  `config`'s failure is easy to swallow: `acceptance-quiz-only.sh` pipes
  stderr to `/dev/null`, where a missing value would have turned into an empty
  service list and a vacuously passing comparison.
- **The score-comment marker is trust-authoritative — it must only ever come
  from the judge's own output, never from the PR checkout.** The sync poller
  ingests any `<!-- ctf-score: {json} -->` marker in a `github-actions[bot]`
  comment as real points. The judge writes its report to `CTF_OUT_DIR` (a dir
  OUTSIDE the PR checkout), and the workflow's final-comment step reads it only
  from there and only when the scorer step succeeded. Never post
  checkout-derived content as the bot, and never gate that post on
  `if: always()` without an outcome check — either reopens the score-forge.
- **The pause/schedule contract lives in THREE readers — change them in
  lockstep.** `effectivePaused`/`outsideWindow` (freeze + scheduled scoring
  window) is implemented independently in
  `apps/web/src/lib/schedule-window.ts` (re-exported through
  `admin-store.ts`), `scorer/src/store.js`, and `sync/src/redis.js`;
  registration windows in `team-store.ts`. They read the same `ctf:admin:settings` fields and must
  agree. Manual-freeze reads fail **open** (a Redis blip must not drop live
  submissions); keep that.
- **Do not commit `docs/superpowers/`.** It's gitignored planning/spec/plan
  scratch space, not shipped documentation.

## Repo layout

- `apps/web/` — vendored Next.js contestant app (auth, teams, leaderboard,
  admin panel). `pnpm`.
- `scorer/` — judge + leaderboard scoring engine. Plain Node.js, `node:test`.
- `sync/` — poll service feeding the leaderboard from score comments. Plain
  Node.js, `node:test`.
- `setup/` — `ctf-setup.sh` and event provisioning. Bash, `bats`.
- `deploy/` — optional cloud deploy modules (e.g. `aws-terraform/`, a
  single-shot EC2 box). CI-validated by `.github/workflows/terraform.yml`
  (fmt + validate + test, never apply). **`terraform validate` does NOT
  inspect rendered template output** — `deploy/aws-terraform/userdata.tftest.hcl`
  is what reads the rendered `user-data.sh.tftpl`, so bring-up script changes
  need a test there, not just a passing validate.
- `docs/` — documentation site, published via GitHub Pages.

## Where to look

- [`docs/architecture.md`](docs/architecture.md) — how the stack fits
  together: diagram, score data flow, security model, testing strategy.
- [`docs/modules.md`](docs/modules.md) — the module contract: the boundary
  between the platform and a challenge module.
- [`docs/scorer.md`](docs/scorer.md) — the scorer engine: serve + judge
  modes, both rubric grammars, authoring and building rubrics.
- [`docs/hosting.md`](docs/hosting.md) — standing the kit up: prerequisites,
  poll vs push, OAuth app, event config.
- [`docs/decisions.md`](docs/decisions.md) — numbered ADRs recording why the
  kit is built this way instead of the alternatives.
