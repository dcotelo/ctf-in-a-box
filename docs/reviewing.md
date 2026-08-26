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
[CONTRIBUTING](../CONTRIBUTING.md) and `AGENTS.md`'s CodeRabbit gate).

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
in `classic-store.ts`, `GRADE_SCRIPT` in `quiz-store.ts`) decide points;
the JS pre-checks are advisory early-outs. Review implications: moving an
already-solved guard, attempt cap, cooldown check, or price read out of the
script into JS is a correctness regression, not a refactor. A change to
script text needs tests that pin the *semantics* (the `HEXISTS … == 1`
polarity, the `>=` cap comparison, which key each counter is keyed by), not
just command ordering. And never case-fold inside Lua — `string.lower` is
ASCII-only and diverges from the JS normalizer, producing challenges nobody
can solve. Normalization is JS-only, applied identically on authoring and
submission.

**3. Fail direction is a per-gate decision, not a default.** The direction
each gate takes on a storage error is chosen, documented, and tested — a
diff that flips one silently is a bug even when it looks like hardening:

| Gate | Direction on error | Why |
|---|---|---|
| Freeze / scoring-window reads (app, scorer, sync) | **OPEN** | a Redis blip must not drop live submissions (ADR 32) |
| Grading lookups (does this challenge/question exist, what is its key) | **CLOSED** | don't grade what you can't verify |
| Admin allowlist reads (`requireAdmin`) | **CLOSED** | an unreachable datastore denies, never grants |
| Hint purchase (spend) | **CLOSED** | never charge on uncertainty |
| `ctf-setup.sh` `check_step` | **CLOSED** | a `gh` error is never "already satisfied" |
| Audit-log writes | **best-effort** | an audit failure is logged, never fails the request that already committed |

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
  logs). CodeRabbit review is a required merge gate; the workflow rules —
  wait for the re-review after every push, resolve every actionable thread,
  decline on the record — are in `AGENTS.md` and
  [CONTRIBUTING](../CONTRIBUTING.md).
- CI (`.github/workflows/ci.yml`) — the per-area jobs, the vacuous-sweep
  gate, and the acceptance scripts, which are the strongest anti-vacuous
  layer in the repo.
- This page — the reader-facing rationale. Keep the three in lockstep.
