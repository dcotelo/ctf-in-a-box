# REVIEW — test quality & code quality audit

Audited 2026-08-25 against main @ `82e5989`. Method: eight parallel deep-read passes
(test/CI inventory, secrecy boundaries + gate fail-directions, atomicity/normalization,
sync trust chain, leaderboard composition + time, bash/bats/acceptance, code quality/
security posture, docs-vs-code drift). Every claim cites file:line; mutation verdicts
in the sync and leaderboard sections were run empirically (mutant applied, suite run,
reverted — tree verified clean); the apps/web store mutations were determined statically
against the exact assertions cited. ADRs 1–52 read first; nothing below re-reports a
documented decision.

---

## Verdict

The disciplined parts of this codebase are genuinely excellent: the quiz/classic secrecy
boundary is pinned independently at all four layers (store, route, view-model, markup)
with deliberate leak-injection tests; the markdown renderer withstood a full XSS battery
on paper; no mutating route trusts a body-supplied identity; SCAN everywhere, folds
batched, no N+1 on hot paths; the acceptance scripts are aggressively anti-vacuous.

The weakness has one shape, repeated: **the layer each subsystem declares authoritative
is the layer its tests never execute.** The grading Lua scripts — the declared "sole
authority" for points — are never run by any test (only text-ordering pins), which is
the exact blind spot that shipped #194. The bats suite's mid-test `[[ ]]` assertions
don't gate (confirmed empirically on bats 1.14), so `ctf-setup.sh`'s headline promise —
idempotent provisioning — has zero enforced coverage. Sync's dedicated un-mark-on-failure
test is vacuous (`seen.includes(1)` can never be true).

The single most likely live-event bite: **a Redis blip during the event 500s every quiz
submission** — quiz's settings read fails closed while classic's deliberately fails open,
inverting ADR 32, with no test either way (Finding 1).

---

## Top 10 findings

Ordered by impact × likelihood ÷ effort.

### 1. [bug][drift] P1 — Quiz freeze read fails CLOSED; ADR 32 and classic say OPEN
**Where:** `apps/web/src/lib/quiz-store.ts:719,867` (uncaught `getAdminSettings()`),
`apps/web/src/app/api/quiz/answer/route.ts:77` (no try/catch).
**Why it matters:** ADR 32: "Freeze reads fail OPEN … a Redis blip during an event must
not silently discard real submissions." Classic implements exactly that
(`classic-store.ts:952-960`, pinned by `classic-store.grade.test.ts:262`). Quiz throws
→ 500 → the submission is dropped. No comment claims the divergence is intentional.
**How it fails:** srh restarts for 3 seconds mid-event; every quiz answer in that window
errors out with a 500 the contestant reads as "the platform broke."
**Smallest fix:** mirror classic — catch the settings read, pass `settings | null` into
`evaluateGate`, fall back to baked `QUIZ_MAX_ATTEMPTS`/`QUIZ_RETRY_AFTER_MIN`. Test in
"Tests I would write" §1.

### 2. [test-gap] P1 — The grading Lua scripts are never executed by any test
**Where:** `SUBMIT_SCRIPT` (`classic-store.ts:850-920`), `GRADE_SCRIPT`
(`quiz-store.ts:780-810`). Tests mock `upstashEval` and pin only `indexOf` ordering of
command names (`classic-store.grade.test.ts:323-360`).
**Why it matters:** these two scripts decide points, and the design names them the sole
authority precisely because the JS pre-check is advisory. Mutations that survive the
entire suite: invert the `HEXISTS == 1` already-solved polarity, cap `>=` → `>` (one free
attempt per question), drop `and lastAtMs` (crashes every first-ever submission), key
`solvecount` by login instead of challenge. This is the #194/#196 failure mode — grading
diverging from everything the tests can see — pointed the other way.
**How it fails:** a refactor "cleans up" the Lua, all 2259 tests stay green, the event
runs with a broken cap or a 500-on-first-submit.
**Smallest fix:** two parts. (a) Now, zero infra: semantic-substring pins (§2 below).
(b) `classic-store.upstash.test.ts`/`quiz-store.upstash.test.ts` cloning the existing
`hint-store.upstash.test.ts` skipIf harness, plus an SRH+redis service container in the
CI app job so all five `.upstash` suites stop silently skipping (today CI has zero
`UPSTASH_*` env — the three existing live-Lua suites never run in CI either).

### 3. [test-gap] P1 — bats mid-test `[[ ]]` assertions do not gate; ~6 tests' primary assertions are inert
**Where:** `setup/test/ctf_setup.bats:32-35,60-61,138-139,212-213`,
`setup/test/entrypoints.bats:131-132,180-181` (+12 partially affected).
**Why it matters:** empirically confirmed on bats 1.14.0: a standalone `[[ 1 == 2 ]]`
mid-test passes silently (`[ … ]` and `grep -q` fail correctly). This is the exact trap
AGENTS.md documents — and it is live in the suite that documents it. Delete the
SCORE_IMAGE-honoring logic or the decoy-target filter and those tests still pass.
**Smallest fix:** mechanical rewrite: `[[ "$output" == *X* ]]` → `echo "$output" | grep -qF "X"`;
`[[ "$output" != *X* ]]` → `[ -z "$(echo "$output" | grep -F "X")" ]`. Both proven decisive.

### 4. [test-gap] P1 — Vacuous assertion guards sync's un-mark-on-failure retry
**Where:** `sync/test/tick.test.js:63-69` — `assert.equal(state.repos.DVWA.seen.includes(1), false)`.
`seen` holds revision-key *strings* (`"1@2026-08-13T11:00:00Z"`); `.includes(1)` (number)
is false whether or not the un-mark ran. Proven by mutation: deleting the un-mark line
leaves this test green; only one batch test elsewhere catches it.
**Why it matters:** the un-mark is the at-least-once delivery guarantee — the thing that
stops a scorer 5xx from permanently eating a score. Its dedicated test proves nothing;
detection hangs on a single unrelated batch test.
**Smallest fix:** `assert.deepEqual(state.repos.DVWA.seen, [])`. §5 below.

### 5. [test-gap] P1 — CI `changes` filter misses four cross-area edges
**Where:** `.github/workflows/ci.yml:44-94`.
- `scorer/consumer-workflow.example.yml` → `shell` (ci.yml:66): the bats suite pins that
  file's security posture (`allow-unsafe-pr-checkout`, `persist-credentials: false`,
  workflow version — `ctf_setup.bats:1047,1184-1242`). A PR "hardening" the template by
  deleting the opt-in skips exactly the suite that guards it.
- `docker-compose.yml` → `shell` (fly.bats renders and asserts on the real compose file,
  `deploy/fly/test/fly.bats:154-170`).
- `test/fixtures/` → `smoke` (docker-compose.smoke.yml builds both mock services from it;
  no pattern matches `^test/`).
- `sync/src/parse.js` → `scorer` (acceptance-scorer.sh:168-182 imports the real parser as
  the one live cross-check of the marker/grammar contract; sync-only PRs skip it).
**How it fails:** each lands broken on a green PR, caught only by main's post-merge full
run (or, for stock/patched paths, not at all — see finding 22).
**Smallest fix:** four regex additions to ci.yml:54,66,79.

### 6. [test-gap] P1 — `ctf-setup.sh org` apply/idempotency path is 100% untested
**Where:** `setup/ctf-setup.sh:280` (`apply_step`), `:334-339` (the "already done"
idempotent-skip branch), `:998` (`mirror_image` pull/tag/push), `:76` (`wait_for_repo`).
Every `org` test in the suite passes `--dry-run`.
**Why it matters:** "idempotent — re-run safe" is the script's headline documented
property (`:15-17,1100`) and the thing an organizer leans on when provisioning fails
halfway. Zero tests. The path is stub-testable (verified) — see §8 below.
**Smallest fix:** two bats tests: all-satisfied org applies nothing; fork-absent org
attempts `gh repo fork`.

