---
title: Module contract
---

# Module contract

A **module** is a CTF vertical — a family of challenges with its own targets,
scoring logic, and provisioning steps — plugged into the CTF-in-a-box
platform (event config, sync/scorer pipeline, `ctf-setup`, leaderboard). v1
ships exactly one module, `secure-development` (the OWASP Secure Development
CTF patch-the-vulnerability format: fork target app, find + patch the vuln, PR
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
   logic (that lives in the private upstream scorer image). The real scorer's leaderboard entries carry, per author,
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

## 5. UI / presentation contract

**Honesty constraint up front:** the vendored contestant app (`apps/web/`,
see `apps/web/VENDORED.md`) now implements display metadata (item 1) and
the enablement rule (item 4) for `secure-development`: `src/lib/modules.ts`
sources the display name/description from a module registry rather than a
hardcoded string, and `src/lib/apps.ts`'s `enabledApps` filters nav,
challenge list, and leaderboard columns down to the targets under
`event.yaml`'s `modules.secure-development.targets` — see
`src/lib/__tests__/modules.test.ts` and `scripts/acceptance-app.sh` (which
asserts a disabled target never renders). The existing challenge catalogue
(item 2) and per-target solved/total leaderboard columns (item 3) predate
this work and satisfy those items for the one shipped module. What remains
open is the organizer admin panel (score adjustments, player removal, hint
toggles) — `README.md`'s "Status / upstream dependencies" item 3 tracks it
as Spec B, not yet built — and offering this vendored delta back to
`OWASP-CTF/ctf-owasp-org` once upstream write access opens. This section
remains the contract a *new* module (forensics, api-security, cloud, …)
must satisfy to plug into the same UI, since v1 only proves it against the
one worked example.

1. **Display metadata.** A module MUST provide a human-readable display
   name, a short description, and a nav label, sourced from the module's
   own config/catalogue — never hardcoded into the app per module. Worked
   example: `secure-development` supplies "Secure Development" as its
   display name (not a string baked into `ctf-owasp-org`'s UI layer).

2. **Challenge catalogue for UI.** A module MUST expose, per challenge: id,
   title, target/app grouping, and point value — built on the same
   catalogue and the same stable challenge IDs required for scoring (item
   4.2 above). The UI reads challenge titles and groupings from this
   catalogue; it MUST NOT need a code change per challenge to render a new
   one. Renaming a challenge ID breaks its UI history exactly as it breaks
   scoring provenance (item 4.3) — one stability rule, not two.

3. **Leaderboard presentation.** A module MUST define its own progress
   semantics: what columns and progress indicators the leaderboard/app show
   for it. Worked example: `secure-development` shows a patched/total count
   per target (e.g. `dvwa: <solved>/<total>`) across its up-to-six
   configured targets, `<total>` coming from that target's per-challenge
   count in the catalogue (item 4.2) — a module with a different structure
   (e.g. no per-app grouping) MUST specify its own equivalent rather than
   forcing the patched/total shape.

4. **Enablement rule.** A module's UI surfaces (nav entry, challenge list,
   leaderboard columns) MUST appear if and only if the module's key is
   present under `event.yaml`'s `modules:` map — the same map the config
   loader validates (section 1). Nothing about a module absent from
   `modules:` may leak into nav, leaderboard, or challenge listings; an
   organizer who omits a module from their event config gets an app with no
   trace of it, not a greyed-out or hidden-but-present surface.

## 6. Security requirements (non-negotiable)

1. Contestant code MUST run only inside sandboxed containers on an internal
   Docker network — never on the host, never with any token access. This
   is the `pull_request_target` pattern `secure-development` uses: the
   scoring workflow runs in the base (org) repo's context, where the org
   `GITHUB_TOKEN` (needed to pull the private scorer image and read org
   secrets) lives, while the untrusted PR code under test executes in a
   sandboxed container on an internal Docker network with no access to
   that token — the isolation pattern the kit's own consumer workflow
   template (`scorer/consumer-workflow.example.yml`) implements, the same
   workflow `setup/ctf-setup.sh`'s `cmd_org` renders per target into
   `dist/workflows/` and prints manual install steps for into each forked
   target repo (§7.2 — installation itself is a manual
   step, not automated by `cmd_org`). A module MUST
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
   with rapid speculative pushes. (`secure-development`'s shipped consumer
   workflow, `scorer/consumer-workflow.example.yml`, enforces this itself
   with a per-PR `concurrency` group plus a `COOLDOWN_MINUTES` gate; the
   upstream `score-action` path still doesn't — see `README.md`'s "Status /
   upstream dependencies". Any new module's scoring workflow MUST ship its
   own cap regardless.)

4. **Stock-scores-zero invariant**: an unpatched, stock copy of a target
   MUST score 0. A module MUST ship a guard (a test or CI check) that
   proves this — feeding the scorer an unmodified target and asserting the
   result is zero points — so a rubric bug can never hand out free points
   for doing nothing.

   The invariant is enforced twice. `scripts/acceptance-scorer.sh` proves it
   offline against a synthetic stock app (fast, no network), and
   `scripts/acceptance-target.sh <target> <stock-image>` proves it against
   each real stock target in CI. A challenge that passes against the stock
   app is a free point for every contestant and fails the build.

## 7. Provisioning & lifecycle hooks

`ctf-setup.sh` implements `secure-development`'s provisioning today
(`setup/ctf-setup.sh`, `cmd_org` / `cmd_teardown`):

1. **Fork** each configured target from `OWASP-CTF/<repo>` into the event
   org (`gh repo fork "OWASP-CTF/$r" --org "$org"`).
2. **Render + print install steps** for the scoring workflow: `cmd_org`
   renders the in-repo template (`scorer/consumer-workflow.example.yml`)
   per target — substituting the event org, the target id, and a default
   `APP_URL` — into `dist/workflows/<target>.ctf-score.yml` (no upstream
   access; also available standalone as the `render` subcommand) and
   prints where the organizer must commit each file — as
   `.github/workflows/ctf-score.yml` in the matching forked repo, with
   inherited workflows disabled in repo Settings — but does not commit
   it itself; that step is manual.
3. **Mirror** the scorer image into the event org's own private GHCR
   (`docker pull` whatever `SCORE_IMAGE` names — the organizer's own
   image; there is no upstream default — then `docker tag`/`docker push`
   to `ghcr.io/$org/score:latest`) so forked repos' Actions can pull it
   with their own `GITHUB_TOKEN` rather than organizer credentials.
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

## 8. Versioning

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
separate concern from target version pinning above. The reference
implementation of the scorer contract lives in this repo at `scorer/` —
one image, serve + judge modes — and [docs/scorer.md](scorer.md) documents
authoring a rubric and building your own image against it.)
