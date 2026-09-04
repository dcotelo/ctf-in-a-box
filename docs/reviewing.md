---
title: Reviewing
---

# Reviewing changes

What a reviewer of this repo — human, CodeRabbit, or any other AI agent —
must verify before a PR merges, and just as importantly, what not to flag.
The machine-enforced subset lives in `.coderabbit.yaml` (path instructions +
pre-merge checks); this page is the authority that config encodes, written
for a reader. When a new invariant earns a place here, it lands in both
files in the same PR — a guideline the bot doesn't enforce, or a bot rule no
document explains, is how the two drift apart.

The house review method, in one paragraph: verify claims against the code,
not the diff description — cite `file:line`. A finding must name a concrete
failure scenario ("inputs/state → wrong output"), not a vibe. Prefer the
smallest fix that closes the failure. A reviewer finding you disagree with
is answered on the thread with the reason, never ignored — a reasoned
decline on the record is a valid outcome (see
[CONTRIBUTING](https://github.com/dcotelo/ctf-in-a-box/blob/main/CONTRIBUTING.md) and `AGENTS.md`'s CodeRabbit gate).

## Section 1. The invariants a review protects

These are the properties this repo has been burned by, ordered roughly by
blast radius. Each one names where it is enforced and what a violation
looks like in a diff.

**1. The contestant secrecy boundary.** A contestant-reachable path must
never obtain a quiz answer key (`ctf:quiz:key`), a classic flag
(`ctf:classic:flag`, `ctf:classic:flagnorm`), or unpurchased hint text
(`ctf:classic:hints`). The boundary is pinned independently at four layers —
store, route, view-model, markup — and the tests inject a fake secret and
assert it never renders. In a diff, the red flags are: a store function on
the contestant path issuing a command against a secret key; a route
serializing an admin-shaped object; a type change that lets `AdminQuestion`/
`AdminChallenge` flow where `Question`/`Challenge` is expected. Anything
that weakens one layer "because another layer still catches it" is a
finding — the four layers are deliberate redundancy.

**2. Lua is the scoring authority.** The grading scripts (`SUBMIT_SCRIPT`
in `classic-store.ts`, `GRADE_SCRIPT` in `quiz-store.ts`, `AWARD_SCRIPT` in
`ai-store.ts`) decide points; the JS pre-checks are advisory early-outs.
Review implications: moving an already-solved guard, attempt cap, cooldown
check, or price read out of the script into JS is a correctness regression,
not a refactor. A change to script text needs tests that pin the *semantics*
(the `HEXISTS … == 1` polarity, the `>=` cap comparison, which key each
counter is keyed by), not just command ordering — those live in
`src/lib/__tests__/*.lua.upstash.test.ts`, which execute the real scripts
against a real Redis in CI; a script change with no change there is the
finding. And never case-fold inside Lua — `string.lower` is
ASCII-only and diverges from the JS normalizer, producing challenges nobody
can solve. Normalization is JS-only, applied identically on authoring and
submission.

**3. Fail direction is a per-gate decision, not a default.** The direction
each gate takes on a storage error is chosen, documented, and tested — a
diff that flips one silently is a bug even when it looks like hardening:

Every row carries its anchors so the claim is checkable against the code —
a row whose direction cannot be traced to an implementation and a test is a
row to distrust. The rows still missing a test anchor are tracked in
[issue #232](https://github.com/dcotelo/ctf-in-a-box/issues/232).

| Gate | Direction on error | Why | Implemented · tested |
|---|---|---|---|
| Freeze / scoring-window reads (app, scorer, sync) | **OPEN** | a Redis blip must not drop live submissions (ADR 32) | `classic-store.ts` + `quiz-store.ts` gate reads · `classic-store.grade.test.ts` / `quiz-store.grade.test.ts` fail-OPEN pins; `sync/src/redis.js` (comments its direction); `scorer/src/store.js` `isPaused` (direction right, silent — #232) |
| Grading lookups (does this challenge/question exist, what is its key) | **CLOSED** | don't grade what you can't verify | `classic-store.ts` `submitFlag` / `quiz-store.ts` `answerQuestion` lookup paths · error paths exercised in the grade test files |
| Admin allowlist reads (`requireAdmin`) | **CLOSED** | an unreachable datastore denies, never grants | `admin-auth.ts` (the fail-closed branch is commented) · `admin-auth.test.ts` |
| Hint purchase (spend) | **CLOSED** | never charge on uncertainty | `hint-store.ts` `revealHint` · direction untested — #232 |
| Team registration window read | **undecided** | no stated direction today; behavior differs by error shape | `team-store.ts` `isRegistrationClosed` · needs a decision + test — #232 |
| `ctf-setup.sh` `check_step` | **CLOSED** | a `gh` error is never "already satisfied" | `setup/ctf-setup.sh` `check_step` · `setup/test/ctf_setup.bats` ("fails closed when gh api errors") |
| Audit-log writes | **best-effort** | an audit failure is logged, never fails the request that already committed | `writeAudit` in each `api/admin/*` route · route tests assert success without a completed audit write |

**4. Tests must be able to fail.** The recurring failure mode in this repo
is the vacuous pass: an assertion satisfiable whether or not the code under
test works. Concrete shapes to reject in review: a leak test that scans for
tokens never seeded through any source the code reads; a regex assertion
satisfied by static page copy; a bats `[[ ]]` or `! … | grep` mid-test
(non-gating — the decisive check must be the test's *last* statement, in a
form that exits nonzero); an exploit test that "passes" because the target
was never up (the vacuous-zero gate exists for exactly this). When a test
accompanies a fix, ask: what single-token mutation of the fix would this
test miss?

**5. The score-comment trust chain.** The `<!-- ctf-score: {json} -->`
marker is trust-authoritative: sync ingests it as real points. It must only
ever come from the judge's own output (`CTF_OUT_DIR`, outside the PR
checkout), posted only when the scorer step succeeded. Never post
checkout-derived content as the bot; never gate the final-comment step on
`if: always()` without an outcome check. Either reopens the score-forge.

**6. Three-reader lockstep.** `effectivePaused`/`outsideWindow` is
implemented independently in `apps/web/src/lib/schedule-window.ts`,
`scorer/src/store.js`, and `sync/src/redis.js` (registration windows in
`team-store.ts`). They read the same `ctf:admin:settings` fields and must
agree — a diff touching one reader touches all three or explains why not.
Don't DRY them into a shared package (ADR 32: three separately-deployed
services); the right agreement mechanism is a shared test corpus.

**7. Allowlist, never sweep.** Anything that serializes state for export —
the event archive bundle, settings pickers, log lines — enumerates known
fields, so a future key is excluded by default rather than leaked by
default. In a diff: a `SCAN ctf:*`, an object spread where a field list
should be, or a "drop these fields" denylist are all findings. Corollary
for CodeRabbit's own config: every `path_filters` entry stays negated — a
single bare pattern flips the whole filter into an allowlist and silently
skips review of everything else (this happened; see the comment in
`.coderabbit.yaml`).

**8. Destructive paths validate first, then destroy.** Replace-all import,
master reset, force-disband: the guard (live check, confirmation, payload
validation) runs before anything is wiped, so a bad input fails with
nothing destroyed. A diff that moves validation after a destructive step —
or adds a destructive step before the existing guard — is a P1 finding. UI
side: a destructive control needs an explicit confirmation gating the
network call, and the test proves the call cannot fire without it.

**9. Presence is not discoverability.** A shipped feature needs a visible
entry point, and its test asserts the link/nav/button exists — not merely
that the route responds. This repo has shipped invisible-but-working
features past green tests three times.

**10. The build-time config bake.** The app bakes `event.yaml` at build via
`EVENT_CONFIG_B64`; building without it silently yields neutral defaults
(empty `admins`, generic branding). Review anything touching build or
deploy scripts for a path that could run the app build with the arg unset.

**11. The public surface is a named list, not a shape.** Exactly five routes
under `/api` answer without a session or a verified launch token, and each is
on the list for its own stated reason — a sixth does not inherit an exemption
by resembling one that has it; it needs its own case. Three are read-only,
policy out and never facts in, nothing secret in the response: `GET
/api/public/scoring`, `GET /api/ai/launch-key` and `GET /api/board/items`.
Two are POSTs that exist *before* identity: `POST /api/gate` (the pre-event
password check — it runs before anyone can sign in, charges a per-IP attempt
before comparing, and answers only pass/fail) and `POST /api/stats/visit`
(the approximate, no-PII per-country reach counter, always `204`, whose own
header comment documents that it is not a security boundary). `/api/auth/*`
is better-auth's and is outside this list. Anything else under `/api` that
answers without `getSession`, `requireAdmin` or a verified launch token is
the finding. `board/items` (from the #207 redesign) serves the public leaderboard's
row expansion: who solved what is already on the board as counts, the items
are built only from the contestant-safe listers (ids, labels, banked points —
never a flag, hint, or key), and the login list is capped at a team roster's
size so it reads like the board, not like a scrape. `launch-key`
is the sharpest test of the "nothing secret" half: it exists to publish the
launch token's public key, `kid`, and algorithm so an external integrator can
verify a token without holding a credential, and the finding to watch for is
the private half (or any per-challenge signing key) drifting into that same
payload — the ai contract test's import ban is what makes that a compile-time
impossibility rather than a promise.

**12. `requireAdmin` gates per-contestant data by default; self-service reads
are the one carve-out, and it's narrow.** A route returning points,
attempts, hint spend, team membership, answer keys, flags, or metrics needs
`requireAdmin` unless it reads *only* the row belonging to the caller who is
asking — and "the caller" has to be established cryptographically, not
trusted from the request: a verified launch token's `sub`, or a session
login, never a client-supplied id, header, or query parameter standing in
for one. `GET /api/ai/state` is the shape that qualifies — it derives its
subject from a signature-verified token (`verifyLaunchToken(...).claims.sub`)
before it reads anything. A route that reads "my own row" by trusting an
unverified field isn't self-service; it's the admin gate with the identity
check removed, and it still needs `requireAdmin` or a real bound identity to
pass review.

**13. A `catch` logs a label, never the caught object.** The grading paths
call `upstashEval` with the submitted flag or answer — and, for classic,
the stored flag's comparison form — as ARGV, so a driver that decorates
its rejection with the request it failed on (`command`, `body`, `cause`)
turns one `console.error("…", err)` into the event's flags in a log the
organizer may already have shipped somewhere. No error shape reachable today
carries them; the invariant is that nothing prevents a future one from doing
so, and logs cannot be un-shipped. The three stores hand the logger
`errorLabel(err)` from `apps/web/src/lib/error-label.ts` — name and message,
capped, no stack, no own properties, `"non-Error throw"` for anything that
is not an `Error` — and nothing else. In a diff, the red flag is a raw `err`
(or `String(err)`, or `JSON.stringify(err)`) as a `console.*` argument in
`apps/web/src/lib/*-store.ts`. The tests reject with an `Error` carrying a
planted flag in `command`/`cause` and assert two things: the flag appears in
no logged argument, AND no logged argument is `instanceof Error` — the
second is load-bearing, since `JSON.stringify(new Error("x"))` is `"{}"`
and the first check alone passes against the unfixed code (#241, #244).

## Section 2. What not to flag

Deliberate decisions, each with the ADR that settled it. Re-raising one
without new evidence is noise; a reviewer who disagrees argues against the
ADR, not the code.

- **No testing-library.** The pattern is `renderToStaticMarkup` for markup
  plus exported pure helpers for client state; the four-layer secrecy pins
  prove it reaches every layer that matters.
- **The hand-rolled markdown renderer stays** (ADR 28). React-element
  output makes injection structurally impossible; a library plus sanitizer
  reopens the `dangerouslySetInnerHTML` surface the ADR exists to close.
- **No attempt cap on classic flag submission** (ADR 29). The flag space is
  not enumerable; the organizer-tunable cooldown is the designed lever.
- **The two flag hashes and the Admin/contestant type split stay** (ADR
  27). The split is what makes "the contestant path never touches a flag"
  compiler-checked. Strengthen it; never collapse it.
- **The three `outsideWindow` copies stay separate** (ADR 32) — see
  invariant 6.
- **Freeze reads fail open on purpose** (ADR 32). "Fail closed for safety"
  inverts the decision; restoring fail-open where a gate accidentally
  inverted it is the fix, not the precedent.
- **Team hint-penalty is a SUM, not a union-dedupe** — hints are
  per-person purchases; the asymmetry with `foldTeamItems` is documented
  and pinned by test.
- **Test scaffolding is exempt from digest-pinning** (ADR 51). Flag
  *inconsistency* between scripts, not the exemption.
- **Actions tag-vs-SHA pinning is already deliberated** (ADR 37, tracked in
  its issue; Dependabot's github-actions ecosystem is the compensating
  control).
- **No `jq`/`python` on the provisioning path** — the bash-3.2 constraint
  is a hard rule, so a "cleaner" rewrite that introduces them is a
  regression.
- **The activity log filters client-side** over its capped row count by
  design — don't request a server-side filter/pagination contract.
- **The event import is not atomic** across reset and content replacement,
  matching the master reset it composes; it is bounded (admin-only,
  refused while live, double-confirmed) and recoverable by re-running.
  Documented in
  [operations.md's archive section](operations.md#archiving-and-replaying-an-event).

## Section 3. Where the enforcement lives

- `.coderabbit.yaml` — path-scoped instructions carrying the invariants
  above to the file level, and the pre-merge checks (secrecy boundary,
  fail-direction, unpinned dependencies, breaking-change docs, secrets in
  logs). Three of the five — secrecy boundary, unpinned dependencies,
  breaking-change docs — run at `mode: error` with the request-changes
  workflow on, so a violation blocks rather than warns; the other two stay
  warnings. CodeRabbit review is a required merge gate; the workflow rules —
  wait for the re-review after every push, resolve every actionable thread,
  decline on the record — are in `AGENTS.md` and
  [CONTRIBUTING](https://github.com/dcotelo/ctf-in-a-box/blob/main/CONTRIBUTING.md).
- CI (`.github/workflows/ci.yml`) — the per-area jobs, the vacuous-sweep
  gate, and the acceptance scripts, which are the strongest anti-vacuous
  layer in the repo.
- This page — the reader-facing rationale. Keep the three in lockstep: a
  `.coderabbit.yaml` path instruction covers this page and the config as a
  pair, so a PR changing one side's rules without the other draws a warning
  rather than relying on memory.