### 7. [test-gap] P1 — Activity-log `detail` unpinned at the two call sites that handle secrets
**Where:** `apps/web/src/app/api/classic/submit/route.ts:84`,
`app/api/quiz/answer/route.ts:84`. Neither route test mocks `@/lib/activity-log`
(`classic/submit/__tests__/route.test.ts:13-27`), so nothing asserts detail is the id,
that the flag never rides along, or that `already`/wrong submissions don't log. Mutation
"log the flag instead of the challengeId" survives the suite. Team-store shows the house
style done right (`team-store.test.ts:999-1048`, exact-args pins).
**How it fails:** a refactor passes the wrong variable and contestant flags land in a log
the admin tab screen-shares at events.
**Smallest fix:** §3 below.

### 8. [test-gap][drift] P1 — Leaderboard pipeline order: wrong test oracle, stale comments, three uncovered callsites
**Where:** the shipped order is contributions → team standings → **penalties last**
(`app/(site)/leaderboard/page.tsx:64`). But:
- `profile/__tests__/page.test.tsx:139` composes the **old** order
  (`withModuleContributions(await withHintPenalties(data))`) as its oracle, with a
  fixture in the region where both orders coincide — it cannot catch profile drifting
  from the board on the floor edge (spend > scorer points, the exact bug #210 fixed).
- Three comments still describe the pre-#210 order beside the corrected code:
  `leaderboard/page.tsx:52-62`, `components/team-progress.tsx:8-9`, `profile/page.tsx:154-158`.
  `docs/modules.md:259-262` says it too ("runs after `withHintPenalties`").
- No test imports any of the three page callsites; `pipeline.test.ts:67-68` re-declares
  the order privately, so swapping one `.then()` chain fails nothing.
**Smallest fix:** export `composeLeaderboard()` next to the stages, use it at all three
callsites, point pipeline.test at it; fix the oracle + comments + modules.md. §6 below.

### 9. [drift] P1 — Docs describe shipped features as unlanded/absent (one rot family, eight spots)
**Where/what:**
- `docs/operations.md:1064-1074` (+ `docs/index.md:229-231`, `docs/architecture.md:135-138,945-950`,
  ADRs 3/6 at `decisions.md:69-73,139-142`): scoring "depends on unlanded upstream" bearer
  auth and score-action inputs — both shipped in-kit (`scorer/src/serve.js:34-52,345`,
  `consumer-workflow.example.yml:1,333-334`). operations.md:1004 contradicts itself.
- `docs/operations.md:950-954`: "classic has no hint system … planned" — shipped
  (`classic-keys.ts:37`, `hint-store.ts:85`); the other two docs know it.
- `docs/architecture.md:623-624` + `docs/modules.md:472-475`: module enablement
  "build-time only" — runtime since ADR 52 (`resolved-modules.ts:53`).
- `docs/hosting.md:512-513,602-604`: tells organizers to put `teams:`/`hints:` in
  event.yaml — those keys are unread and warn at build (`generate-event-config.mjs:126-128`).
**Why it matters:** an organizer following hosting.md configures teams in a file that
ignores them, then hunts a phantom upstream dependency when scoring "isn't ready."
A confidently wrong doc here costs real setup hours.
**Smallest fix:** one docs PR for the family (fix order in the drift section below).

### 10. [test-gap] P1 — `importBundle` can silently break case-sensitive backups
**Where:** `classic-store.ts:520` calls `flagComparisonForm(flag, caseSensitive)`
(correct today), but `classic-store.test.ts:594-598` tests only the lowercase branch —
swapping the call to `normalizeFlag` survives the suite. The record keeps
`caseSensitive: true` while `flagnorm` is lowercased: the challenge becomes unsolvable
by anyone, restored from a backup, mid-event.
**Why it matters:** the export/import path is the disaster-recovery path; #194 already
proved this exact field is the one that slips (three of its four consumers dropped it).
**Smallest fix:** one import-path test asserting the case-intact write (§4 below).

---

## Invariant traceability matrix

Strength: **PINNED** (independent test per layer/property) / **PARTIAL** / **UNPINNED**.

| Invariant | Enforced at | Pinned by | Strength |
|---|---|---|---|
| `ctf:quiz:key` never on a contestant path (4 layers) | quiz-store.ts:219-229,495-504; routes; page view-model; board props | quiz-store.test.ts:37-54,433-448; api routes.test.ts:258,286,296,314; board items.test.ts:61-71; page-view-model.test.tsx:99-131; quiz-board.test.tsx:203-217 | **PINNED — all four layers independently**, incl. deliberate leak-injection at view-model and markup. The model the rest should match. |
| `ctf:classic:flag`/`flagnorm` never on a contestant path (4 layers) | classic-store.ts:244-249,647-656; SUBMIT_SCRIPT gets flagnorm only | classic-store.test.ts:172-180,445-455; submit route.test.ts:163; admin route.test.ts:117-133; flags page-view-model.test.tsx:99-134; board/challenge/page markup tests | **PINNED** (nit: the no-secret-read pin omits `ctf:classic:hints` — one line) |
| `AdminQuestion`/`AdminChallenge` ⊄ `Question`/`Challenge` | type nesting quiz-store.ts:171-179, classic-store.ts:176-187 | classic: `@ts-expect-error` classic-store.test.ts:410-417. Quiz: **none** | **PARTIAL** — quiz half unpinned; both only bite under `next build`'s tsc (vitest has no typecheck block) |
| Hint text never pre-purchase | hint-store.ts:221-318; availability = HKEYS only (:356-386) | hint-store.test.ts:118,375,437-483,507; reveal route tests; flags/[id] page.test.tsx:156-190 | **PARTIAL** — `getClassicHintIds` (the function between hint text and the public board) has zero tests, only ever mocked |
| Activity-log detail = ids/slugs only | activity-log.ts:12-16; call sites | team-store.ts sites: exact-args pins (team-store.test.ts:999-1048). Solve routes: **none** | **PARTIAL** — unpinned exactly where flags flow (finding 7) |
| Classic already-solved / cooldown (Lua authority) | SUBMIT_SCRIPT classic-store.ts:859-881 | text-ordering pins only; verdict-mapping tests mock the eval | **UNPINNED at the Lua layer** (finding 2) |
| Quiz attempt cap (Lua authority) | GRADE_SCRIPT quiz-store.ts:802-804 | JS twin pinned (grade.test.ts:275); Lua `>=` pinned nowhere | JS **PINNED**, Lua **UNPINNED** |
| Settings change ⇔ audit line atomic | UPDATE_SCRIPT admin-store.ts:316-323 | args pinned; `LPUSH` in script text unpinned; live test skipped in CI | **PARTIAL** |
| Hint purchase idempotent + atomic charge | REVEAL_SCRIPT hint-store.ts:97-105 | real-Lua test hint-store.upstash.test.ts:59-92 — **skipIf-skipped in CI** | **PARTIAL** (best-in-class locally, absent in CI) |
| normalizeFlag: trim+NFC+lowercase, never in Lua, write==read | classic-keys.ts:58-85; `not.toContain("string.lower")` both grade files | corpus: trim/case/Ü/NFC-vs-NFD/case-sensitive all pinned; write/read byte-identity pinned end-to-end | **PINNED** for what exists; corpus holes: Turkish İ, emoji, zero-width chars, import-path caseSensitive (finding 10) |
| Author filter before JSON.parse | sync/src/github.js:26 → index.js:120, structural | github.test.js:27-39; parse.test.js:15-19; smoke.sh:87-89 (forged well-formed marker) | **PINNED** |
| GITHUB_LOGIN grammar guards Redis keys | 4 byte-identical copies: sync/parse.js:3, scorer/serve.js:8, scorer/judge.js:10, + frozen test snapshot | correct against every injection shape (fuzz table verified: `:`/ws/newline/unicode/overlong all reject) — but length + hyphen rules unpinned (mutations survive) and **no agreement test between copies** | **PARTIAL** |
| Seen-cache keyed on revision (id+updated_at) | sync/src/state.js:122-142 | state.test.js:140-154 + tick.test.js:183-227 — real tests, not comment-only | **PINNED** |
| Un-mark-on-failure retry | sync/src/index.js:142-150 | batch test tick.test.js:71-136 real; dedicated test vacuous | **PARTIAL** (finding 4) |
| Monotonic/idempotent score writes | scorer HSETNX store.js:33,82 | store.test.js:8-45 + serve.test.js:123-131 (replay) | **PINNED** |
| loadState field-by-field repair | sync/src/state.js:37-98 | {}, truncated JSON, repos-as-array, seen-missing, survives-resetAt/ingested/cursor all tested (state.test.js:30-109) | **PINNED** (minor: non-ENOENT errors, NaN counters untested) |
| outsideWindow ×3 readers agree | schedule-window.ts:16, scorer/store.js:16, sync/redis.js:10 — token-identical by inspection | each has a local test; **no differential corpus** (ADR 32 admits it, decisions.md:1308-1311); boundary instant untested in all three (mutation survives) | **PARTIAL** |
| Pipeline order (contributions → teams → penalties LAST) | three page callsites | property pinned at lib level (pipeline.test.ts:88-146); callsites uncovered; profile oracle uses old order | **PARTIAL** (finding 8) |
| Team dedupe union-not-sum, earliest wins | team-fold.ts:61-90 (ADR 30) | team-fold.test.ts:17-62 + overlay adds-not-refolds pins | **PINNED** (4/4 mutations killed) |
| Hint penalties netted exactly once; team = SUM (deliberate) | hint-penalties.ts:37-86 | pipeline.test.ts:88-98; hint-penalties.test.ts:153-160 | **PINNED** (3/3 mutations killed) |
| emptySource path | empty.ts:25-42; row creation module-contributions.ts:389-443 | source-empty.test.ts; rendered CTA test; acceptance-quiz-only.sh | **PINNED** |
| Solve-rate floor max(attempters, solvers) | metrics-store.ts:376,382 | metrics-store.test.ts:192,439-492 | **PINNED** (max→min killed) |
| lastSolveAt tiebreaks | rank.ts:15-17,63-70 | single-stamp behavior fully pinned (rank.test.ts:58-100) | **PARTIAL** — multi-stamp `Math.max` unpinned against its own "DO NOT change to Math.min" comment (survives 2259 tests) |
| Gate fail directions (18 gates enumerated) | see per-gate table in findings | 15 of 18 have stated direction + error-injection test | **PARTIAL** — quiz settings read (finding 1), `isRegistrationClosed` (no stated direction, mixed actual), `revealHint` settings read (right direction, untested) |

---

## Mutation survivors

Every hand-applied (or statically-verified) single-token mutation the existing suite does
not catch. Anything here is coverage the numbers claim but don't have.

| # | File:line | Mutation | Consequence if shipped |
|---|---|---|---|
| S1 | classic-store.ts:859 (Lua) | `HEXISTS … == 1` → `== 0` | re-solve farms points; first solves refused |
| S2 | quiz-store.ts:802 (Lua) | cap `>=` → `>` | one free attempt per question (JS twin caught; Lua authority not) |
| S3 | classic-store.ts:880 (Lua) | drop `and lastAtMs` | 500 on every first-ever submission |
| S4 | classic-store.ts:912 (Lua) | `HINCRBY KEYS[6], ARGV[1]` → `ARGV[4]` | solvecount keyed by login, board stats wrong |
| S5 | classic-store.ts:520 | `flagComparisonForm` → `normalizeFlag` in importBundle | restored case-sensitive challenge unsolvable |
| S6 | admin-store.ts:321 (Lua) | delete `LPUSH` audit line | settings changes land unaudited (live test exists, skipped in CI) |
| S7 | rate-limit-store.ts:47 (Lua) | drop `if n == 1 then` | permanent throttle under steady traffic (known/documented manual-verify) |
| S8 | hint-store.ts:378-380 | drop enabled short-circuit / HKEYS→HGETALL in `getClassicHintIds` | hint text interleaved into server-side ids array |
| S9 | classic submit route.ts:84 | `logActivity(..., flag)` instead of challengeId | flags in the screen-shared activity log |
| S10 | sync/parse.js:3 | login length `{0,38}` → `{0,99}` | over-long logins accepted (no key-injection chars, fidelity only) |
| S11 | sync/parse.js:3 | drop hyphen lookahead | `trail-`/`dou--ble` logins accepted |
| S12 | sync/redis.js:13 | window `<` → `<=` | boundary-instant submissions dropped in one reader — lockstep silently broken |
| S13 | rank.ts:69 | `Math.max(...stamps)` → `Math.min` | tie-breaks flip; survives all 2259 tests despite the code's own warning comment |
| S14 | module-contributions.ts:411 | created-row gate `<= 0` → `< 0` | zero-point ghost rows on the board |
| S15 | schedule-window.ts:20 | end-boundary `>` → `>=` | same as S12, app reader |
| S16 | classic-store.ts:816 | retry-instant `<` → `<=` | store refuses at the exact instant the countdown shows "go" |
| S17 | sync/tick un-mark (index.js:145) | delete un-mark | dedicated test passes (vacuous); one batch test is sole detection |

Killed-mutant score by area: sync 10/13, leaderboard/time 15/19, apps/web stores 7/14
(all seven survivors inside Lua text or fake-backed scripts), gates/auth 12/12 caught.

---

## Full findings by area

### apps/web — grading, atomicity, normalization

- **[bug][drift] P1** Quiz settings read fails closed vs ADR 32 — finding 1.
- **[test-gap] P1** Grading Lua never executed; semantic guards unpinned — finding 2, survivors S1–S4.
- **[test-gap] P1** importBundle case-sensitive branch untested — finding 10, S5.
- **[test-gap] P2** Settings-change-without-audit survives CI (S6): `admin-store.test.ts:177-215`
  checks keys/args, never script text; the live test (`admin-store.upstash.test.ts:46-53`)
  is skipIf-skipped in CI. Same for `ADMINS_SCRIPT`/`RESET_SCRIPT`.
- **[risk] P2** `resetEvent` wipes before it freezes (`admin-store.ts:572-585`): the
  SCAN/DEL loop runs over many round trips with scoring live; `RESET_SCRIPT` sets `paused`
  only afterwards. A submission landing mid-wipe re-banks into a just-deleted hash.
  Fix: HSET `paused=1` before the wipe loop.
- **[bug] P2** `forceDisbandTeam` is the non-atomic twin of an atomic script
  (`admin-ops-store.ts:455-484`: SMEMBERS in one pipeline, deletes in a second), while
  team-store's own `DISBAND_SCRIPT` (`team-store.ts:167-175`) exists precisely to avoid
  the join-between-read-and-delete race. Fix: `FORCE_DISBAND_SCRIPT` = DISBAND_SCRIPT
  minus the captain guard. Related [nit]: every admin-ops mutation audits in a separate
  call after its script (`:408,445,482`) — weaker than the settings guarantee; worth one
  header sentence.
- **[test-gap] P2** Normalization corpus holes: Turkish İ (a `toLocaleLowerCase`
  regression is invisible on en-locale CI), emoji/astral pairs, zero-width chars
  (`trim()` does NOT strip U+200B/U+FEFF — current deliberate-until-decided behavior,
  pinned by nothing). §7 below.
- **[drift] P3** "written in ONE pipeline so they can never observably disagree"
  (upsertChallenge comment, ADR 27) overstates `/pipeline`: serial but not transactional
  (`upstash.ts:10-22`); another client's EVAL can interleave between the HSETs/HDELs.
  Impact bounded to a cosmetic solvecount row (SUBMIT_SCRIPT's points-0 fallback,
  `classic-store.ts:893-897`). Fix: one honest clause in the two comments.
- **[nit] P3** `seedDemoData` bypasses `flagComparisonForm` (`admin-store.ts:806`) —
  correct while the demo fixture has no case-sensitive challenge; its comment still names
  `normalizeFlag` as "the ONLY thing allowed," stale since #193. Swap the call.
- **[nit] P3** Rate-limit EXPIRE-on-first-only is manually-verified-only (S7); the test
  file's comment says so honestly. One `expect(script).toContain("if n == 1 then")`.

### apps/web — secrecy & gates

- **[test-gap] P1** Activity-log detail at solve routes — finding 7, S9.
- **[test-gap] P2** `AdminQuestion` type boundary untested (classic has the
  `@ts-expect-error`, quiz doesn't). Caveat both ways: vitest has no `typecheck` block,
  so these pins only bite under `next build`'s tsc pass.
- **[test-gap] P2** `getClassicHintIds` zero tests (S8) — the one function between hint
  text and the public board, only ever mocked. §9 below.
- **[test-gap] P2** `isRegistrationClosed` (`team-store.ts:195-204`): no stated fail
  direction, and the actual behavior is mixed — transport error throws (→500, closed);
  a per-command `{error}` reply decodes as open. Its two siblings each carry direction +
  comment + test. Pick open (matches sibling reasoning; join script still validates),
  document, test.
- **[nit] P2** `revealHint`'s settings read fails closed (right direction for a spend)
  but unstated and un-injected.
- **[nit] P3** `listChallenges` no-secret-read pin omits `ctf:classic:hints` — one line:
  `expect(keys).not.toContain("ctf:classic:hints")`.
- **Positive:** all four secrecy layers of invariants 1–2 pinned independently;
  every `/api/admin/*` route verified behind `requireAdmin`; fail-direction pairs
  documented as cross-references and error-injected — 15 of 18 gates fully covered.

### Leaderboard & time

- **[test-gap] P1** `activityMs` Math.max unpinned (S13) — survives the full suite
  despite `rank.ts:57-62`'s explicit "DO NOT change to Math.min." §10 below.
- **[test-gap][drift] P1** Pipeline order oracle/comments/callsites — finding 8.
- **[bug] P2** Hint-penalty login join is case-SENSITIVE (`hint-penalties.ts:55,71`)
  while every neighboring login join is deliberately case-insensitive
  (`module-contributions.ts:53-55,132-140`, `team-standings.ts:33-36`). A case
  disagreement between PR-author spelling and session spelling makes that contestant's
  hints free. Same class: `profile/page.tsx:139` (`e.login === member`) renders a
  case-mismatched teammate scoreless. Fix: lowercase at map-build and both lookups.
- **[test-gap] P2** `outsideWindow` exact-boundary unpinned in all three readers
  (S12/S15) + no cross-reader corpus — ADR 32 itself names the gap. Corpus in §11.
- **[test-gap] P2** created-row zero-item gate (S14); store-side cooldown boundary (S16);
  `formatRelativeTime` has zero tests. Drop-ins in §12.
- **[nit] P3** `admin/status/route.ts:27` compares ISO strings lexicographically — safe
  only for fixed-width `toISOString()`; worth a comment.
- **Positive:** no seconds/ms mismatch anywhere (classic sec, quiz min — unit
  test-pinned — secure-dev min converted once in the fork workflow); no TZ/DST-sensitive
  computation found (epoch-ms over Z-ISO everywhere; display slices ISO or pins UTC;
  ADR 15 tested under two TZs); zero real sleeps in apps/web tests.

### sync & cross-service contracts

- **[test-gap] P1** Vacuous un-mark assertion — finding 4, S17.
- **[test-gap] P1** `sync/src/parse.js` → scorer CI edge — folded into finding 5.
- **[risk] P2** Truncated marker (closing brace lost) classified as routine `noMarker`
  silence; ADR 38's table (decisions.md:1639) explicitly lists truncation under `invalid`.
  Verified empirically. Either fix `hasScoreMarker` to `/<!--\s*ctf-score:\s*\{/` (keeps
  the bare placeholder routine) + tick-level tests, or amend ADR 38 — today doc and code
  disagree.
- **[test-gap] P2** GITHUB_LOGIN under-pinned (S10/S11): four byte-identical copies, no
  agreement test, sync's corpus lacks even the `[bot]`-accept case. Differential corpus
  in §13 (kills both survivors and pins copy agreement the way `setup/targets.tsv`
  already does for repo names).
- **[test-gap] P2** loadState: non-ENOENT read-error branch and non-numeric counters
  untested — `{"ingested":"abc"}` survives repair, `++` yields NaN, serialized as the
  string `"NaN"` into `ctf:sync:status` and decoded as NaN by the admin panel.
- **[drift] P2** mock-github implements none of the `since`/ETag/304/sort semantics the
  cursor logic depends on; mock-scorer accepts any payload and serves a different
  `/leaderboard` shape. No mock-only write path exists (real scorer + acceptance cover
  all writes), but nothing pins fixture-to-reader agreement. Optional guard: unit test
  feeding mock-github's comment array through the real `github.js`/`parse.js`.
- **[nit]** Per-repo `since`/`etag` of wrong scalar type pass verbatim into the query
  param (harmless with GitHub; unstated).
- **Positive:** author-filter-before-parse structural and pinned; revision-keyed seen
  cache pinned by real tests; ADR 5/16 retry-over-precision implemented and tested
  exactly as written; the three `outsideWindow` bodies token-identical.

### bash / setup / acceptance

- **[test-gap] P1** bats `[[ ]]` non-gating — finding 3.
- **[test-gap] P1** `org` apply/idempotency path untested — finding 6.
- **[test-gap] P2** `cmd_secrets` refuse-overwrite (`ctf-setup.sh:1045`), `cmd_check`
  failure paths (`:1035-1039`), `oauth-config` empty-secret rejection (`:1379`) untested.
- **[test-gap] P2** Corpus missing shapes: empty file, UTF-8 BOM (would split the awk
  reader from a BOM-stripping JS YAML lib — exactly the divergence class the corpus
  exists for), unicode values, CRLF on a reject fixture.
- **[risk] P2** `smoke.sh:88` forged-comment negative could go vacuous on an empty board
  — mitigated by the preceding populated-board wait at `:75`; pair with a positive count
  if touched.
- **[nit]** `bash_verdict` collapses exit 2 vs 3 (`module_readers.bats:34`) — compensated
  by targeted message tests.
- **Positive:** shellcheck runs at default severity over every tracked `.sh` (SC2086
  enforced; verified clean); zero SC2015; no `local x=$(cmd)` masking on the provisioning
  path; `check_step` fail-closed genuinely tested for the two dangerous cases; `--dry-run`
  zero-mutation robustly asserted; acceptance scripts are the strongest layer in the repo
  (`classic-only.sh:274-278`'s seeded-flag-never-renders check is the best single
  assertion in the codebase); corpus differential auto-discovers fixtures on both sides.

### CI

- **[test-gap] P1** Four missing path→job edges — finding 5.
- **[risk] P2** `stock-scores-zero.yml`/`patched-scores-right.yml` never run on main
  (pull_request + dispatch only) — ci.yml's "main runs everything" safety net doesn't
  extend to the two scoring-integrity gates, so any gap in their `paths:` is never caught
  post-merge either. Fix: add `push: {branches: [main], paths: [...]}` to both.
- **[test-gap] P2** `.dockerignore` (root → app builds; scorer/ → heavy gates) watched by
  no filter.
- **[nit] P2** `m()` in the changes job treats grep exit 2 as "no match" (ci.yml:43) —
  fail-open on a malformed pattern; the exact shape `check_step` forbids.
- **[nit] P2** No pnpm cache in the `app` job (slowest ci.yml job, cold installs);
  over-broad smoke triggers (`^setup/`, `^Caddyfile` fire a job that uses neither).
- **[risk] P2** Unretried network fetches (Docker Hub anonymous pulls ~1.5GB on heavy
  gates, single `git fetch` in acceptance-lib) — flake surface under runner-IP rate limits.
- **[drift] P2** srh pinning inconsistency across acceptance scripts (two digest-pinned,
  one `:latest`) — either is defensible under ADR 51; contradicting each other is the
  drift.
- **Verified sound:** no `continue-on-error`/stray `if: always()`; the consumer
  workflow's `always()` is correctly outcome-gated; quiz-only's compose-config trap is
  fixed (REDIS_PASSWORD set before `config`, with the failure mode named in a comment);
  smoke's negative hold is non-vacuous (~5 poll ticks); no `pull_request_target` in repo
  CI; no script-injection via github context in `run:` blocks.

### Code quality & security (Phase 3)

- **[risk] P2** `scorer/src/store.js:106` `isPaused` fails open **silently** — the sync
  twin logs the same failure (`sync/src/redis.js:44-47`); scorer leaves zero trace.
  One-line parity fix.
- **[risk] P2** tsconfig lacks `noUncheckedIndexedAccess` — the flat-array Redis parsers
  (`leaderboard/upstash.ts:18`, `quiz-store.ts:468`) are exactly the code an odd-length
  reply bites. (No `any`/`as any` anywhere in non-test lib code — verified.)
- **[drift] P2** Dependency-pinning gaps outside ADR 51's scope: no `terraform`
  Dependabot ecosystem for `deploy/aws-terraform/`; `user-data.sh.tftpl:16` hardcodes
  docker-compose `v2.29.7` via curl — invisible to every ecosystem, will silently rot.
  Pin+cover or write the carve-out.
- **[nit] P2** `admin-store.ts:413-475` `null as unknown as boolean` — the `changed` map's
  type lies (holds strings/nulls/booleans, typed boolean).
- **[nit] P2** `generate-event-config.mjs`: valid-base64-invalid-YAML dies as an unhandled
  stack trace instead of the clean `fail()` every other rejection uses. (Bad base64,
  unknown module/target, legacy `url:` all fail loudly — verified; the empty-arg neutral
  default remains the one documented silent trap.)
- **[nit] P2** `scorer/src/serve.js:143-145` swallows mid-stream errors after headers
  sent, no log.
- **[test-gap] P2** ADR 38's own residual: "a future `continue` added without a bucket is
  invisible again" — unenforced. One unit test: sum of tally buckets ==
  `result.comments.length` per repo.
- **Highest-risk files to modify** (size × fan-in × invariant density):
  1. `apps/web/src/lib/modules.ts` (1207 lines) — REGISTRY + `ALL_MODULE_ROUTES` that
     proxy gating depends on; a wrong edit silently drops a route from the gate.
  2. `classic-store.ts` (1027) / `quiz-store.ts` (920) — Lua authority + JS pre-check
     agreement + fold contract; the least-tested layer lives here (finding 2).
  3. `admin-store.ts` (925) — the settings hash three services read; a field rename
     desyncs scorer + sync silently.
- **Verified clean:** markdown renderer withstands the full attack battery
  (`javascript:` with tab/newline/case/entities, `data:`, `vbscript:`, `//host`,
  entity-encoded, paren-truncated — all blocked at `markdown.ts:41-50`; output is React
  elements, `dangerouslySetInnerHTML` appears only in comments forbidding it); every
  mutating route derives identity from the session; origin assertion covers all of
  `/api/*` by matcher, new routes covered by default; secrets never echoed on the
  provisioning path; base images digest-pinned per ADR 51; SCAN-only, batched folds,
  nothing O(contestants) serial on a hot path; ADR 38's silent-drop loop bug fixed
  loop-wide, not just where it bit.

### Docs vs code (Phase 5)

P1 family — finding 9 (unlanded-upstream ×5 spots, classic-hints-absent, hint-gate
module check misstated at operations.md:286-288 — it's per-target,
`hint-store.ts:186` — build-time-enablement ×2, `teams:`/`hints:` in hosting.md,
modules.md hint-fold order, architecture.md "seven jobs" → nine).

P2 drifts, verified side-by-side:
- "matcher is page-only" (modules.md:607-609, operations.md:1029-1031) — matcher carries
  `/api/:path*` for the CSRF assertion (`proxy.ts:92`); the gate set is pages-only.
- App's `outsideWindow` lives in `schedule-window.ts:16`, not `admin-store.ts` — three
  docs (architecture.md:596-598, ADR 32, AGENTS.md:161-163) point at the old home; the
  lockstep-edit pointer is exactly the one that must be right.
- ADR 19's field list stale (+14 fields); its "pause checked first" claim aged out
  (reset-epoch read comes first, `sync/src/index.js:76-84` — architecture.md:809 has it
  right).
- ADR 8 never amended after 17/18 inverted its premise; ADR 37's "#43" anchor points at
  the wrong ADR; ADR 31's `TEAM_MAX_MEMBERS` pointer stale (moved to `team-limits.ts:18`).
- hosting.md workflow-version samples a generation behind (template is v3);
  operations.md's Shepherd hex window says 32-128, code is 64-128 (`helpers.js:176-182`);
  reset confirm also accepts the literal `"RESET"` (`reset/route.ts:14`), undocumented;
  AGENTS.md's scorer command block mixes working directories.
- Undocumented siblings where docs enumerate: `teardown` subcommand and `--config`/`--out`
  in hosting.md; `POLL_INTERVAL_MS`/`COMMENT_AUTHOR`/scorer `PORT`; vacuous-sweep
  `--personality`; classic-bundle `caseSensitive`/`hint` fields (operations.md claims the
  bundle carries "exactly the fields the admin form collects"); no ADR for the activity
  log; `event.yaml.example`'s `oauth_client_id` has no reader (vestigial).
- ~44 load-bearing claims spot-verified correct (caps 500/5000/2000, all key names,
  regexes, cooldown units, profile assignments, 321/668 rubric totals recomputed exact,
  route/status contracts, reset-prefix walk, ADR anchors).

Suggested docs fix order: (1) the shipped-but-documented-as-pending family in one PR;
(2) module-enablement pair + hint-fold order + the stale page comments (same concept,
code and docs in one pass); (3) hosting.md teams/hints + CI job count; (4) the pointer/
version P2s.

---

## Tests I would write

Ordered by which unpinned invariant they pin. All match the existing style of their layer
(vitest + vi.hoisted mocks, no testing-library; node:test; bats decisive-check-last).

### 1. Quiz freeze fails open (RED today — lands with the finding-1 fix)
`apps/web/src/lib/__tests__/quiz-store.grade.test.ts`:
```ts
it("fails OPEN when the SETTINGS read errors — a Redis blip must never silently drop a live submission", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getAdminSettings.mockRejectedValueOnce(new Error("redis down"));
  gateReads(null, null);
  mocks.upstashEval.mockResolvedValueOnce(["correct", "20"]);
  const result = await answerQuestion("octocat", "q1", ["a"]);
  expect(result).toEqual({ ok: true, correct: true, points: 20 });
  // The script still enforces the BAKED defaults it was handed.
  const [, , args] = mocks.upstashEval.mock.calls[0];
  expect(args[4]).toBe(QUIZ_MAX_ATTEMPTS);
  consoleError.mockRestore();
});
```

### 2. Lua semantic pins (kills S1–S4 today, zero infra)
`classic-store.grade.test.ts`, inside `describe("the grading script itself (text invariants)")`:
```ts
it("keeps the semantic guards the ordering pins cannot see: the HEXISTS polarity, the cooldown comparison, and the counter keyed by challenge id", async () => {
  await submitFlag("alice", "chal-1", "x");
  const { script } = lastEval();
  // Inverting any of these survives the indexOf-ordering test above — each
  // substring is the exact token a survivable mutation would have to change.
  expect(script).toContain("if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 1 then return {'already'} end");
  expect(script).toContain("if cooldownMs > 0 and lastAtMs and nowMs < (lastAtMs + cooldownMs) then");
  // solvecount is keyed by the CHALLENGE (ARGV[1]), the two totals by the login (ARGV[4]).
  expect(script).toContain("redis.call('HINCRBY', KEYS[6], ARGV[1], 1)");
  expect(script).toContain("redis.call('HINCRBY', KEYS[5], ARGV[4], points)");
});
```
Quiz twin in `quiz-store.grade.test.ts`:
```ts
it("pins the cap comparison itself — 'attempts >= maxAttempts', not '>' — and the guard's polarity", async () => {
  gateReads(null, null);
  mocks.upstashEval.mockResolvedValueOnce(["correct", "20"]);
  await answerQuestion("octocat", "q1", ["a"]);
  const [script] = mocks.upstashEval.mock.calls[0] as [string, string[], (string | number)[]];
  expect(script).toContain("if maxAttempts > 0 and attempts >= maxAttempts then");
  expect(script).toContain("if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 1 then return {'already'} end");
  expect(script).toContain("if cooldownMs > 0 and lastAtMs and nowMs < (lastAtMs + cooldownMs) then");
});
```
Then part (b): `classic-store.upstash.test.ts`/`quiz-store.upstash.test.ts` cloning
`hint-store.upstash.test.ts`'s `describe.skipIf(!configured)` harness — double-submit →
one `already`; burst at the cooldown boundary → one `cooldown`; attempts at cap →
`exhausted` — and an SRH+redis service container in the CI app job so all five
`.upstash` suites actually run.

### 3. Activity-log detail at the solve routes (kills S9)
`app/api/classic/submit/__tests__/route.test.ts` (quiz twin analogous):
```ts
const { logActivity } = vi.hoisted(() => ({
  logActivity: vi.fn<(type: string, login: string, detail?: string) => Promise<void>>(),
}));
vi.mock("@/lib/activity-log", () => ({ logActivity }));

it("logs a fresh solve with the challenge ID — never the flag", async () => {
  storeReturns({ ok: true, correct: true, points: 50 });
  const res = await POST(req({ challengeId: "web-sqli-101", flag: "CTF{secret}" }));
  expect(res.status).toBe(200);
  expect(logActivity).toHaveBeenCalledExactlyOnceWith("classic-solve", "alice", "web-sqli-101");
  expect(JSON.stringify(logActivity.mock.calls)).not.toContain("CTF{secret}");
});

it("logs nothing for an idempotent re-submission or a wrong flag", async () => {
  storeReturns({ ok: true, correct: true, points: 0, already: true });
  await POST(req({ challengeId: "web-sqli-101", flag: "CTF{secret}" }));
  storeReturns({ ok: true, correct: false });
  await POST(req({ challengeId: "web-sqli-101", flag: "nope" }));
  expect(logActivity).not.toHaveBeenCalled();
});
```

### 4. importBundle case-sensitive restore (kills S5)
`lib/__tests__/classic-store.test.ts`, `describe("importBundle")`:
```ts
it("stores a case-sensitive row's comparison form with case intact — a backup must restore the same grading", async () => {
  await importBundle(bundleWithChallenge({ flag: "CTF{Mixed}", caseSensitive: true }));
  const written = flatArgsFor("ctf:classic:flagnorm");
  expect(written).toContain("CTF{Mixed}");
  expect(written).not.toContain("ctf{mixed}");
});
```

### 5. Sync un-mark, de-vacuoused (kills S17)
`sync/test/tick.test.js`, replacing the assertion at :68:
```js
test("scorer 5xx un-marks the comment so it retries next tick", async () => {
  const posts = [];
  const f = routes(() => new Response(JSON.stringify([ghComment(1)]), { status: 200, headers: {} }), 503, posts);
  const state = { repos: {} };
  await tick(CFG, state, { fetchImpl: f, log: () => {} });
  assert.deepEqual(state.repos.DVWA.seen, [], "the failed revision must be un-marked, key and all");
});
```

### 6. Pipeline order, structurally (finding 8)
Add next to the stages and use at all three callsites:
```ts
export const composeLeaderboard = (data: Promise<LeaderboardData>) =>
  data.then(withModuleContributions).then(withTeamStandings).then(withHintPenalties);
```
Point `pipeline.test.ts`'s `pipeline` const at it (every existing pipeline test then pins
the shipped order, not a private copy). Repair the profile oracle
(`profile/__tests__/page.test.tsx:139` → shipped order) and add the floor-edge fixture
where the two orders disagree:
```ts
it("agrees with the board on the floor edge — spend exceeding scorer points", async () => {
  // Old order: max(0, 5−10) + 15 = 15. Shipped order: max(0, 5+15−10) = 10.
  isModuleEnabled.mockImplementation((id: string) => id === "quiz" || id === "secure-development");
  getSession.mockResolvedValue({ user: { login: "ada", image: null } });
  getUser.mockResolvedValue({ ...baseProfile, points: 5, patched: 1 });
  getViewerHints.mockResolvedValue({ purchased: {}, spent: 10, count: 1 });
  getQuizTotals.mockResolvedValue(new Map([["ada", { points: 15, answered: 2, lastAt: null }]]));
  getHintPenalties.mockResolvedValue(new Map([["ada", 10]]));
  const html = renderToStaticMarkup(await ProfilePage());
  expect(html).toContain(">10<");
});
```

### 7. normalizeFlag corpus holes
`lib/__tests__/classic-keys.test.ts`:
```ts
it("lowercases locale-independently — Turkish İ must produce the same bytes on every host", () => {
  // U+0130 lowercases to "i" + U+0307 under locale-independent toLowerCase. A
  // toLocaleLowerCase() regression is invisible on an en-locale CI host, so this
  // pins the exact output: on a tr-TR host the swap yields plain "i" and fails.
  expect(normalizeFlag("CTF{İ}")).toBe("ctf{i̇}");
});

it("passes emoji through untouched — case-folding must not mangle astral pairs", () => {
  expect(normalizeFlag("CTF{🚩flag}")).toBe("ctf{🚩flag}");
});

it("does NOT strip zero-width characters — a pasted ZWSP is a wrong answer, and that is current, deliberate-until-decided behavior", () => {
  // If this ever becomes "strip them", authoring and submission change together
  // in this one function — this test forces that conversation.
  expect(normalizeFlag("ctf{fl​ag}")).not.toBe("ctf{flag}");
});
```

### 8. `org` apply path (bats — verified runnable against the real script)
```bash
@test "org (apply mode) is idempotent: an already-provisioned org applies nothing" {
  _gh_all_satisfied   # stub: every check_step read reports satisfied (see below)
  PATH="$(pwd)/stubs:$PATH" run env SCORE_IMAGE=ghcr.io/o/score:latest \
    bash "$SCRIPT" org --config event.yaml
  [ "$status" -eq 0 ]
  echo "$output" | grep -qF "already done"
  # Decisive-last: no step ever entered its apply branch ("  → ").
  [ -z "$(printf '%s' "$output" | grep -F '  → ')" ]
}

@test "org (apply mode) applies a missing step: fork not present -> gh repo fork runs" {
  _gh_all_unsatisfied_logging   # stub: reads fail, invocations logged to $GH_LOG
  export GH_LOG="$BATS_TEST_TMPDIR/gh.log"; : > "$GH_LOG"
  PATH="$(pwd)/stubs:$PATH" run env SCORE_IMAGE=ghcr.io/o/score:latest \
    bash "$SCRIPT" org --config event.yaml
  grep -qF "repo fork digininja/DVWA --org test-event-org --fork-name DVWA" "$GH_LOG"
}
```
(Stub bodies: a `gh` script whose reads report the target state satisfied/unsatisfied and
a `docker` script answering `amd64` to the arch check — full versions in the bash audit,
both exercised against the real script.) Plus:
```bash
@test "secrets refuses to overwrite an existing .env" {
  printf 'BETTER_AUTH_SECRET=keep-me\n' > .env.keep
  run bash "$SCRIPT" secrets --out .env.keep
  [ "$status" -ne 0 ]
  grep -qx 'BETTER_AUTH_SECRET=keep-me' .env.keep
}
```

### 9. `getClassicHintIds` (kills S8)
`lib/__tests__/hint-store.test.ts`, using its existing `loadStore`/`mocks` scaffolding:
```ts
describe("getClassicHintIds", () => {
  it("reads ids via HKEYS only — never the hint texts", async () => {
    const store = await loadStore();
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: ["c1", "c2"] }]);
    expect(await store.getClassicHintIds()).toEqual(["c1", "c2"]);
    expect(mocks.upstashPipeline).toHaveBeenCalledWith([["HKEYS", "ctf:classic:hints"]]);
  });
  it("returns [] when hints are off, without reading the hash", async () => {
    const store = await loadStore(false);
    expect(await store.getClassicHintIds()).toEqual([]);
    expect(mocks.upstashPipeline).not.toHaveBeenCalled();
  });
  it("degrades to [] on a store failure so the board renders without the hint layer", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = await loadStore();
    mocks.upstashPipeline.mockRejectedValueOnce(new Error("redis down"));
    expect(await store.getClassicHintIds()).toEqual([]);
    consoleError.mockRestore();
  });
});
```

### 10. `activityMs` Math.max (kills S13)
`lib/leaderboard/__tests__/rank.test.ts` — build the pair where min and max disagree:
```ts
it("ties break on each entry's NEWEST stamp, not its oldest", () => {
  const a = entryWith({ login: "a", lastSolveAt: "2026-08-01T05:00:00.000Z",
    quizActivityAt: "2026-08-01T12:00:00.000Z" }); // min 05:00, max 12:00
  const b = entryWith({ login: "b", lastSolveAt: "2026-08-01T06:00:00.000Z",
    quizActivityAt: "2026-08-01T11:00:00.000Z" }); // min 06:00, max 11:00
  // Max: b (11:00) beats a (12:00). Min would flip it (05:00 beats 06:00).
  expect(rankByStanding([a, b]).map((e) => e.login)).toEqual(["b", "a"]);
});
```
(`entryWith` = the file's fixture builder extended with a quiz `lastActivityAt`; the full
two-pair version from the audit also pins the same-winner case.)

### 11. `outsideWindow` differential corpus (kills S12/S15, closes ADR 32's own gap)
`test/fixtures/window-corpus.json` — one shared artefact, three thin readers, the exact
pattern of `setup/targets.tsv`'s differential tests:
```json
[
  { "case": "unbounded",           "now": "2026-06-01T12:00:00Z", "startsAt": null,                   "endsAt": null,                   "outside": false },
  { "case": "before-start",        "now": "2026-06-01T12:00:00Z", "startsAt": "2999-01-01T00:00:00Z", "endsAt": null,                   "outside": true  },
  { "case": "after-end",           "now": "2026-06-01T12:00:00Z", "startsAt": null,                   "endsAt": "2000-01-01T00:00:00Z", "outside": true  },
  { "case": "inside",              "now": "2026-06-01T12:00:00Z", "startsAt": "2000-01-01T00:00:00Z", "endsAt": "2999-01-01T00:00:00Z", "outside": false },
  { "case": "exactly-at-start",    "now": "2026-06-01T12:00:00Z", "startsAt": "2026-06-01T12:00:00Z", "endsAt": null,                   "outside": false },
  { "case": "exactly-at-end",      "now": "2026-06-01T12:00:00Z", "startsAt": null,                   "endsAt": "2026-06-01T12:00:00Z", "outside": false },
  { "case": "1ms-before-start",    "now": "2026-06-01T11:59:59.999Z", "startsAt": "2026-06-01T12:00:00Z", "endsAt": null,               "outside": true  },
  { "case": "1ms-after-end",       "now": "2026-06-01T12:00:00.001Z", "startsAt": null, "endsAt": "2026-06-01T12:00:00Z",               "outside": true  },
  { "case": "unparseable-both",    "now": "2026-06-01T12:00:00Z", "startsAt": "nope",                 "endsAt": "also-bad",             "outside": false },
  { "case": "empty-string-bounds", "now": "2026-06-01T12:00:00Z", "startsAt": "",                     "endsAt": "",                     "outside": false },
  { "case": "inverted-window",     "now": "2026-06-01T12:00:00Z", "startsAt": "2999-01-01T00:00:00Z", "endsAt": "2000-01-01T00:00:00Z", "outside": true  }
]
```
`sync/test/window.differential.test.js` (scorer twin identical from `../src/store.js`;
app twin in vitest from `@/lib/schedule-window`):
```js
// The scheduled-window contract, sync half. outsideWindow is implemented
// independently in scorer/src/store.js and apps/web/src/lib/schedule-window.ts
// (ADR 32: "change all three together"). Neither imports the others; all three
// run this corpus, so agreeing with it is agreeing with each other — the same
// artefact pattern as setup/test/corpus/ and setup/targets.tsv.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { outsideWindow } from "../src/redis.js";

const CORPUS = JSON.parse(
  readFileSync(new URL("../../test/fixtures/window-corpus.json", import.meta.url), "utf8"),
);

test("outsideWindow matches every corpus verdict", () => {
  const mismatches = CORPUS.filter(
    (c) => outsideWindow(Date.parse(c.now), c.startsAt, c.endsAt) !== c.outside,
  ).map((c) => c.case);
  assert.deepEqual(mismatches, []);
});
```
CI: add the corpus path to the `sync` and `scorer` filter lines, mirroring how
`setup/test/corpus/` already rides the sync filter.

### 12. Remaining boundary drop-ins
Created-row zero-item gate (kills S14), `module-contributions.test.ts`:
```ts
it("never creates a row for a login whose totals hold zero completed items", async () => {
  mocks.getClassicTotals.mockResolvedValue(new Map([["ghost", { points: 0, solved: 0, lastAt: null }]]));
  const out = await withModuleContributions(data([]));
  expect(out.entries).toEqual([]);
});
```
Store-side cooldown boundary (kills S16), `classic-store.grade.test.ts`:
```ts
it("allows a submission at EXACTLY retryAt — the instant the countdown shows 'go'", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-08-19T12:00:30.000Z"));
    settings({ classicCooldownSec: 30 });
    attemptRow("chal-1", { attempts: 1, lastAt: "2026-08-19T12:00:00.000Z" });
    evalReturns(["incorrect", "2"]);
    expect(await submitFlag("alice", "chal-1", "x")).toMatchObject({ ok: true, correct: false });
  } finally {
    vi.useRealTimers();
  }
});
```
Hint-penalty case join (RED today — lands with the case-fold fix), `hint-penalties.test.ts`:
```ts
it("matches a penalty to its row case-insensitively, like every other login join", async () => {
  mocks.getHintPenalties.mockResolvedValueOnce(new Map([["ada", 30]]));
  const result = await withHintPenalties(data([entry("Ada", 100)]));
  expect(result.entries[0].points).toBe(70);
  expect(result.entries[0].hintPenalty).toBe(30);
});
```
Quiz `AdminQuestion` type boundary, `quiz-store.test.ts`:
```ts
it("AdminQuestion is not assignable to Question", () => {
  // Compile-time guarantee — mirrors classic-store.test.ts's AdminChallenge check.
  // @ts-expect-error AdminQuestion must NOT be usable where Question is.
  const q: Question = {} as AdminQuestion;
  void q;
});
```

### 13. GITHUB_LOGIN differential corpus (kills S10/S11, pins copy agreement)
`test/fixtures/github-login-corpus.json`:
```json
{
  "accept": ["a", "octocat", "github-actions[bot]", "a-b-c", "0start",
             "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
             "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx[bot]"],
  "reject": ["", "a:b", "a b", "a\nb", "octocat\n", "-lead", "trail-", "dou--ble",
             "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
             "[bot]", "[bot]octocat", "oct[bot]ocat", "a-[bot]", "a[bot][bot]",
             "trail-[bot]", "oсtocat"]
}
```
`sync/test/github-login.differential.test.js`:
```js
// The GitHub-login grammar, sync half. The SAME regex is duplicated in
// scorer/src/serve.js and scorer/src/judge.js because the author becomes a
// Redis field segment there (ADR 6). Both sides run this shared corpus —
// agreeing with the corpus is agreeing with each other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseScoreComment } from "../src/parse.js";

const CORPUS = JSON.parse(
  readFileSync(new URL("../../test/fixtures/github-login-corpus.json", import.meta.url), "utf8"),
);
const CFG = { targets: ["dvwa"] };
const body = (author) =>
  `<!-- ctf-score: ${JSON.stringify({ author, target: "dvwa", solved: [], pr: 1, sha: "x" })} -->`;

test("every accepted login in the corpus parses", () => {
  const missed = CORPUS.accept.filter((a) => parseScoreComment(body(a), CFG) === null);
  assert.deepEqual(missed, []);
});

test("every rejected login in the corpus is refused", () => {
  const leaked = CORPUS.reject.filter((a) => parseScoreComment(body(a), CFG) !== null);
  assert.deepEqual(leaked, []);
});
```
Scorer half: identical shape driving `createHandler` through `serve.test.js`'s existing
`boot()`/`post()` helpers, asserting 202/400 per corpus side.

### 14. Truncated-marker taxonomy (with the parse.js fix, or as the ADR 38 decision-forcer)
`sync/test/drop-visibility.test.js` style:
```js
test("a marker truncated before its closing brace is a drop, not routine silence", async () => {
  const truncated = ghComment(6, `<!-- ctf-score: {"author":"octocat","target":"dvwa","sol`);
  const { state, posts } = await run([truncated]);
  assert.equal(posts.length, 0);
  assert.equal(state.dropped, 1, "ADR 38 counts truncation as invalid, not noMarker");
  assert.match(state.lastDrop, /unusable ctf-score marker/);
});
```

---

## Explicitly not recommended

Things a reviewer would normally flag here that should **not** be done, and why:

1. **Do not add testing-library** to fix "the click handler isn't tested." The repo's
  deliberate pattern (documented in test headers throughout) is renderToStaticMarkup for
  markup + exported pure helpers for client state — and the four-layer secrecy pins prove
  it reaches every layer that matters. The gaps found were missing tests in that style,
  not limits of the style.
2. **Do not replace the hand-rolled markdown renderer** with marked/markdown-it +
  DOMPurify. ADR 28's reasoning is that React-element output makes injection structurally
  impossible rather than sanitizer-maintained — and the attack battery confirmed it holds
  (`javascript:` with every obfuscation, `data:`, `//host`, entities: all dead at
  `markdown.ts:41-50`). A library reopens the `dangerouslySetInnerHTML` surface the ADR
  exists to close.
