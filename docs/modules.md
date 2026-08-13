# Module contract

A **module** is a CTF vertical — a family of challenges with its own targets,
scoring logic, and provisioning steps — plugged into the CTF-in-a-box
platform (event config, sync/scorer pipeline, `ctf-setup`, leaderboard). v1
ships exactly one module, `secure-development` (the DEF CON 34
patch-the-vulnerability format: fork target app, find + patch the vuln, PR
back, GitHub Actions scores the patch). This document is the contract a new
module (forensics, api-security, cloud, …) must satisfy to plug in, with
`secure-development` as the worked example throughout.

The platform sections of `event.yaml` (`event`, `github`, `teams`, `hints`,
`admins`) are shared. Everything module-specific — target list, challenge
catalogue, scoring transport — lives under `modules.<name>`.

## 1. Module identity & config block

1. MUST live under a kebab-case key in `event.yaml`'s top-level `modules:`
   map — one config block per module. Example, `secure-development`'s block
   (`event.yaml.example`):

   ```yaml
   modules:
     secure-development:
       targets: [juice-shop, dvwa]    # any subset of the six
       score_ingest: poll             # poll | push
   ```

2. MUST NOT expect dynamic/plugin-style registration in v1. The config
   loader (`sync/src/config.js`) enumerates known module keys explicitly and
   throws on anything else:

   ```js
   const unknown = Object.keys(modules).filter((k) => k !== "secure-development");
   if (unknown.length) throw new Error(`event.yaml: unknown module: ${unknown.join(", ")} (v1 supports only secure-development)`);
   ```

   An organizer who writes `modules.forensics: {...}` today gets a loud
   startup failure (`sync/test/config.test.js`, "rejects unknown module
   key"), not a silently ignored block. Adding a module means extending this
   loader (and the equivalent parsing in `setup/ctf-setup.sh`'s
   `yaml_targets`) to recognize the new key and validate its shape — the
   same way `secure-development`'s block requires a non-empty `targets`
   array drawn from a known target enum (`TARGETS` in `config.js`).
   Registration is deliberate, not dynamic; this is a v1 constraint, not a
   permanent architectural stance.

3. A module's config block is free to define its own shape beyond
   `targets`. Note that in v1 `score_ingest` is documentation-of-intent
   inside `event.yaml` — the config loader does not read it. The actual
   poll/push switch is the separate `SCORE_INGEST` env var consumed by
   `docker-compose.yml` and the Caddy profile. A module MUST keep any such
   config-file fields and the runtime env vars that actually implement them
   in sync until the loader is extended to read them.

## 2. Scoring ingestion contract (the hard boundary)

1. MUST submit every score through the single writer: `POST /score` on the
   local scorer. `sync/src/submit.js` is the only write path this repo
   implements — both the poll pipeline (`sync`) and push-mode
   (`score-action` POSTing directly) land on the same endpoint; there is no
   second write path. A module MUST NOT invent one.

2. Payload MUST be `{author, target, solved: string[], pr: number, sha:
   string}`, delivered as a bearer-authenticated JSON POST, and a success
   response is `202`:

   ```js
   // sync/src/submit.js
   const res = await fetchImpl(`${cfg.scorerUrl}/score`, {
     method: "POST",
     headers: { authorization: `Bearer ${cfg.scorerToken}`, "content-type": "application/json" },
     body: JSON.stringify(payload),
   });
   ```

   (`sync/test/submit.test.js`: "POSTs payload with bearer token, true on
   202".)

3. `author` MUST match the GitHub-login grammar before it is ever sent,
   because it becomes a datastore key on the scorer side:

   ```
   /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}(?:\[bot\])?$/
   ```

   (`sync/src/parse.js`, `GITHUB_LOGIN` — the comment there is explicit:
   "Same grammar the scorer enforces — author becomes a Redis key segment
   there.") A module's scoring path MUST validate any author string against
   this grammar before it reaches `POST /score`; never pass through an
   unvalidated string from PR/comment metadata.

4. Writes MUST be treated as monotonic/idempotent on the receiving end —
   modules MAY deliver at-least-once. `sync`'s own poller relies on this:
   on a submit failure it un-marks the comment as seen and retries on the
   next tick (`sync/src/index.js`, `tick()`: `rs.seen = rs.seen.filter((id)
   => id !== c.id); // retry next tick`), and replays of an already-applied
   score are expected to be no-ops on the scorer side, not double-counts.

## 3. Score transport options

1. **Push**: the scoring workflow POSTs directly to `${scorerUrl}/score`
   with a bearer token. Caddy only exposes the `/score` route externally
   when running in push mode — compare `caddy/Caddyfile.push` (has a
   `handle /score { reverse_proxy scorer:4000 }` block) against
   `caddy/Caddyfile.poll` (no `/score` route at all, `/score` has zero
   inbound network surface).

2. **Poll**: the workflow embeds a machine-readable HTML-comment block in
   its PR comment, `<!-- ctf-score: {...} -->` (`sync/src/parse.js`,
   `MARKER`), authored by the trusted workflow identity
   (`github-actions[bot]` — `cfg.commentAuthor`, default in
   `sync/src/config.js`). The poller filters comments by author **before**
   parsing the JSON block:

   ```js
   // sync/src/github.js
   comments: all.filter((c) => c.user?.login === cfg.commentAuthor),
   ```

   `scripts/smoke.sh` proves the trust filter: a forged comment authored by
   `mallory` carrying a valid `ctf-score` block is fetched but never
   scored, because it's dropped by the author filter, not by JSON parsing.
   A module using poll transport MUST post its score comment from the
   org-repo workflow context (e.g. a `pull_request_target` Action running
   as `github-actions[bot]`), never from a user-controlled identity —
   trust here is entirely the GitHub-authenticated comment author, not
   anything in the payload.

3. A new transport (e.g. a webhook relay, a different trust anchor) is a
   new `sync` adapter, not a config toggle. Propose it via an issue first;
   it changes the trust model, not just wiring.

## 4. Leaderboard mapping

1. The scorer exposes `GET /leaderboard`; the local test fixture
   (`test/fixtures/mock-scorer.mjs`) returns `{leaderboard: [{author,
   points, solved}]}` computed as one point per solved challenge ID — a
   simplified stand-in for smoke-testing, not the real scoring/pricing
   logic (that lives in the private `dc34-owasp-secure-development-ctf`
   scorer image). The real scorer's leaderboard entries carry, per author,
   points plus a per-target solved/total breakdown.

2. A module MUST define its own challenge catalogue: a fixed set of target
   keys (`secure-development`'s is the `TARGETS` enum in
   `sync/src/config.js` — `juice-shop`, `dvwa`, `webgoat`,
   `securityshepherd`, `vulnerableapp`, `vampi`) and, per target, a stable
   set of challenge IDs with known totals, so the leaderboard can render
   "solved / total" and unsolved counts read as remaining work, not as
   absent data. `secure-development`'s challenge IDs (e.g. `sqli-low`,
   `exec-low`, `restfulXss` — see the fixture score comments in
   `test/fixtures/mock-github.mjs`) are opaque strings scoped per target;
   the module owns their meaning.

3. Challenge IDs are stable keys once published — renaming one breaks
   provenance (a contestant's recorded solve no longer maps to any current
   challenge). Treat catalogue IDs like a public API: add, don't rename.

## 5. Security requirements (non-negotiable)

1. Contestant code MUST run only inside sandboxed containers on an internal
   Docker network — never on the host, never with any token access. This
   is the `pull_request_target` pattern `secure-development` uses: the
   scoring workflow runs in the base (org) repo's context, where the org
   `GITHUB_TOKEN` (needed to pull the private scorer image and read org
   secrets) lives, while the untrusted PR code under test executes in a
   sandboxed container on an internal Docker network with no access to
   that token — the isolation pattern documented in the consumer docs of
   `OWASP-CTF/dc34-owasp-secure-development-ctf`, the same
   `pull_request_target.yml` workflow `setup/ctf-setup.sh`'s `cmd_org`
   fetches and installs into each forked target repo. A module MUST
   reproduce this isolation for its own scoring workflow, not just inherit
   it by accident.

2. **Oracle discipline**: contestant-visible output (PR comment, push/poll
   payload) MUST be pass/fail plus points only — never failing-test names,
   assertion messages, or exploit payloads. Verbose diagnostics stay in the
   private workflow log, visible to org admins only. This is the cheapest
   real defense of the scorer image's secrecy; an information-rich comment
   is a worse oracle leak than someone reverse-engineering the image
   itself.

3. Scoring re-runs per submission MUST be rate-capped (e.g. N re-scores per
   PR per hour), so a contestant cannot brute-force the scorer's judgment
   with rapid speculative pushes. (Upstream dependency for
   `secure-development`: `score-action` doesn't yet enforce this — see
   `README.md`'s "Status / upstream dependencies" — but any new module's
   scoring workflow MUST ship its own cap regardless of what
   `secure-development` currently has landed.)

4. **Stock-scores-zero invariant**: an unpatched, stock copy of a target
   MUST score 0. A module MUST ship a guard (a test or CI check) that
   proves this — feeding the scorer an unmodified target and asserting the
   result is zero points — so a rubric bug can never hand out free points
   for doing nothing.

## 6. Provisioning & lifecycle hooks

`ctf-setup.sh` implements `secure-development`'s provisioning today
(`setup/ctf-setup.sh`, `cmd_org` / `cmd_teardown`):

1. **Fork** each configured target from `OWASP-CTF/<repo>` into the event
   org (`gh repo fork "OWASP-CTF/$r" --org "$org"`).
2. **Install** the scoring workflow: fetch the consumer's
   `pull_request_target.yml` from the `dc34-owasp-secure-development-ctf`
   docs and commit it as `.github/workflows/ctf-score.yml` in each forked
   repo (inherited workflows must be disabled in repo Settings).
3. **Mirror** the scorer image into the event org's own private GHCR
   (`docker pull` the upstream image, `docker tag`/`docker push` to
   `ghcr.io/$org/score:latest`) so forked repos' Actions can pull it with
   their own `GITHUB_TOKEN` rather than organizer credentials.
4. **Teardown**: `gh repo archive "$org/$r" --yes` for every target repo,
   plus a manual reminder to revoke the organizer PAT and delete org
   Actions secrets — `ctf-setup.sh` does not do this automatically.

A new module MUST document its own equivalent of steps 1–4: what it forks
or provisions per event, what workflow/credentials it installs, and what
must be archived or revoked in teardown. The requirement that matters more
than the specific mechanism: **everything a module provisions for an event
MUST be archivable or revocable after the event** — nothing should persist
or keep working once the event org is torn down. `secure-development`
satisfies this because every provisioned artifact (forked repo, mirrored
image, installed workflow) lives entirely inside the disposable per-event
org.

## 7. Versioning

Targets MUST be pinned to exact versions/digests — never `:latest`.
`secure-development` inherits this from its upstream: the event org's fork
of each target is "pinned to the canonical vulnerable version" (the
upstream `OWASP-CTF/<target>` repo already sits at a known-vulnerable
commit; `gh repo fork` copies that state as-is, so the fork "inherits the
correct pinned vulnerable version" rather than tracking upstream `HEAD`).

The reason this is load-bearing, not cosmetic: the scoring rubric is
regression tests written against a specific vulnerable version. If a
target silently moved to `:latest` or rebased onto a newer upstream commit,
an unrelated upstream fix could patch a vulnerability the rubric still
expects to be exploitable — deflating every contestant's score on that
challenge to zero regardless of their actual patch — or, in the other
direction, an upstream regression could reintroduce a vuln the rubric
already assumes is gone, inflating scores for a patch nobody wrote. Pinning
the target version is what keeps "score reflects patch quality" true. A new
module MUST pin its targets the same way and MUST NOT configure any target
or scoring dependency (image, base repo, library) to float on `:latest` or
an unpinned branch.

(Note: the *scorer* image itself is currently referenced as
`ghcr.io/owasp-ctf/score:latest` in `docker-compose.yml`/`.env` — that is a
platform-level convenience for v1, not a module-authored target, and is a
separate concern from target version pinning above.)
