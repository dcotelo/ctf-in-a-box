# AGENTS.md

Guidance for AI coding agents (and humans who want the short version) working
in this repo. This follows the tool-agnostic [AGENTS.md](https://agents.md)
convention: any agent operating here should read this file first.

## Build/test/lint

These are the authoritative commands — they match what CI runs in
`.github/workflows/ci.yml` exactly. Node 22 is used across the board; run
the suites on 22 — a sync/scorer suite was green on Node 25 and red on 22 in
CI (#256, an unref'd `AbortSignal.timeout` timer).

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
corepack pnpm lint
corepack pnpm test
```

The grading Lua scripts (`SUBMIT_SCRIPT`, `GRADE_SCRIPT`, `AWARD_SCRIPT`) are
the scoring authority, and `src/lib/__tests__/*.lua.upstash.test.ts` execute
them against a real Redis behind srh; the `admin-store`, `hint-store` and
`team-store` `.upstash` suites next to them do the same for the settings,
reveal and team scripts. All six gate through `live-redis.ts`: they skip
locally without `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, and CI
brings the two containers up and sets `CTF_LUA_SUITES_REQUIRED=1` so a skip
fails the job. If you touch any of those scripts, run them (the `docker run`
lines are in `ci.yml`'s "Grading Lua" step, then `corepack pnpm exec vitest
run upstash --no-file-parallelism` — serial because `admin-store` and
`hint-store` share the fixed `ctf:admin:settings` hash, and `pnpm exec`, NOT
`pnpm test -- upstash`, which forwards the `--` to vitest, drops the filter
and runs every file) — the mocked grade suites pin only what the stores hand
the script, not what it does.

CI also runs a production build (`corepack pnpm build`, with dummy
`BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`) and `./scripts/acceptance-app.sh`
after the test step — run those too if you touched build-affecting config.
Between the two, CI asserts `apps/web/.next/server/app/index.html` does
**not** exist: `/` must never be statically prerendered, or the module nav
(resolved through a build-time-unreachable Redis read) freezes at build time.
Check it after any build you run here.

**quiz-only / classic-only / ai-only** (single-module compose bring-ups):

```sh
./scripts/acceptance-quiz-only.sh
./scripts/acceptance-classic-only.sh
./scripts/acceptance-ai-only.sh
```

**shell / setup** (provisioning and automation scripts):

```sh
shellcheck scripts/*.sh scripts/lib/*.sh scripts/dev-stack setup/*.sh scorer/entrypoint.sh \
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

**stock-scores-zero / patched-scores-right** (real-target scoring gates):

```sh
./scripts/acceptance-target.sh <target> <stock-image|none>   # stock app scores 0/N
./scripts/acceptance-patched.sh <target> <challenge-id>       # patched fork scores exactly that one
```

Not in `ci.yml`: these are the two heavy workflows named under "CI" below,
one matrix row per target or reference patch, and the rows are the example
invocations. Each boots a real upstream image (minutes per row), so run only
the rows for what you touched. Each workflow's `paths:` filter is the
authority on "what" (read it; the two differ slightly). In summary: rubrics
under `scorer/rubric.owasp/`, the judge-path sources in `scorer/src/`, the
scorer Dockerfile, `package.json` and lockfile, the entrypoints, the gate
scripts and `scripts/lib/acceptance-lib.sh`, `patches/`, and the workflow
files themselves.

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
(rubrics, judge/exec/probe/catalogue source, the scorer Dockerfile and
entrypoints, their own acceptance script, and `patches/`) rather than the
full `scorer/` tree — they run real target containers, so they're reserved
for changes that could actually move the score.

The `docs` job builds the Pages site with the action `pages.yml` publishes
with (that workflow runs only on push to `main`), then fails on any relative
`.md` href in the built HTML and any internal link that does not resolve.
The one that bites: `jekyll-relative-links` cannot rewrite a link whose TEXT
wraps across two source lines, so it ships a literal `.md` href that renders
fine on GitHub and 404s on the site — two shipped before the check existed.
Keep link text on one line; link outside `docs/` with an absolute `https://`
URL, never `../`. `codeql.yml` is a stock JavaScript/TypeScript scan on PRs
and weekly, with no repo-side config to keep in step.

**Every PR must also pass CodeRabbit review before merge, not just the CI
jobs above.** CodeRabbit runs automatically on each PR (`.coderabbit.yaml`
tunes it); treat its findings as a required gate. Resolve every actionable
comment — apply the fix, or reply on the thread with the reason it does not
apply and mark it resolved — and leave no unresolved actionable thread on a
PR you intend to merge. A finding you disagree with is answered, not
ignored: CodeRabbit is fallible and a reasoned decline is a valid outcome,
but the decline has to be on the record. Its pre-merge checks
(secrecy boundary, fail-open/closed direction, unpinned dependencies,
breaking-change docs, secrets in logs) encode invariants this repo has been
burned by; a warning from one is a prompt to look, not a formality.

**Always WAIT for CodeRabbit's re-review after every push, and check its
comments — do not treat a PR as done on green CI alone.** CodeRabbit
re-reviews each new commit, and a fix (or a fix to a fix) routinely draws a
fresh finding: the branch is only clean when the *latest* commit has been
reviewed and every actionable thread on it is resolved. So after each push,
wait for the CodeRabbit check to report **Review completed** for that
commit, then read what it left, before you call the PR ready or move on.
"CI is green" is not "CodeRabbit is done" — the two are independent gates and
CodeRabbit lands second.

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
  instead. A bare `grep -q` assertion under `set -e` dies with no output —
  `acceptance-app.sh` and `acceptance-quiz-only.sh` both did in CI (#257);
  every assertion names what was missing before it exits.
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
- **`upstashPipeline` in `apps/web` does not throw on a per-command error.**
  It returns `{ result?, error? }` positionally; a caller that reads
  `.result` without checking `.error` turns `NOAUTH`/`WRONGTYPE` into a
  default. `getAdminSettings` served "not paused" with baked caps and no log
  line (#215); classic's `importBundle` read a failed categories `GET` as
  "none yet" and wrote that emptiness back over the box's list (#261). Check
  `error` and throw so the caller's fail direction applies and says so. The
  `sync` and `scorer` clients throw for you (#256); the app's does not.
- **Logins join case-insensitively, everywhere.** The scorer records the PR
  author's spelling, the app stores the session's, and GitHub logins are
  unique only case-insensitively — so every login join lowercases both sides
  (`module-contributions`, `team-standings`, `hint-penalties`, `admin-auth`).
  Two verbatim joins made one contestant's hints free and showed a scoring
  teammate at 0 pts (#216).
- **Do not commit `docs/superpowers/`, `docs/REVIEW.md` or
  `docs/hygiene-audit.md`.** They're gitignored planning/spec/plan scratch
  space and local audit reports, not shipped documentation — and `docs/` is
  the Jekyll root, so anything tracked there lands on the Pages site.

## Repo layout

- `apps/web/` — vendored Next.js contestant app (auth, teams, leaderboard,
  admin panel). `pnpm`.
- `scorer/` — judge + leaderboard scoring engine. Plain Node.js, `node:test`.
- `sync/` — poll service feeding the leaderboard from score comments. Plain
  Node.js, `node:test`.
- `setup/` — `ctf-setup.sh` and event provisioning. Bash, `bats`.
- `caddy/` — `Caddyfile.poll` / `Caddyfile.push`, mounted by `SCORE_INGEST`.
  Push adds `handle /score` to `scorer:4000` for the fork's Action; the rest
  proxies to `app:3000`. Same headers in both — change them together.
- `patches/` — `<target>/<challenge-id>.patch`, one reference fix per
  challenge; the input to `acceptance-patched.sh`. `git`-format diffs against
  the source the script pins by commit; `patches/README.md` is the contract.
- `test/fixtures/` — `mock-github.mjs` and `mock-scorer.mjs`, the stand-ins
  `docker-compose.smoke.yml` builds for `smoke.sh`. Nothing else reads it.
- `deploy/` — optional cloud deploy modules: `aws-terraform/` (single-shot
  EC2 box; `docs/aws.md`) and `fly/` (one Fly machine running the rendered
  compose file; `docs/fly.md`; its scripts and bats suite run under the
  `shell` job). `aws-terraform/` is CI-validated by
  `.github/workflows/terraform.yml` (fmt + validate + test, never apply).
  **`terraform validate` does NOT inspect rendered template output** —
  `deploy/aws-terraform/userdata.tftest.hcl`
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
- [`docs/operations.md`](docs/operations.md) — running the event once it is
  up: admin panel and runtime overrides, teams, the event archive, per-module
  runbooks, pre-event verification, dev-stack, known limitations.
- [`docs/ai-module.md`](docs/ai-module.md) — the `ai` module's contract with
  the external challenge site: launch tokens, solve reporting, errors, keys.
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — symptom-ordered
  runbook for a misbehaving stack: the `REDIS_PASSWORD` refusal, `/admin`
  403s from a config-less build, `fetch failed` between services.
- [`docs/decisions.md`](docs/decisions.md) — numbered ADRs recording why the
  kit is built this way instead of the alternatives.
- [`docs/reviewing.md`](docs/reviewing.md) — the review guideline: the
  invariants a PR review must verify (secrecy boundary, Lua authority,
  fail directions, anti-vacuous tests) and the ADR-settled choices not to
  re-flag. `.coderabbit.yaml` is its machine-enforced subset.