3. **Do not add an attempt cap to classic flag submission.** ADR 29: the flag space is
  arbitrary text, not enumerable; the cooldown (Lua-authoritative, organizer-tunable to
  3600s) is the designed lever. The finding here is to *test* the Lua, not to add a knob.
4. **Do not merge the two flag hashes** (`ctf:classic:flag`/`flagnorm`) or "simplify" the
  AdminChallenge/Challenge split. ADR 27: the type boundary is what makes "the contestant
  path never touches a flag" compiler-checked rather than discipline-maintained. Findings
  strengthen it (add the quiz `@ts-expect-error`), never collapse it.
5. **Do not DRY the three `outsideWindow` copies into a shared package.** ADR 32: three
  separately-deployed services with no shared dependency channel. The right fix is the
  differential corpus (§11), which is how this repo already handles two-language
  agreement (`setup/test/corpus/`, `targets.tsv`) — not a fourth artifact to version.
6. **Do not flip freeze/manual-pause reads to fail closed** "for safety." ADR 32 and
  AGENTS.md are explicit: a Redis blip must not drop live submissions; fail-open is the
  chosen direction. Finding 1 is the *restoration* of fail-open where quiz accidentally
  inverted it — not a precedent for the reverse.
7. **Do not change the team hint-penalty from SUM to union-dedupe** to "match
  foldTeamItems." `hint-penalties.ts:24-29` documents the asymmetry as deliberate (hints
  are per-person purchases) and it is pinned by test (`hint-penalties.test.ts:153-160`).
8. **Do not blanket-digest-pin the acceptance-script containers.** ADR 51 deliberately
  exempts test scaffolding from pinning. The finding is the *inconsistency* (two scripts
  pin srh, one doesn't) — pick one posture and note it in the ADR.
9. **Do not "discover" SHA-pinning of GitHub Actions as a new finding.** ADR 37's closing
  paragraph already deliberates tag-vs-SHA and tracks it as issue #49, with Dependabot's
  github-actions ecosystem as the compensating control. Doing it is fine; treating it as
  an unknown risk is re-litigating a written decision.
10. **Do not introduce jq/python into `setup/`** while fixing the bats gaps. The bash-3.2 /
  no-jq constraint is a hard rule (AGENTS.md); the proposed org-apply tests above stay
  inside pure-bash stubs for exactly that reason.
11. **Do not add a server-side filter/pagination contract to the activity log** while
  pinning finding 7. Client-side filtering over ≤5k short rows is the documented design
  (one pagination contract, not two).
