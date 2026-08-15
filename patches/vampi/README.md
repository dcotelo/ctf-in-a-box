# Reference patches — `patches/<target>/`

A **reference patch** is a minimal, real source fix that closes exactly one
challenge's vulnerability in a target app. It is the input to the
**positive-direction** scoring gate: proof that a *correctly patched* contestant
fork scores the points it should — the mirror of `stock-scores-zero`, which only
proves an *unpatched* app scores nothing.

## Why this exists

The kit scores a contestant by running executable `node:test` challenge suites
against their app. Each suite *exploits* a vulnerability and asserts the exploit
does **not** succeed, so a challenge scores as "patched" only when the vuln is
genuinely closed. `scripts/acceptance-target.sh` gates the negative direction
(stock app → `0 / N`). Nothing proved the other end: that a scorer which quietly
stopped awarding points for a real fix would be caught. These patches close that
gap.

## The convention

```
patches/<target>/<challenge-id>.patch
```

- `<challenge-id>` is the lowercased catalogue key
  (`Challenge-3-SQLi` → `challenge-3-sqli`), the same id the scorer reports and
  stores.
- Each file is a **`git`-format unified diff** rooted at the app source tree
  (`a/models/user_model.py`, …). The harness applies it with `git apply`.
- A patch fixes the vulnerability in **source**, such that the exploit fails
  **even with VAmPI's `vulnerable=1` runtime flag set** (the bring-up always sets
  it). Flipping the flag is not a fix — the patch must close the actual code path.
- The fix must be **surgical**: it closes its one challenge and leaves the app
  otherwise healthy and still vulnerable everywhere else. A patch that breaks the
  build or the app's boot would *also* stop the exploit — and score the challenge
  "patched" for the wrong reason. The harness rejects that (see below).

## How the harness uses them

`scripts/acceptance-patched.sh <target> <challenge-id>`:

1. Stages the pinned upstream source into a workspace (the same staging
   `acceptance-target.sh` uses — shared via `scripts/lib/acceptance-lib.sh`).
2. Applies `patches/<target>/<challenge-id>.patch` (`git apply --check` first, so
   a stale patch fails loudly instead of as a confusing build error).
3. Builds the fork from its own root `Dockerfile` — the same path a real
   contestant PR takes — and runs the judge.
4. Asserts the **positive** result: exactly the patched challenge is solved, its
   points equal the catalogue difficulty, and the other `N-1` challenges still
   fail.

### Anti-vacuous discipline

The harness distinguishes a *real* positive from a broken app that merely stopped
being exploitable:

- The judge writes `ctf-score.md` **only when every challenge was measured**. If
  the app stops answering mid-run the exec runner aborts and writes nothing (see
  `scorer/src/judge.js`, `run.aborted`). So the report existing at all proves all
  `N` challenges ran and reported — "1/N with the other 8 unreached" cannot occur.
- The harness then asserts exactly one `✅ Patched` and `N-1` `❌ Not yet`. A `❌`
  means that challenge's exploit *ran and succeeded* — the app is up and still
  genuinely vulnerable there.
- **Positive control.** The `N-1` failing challenges prove the app is live for
  every challenge *except* the patched one — so on their own they cannot tell
  "vuln closed" from "endpoint broke" for the `✅` row itself (an exploit test
  that only asserts the exploit is absent scores `✅` just as well if the patched
  route now 500s or was deleted). So after the `✅`, the harness boots the freshly
  built patched image standalone and probes the endpoint the patch touched: it
  must still return `200` with valid data. A broken endpoint FAILS the gate. The
  control is a `case` arm in `scripts/acceptance-patched.sh` keyed by challenge id
  (add one when you add a patch); together these three signals make the
  anti-vacuous guarantee symmetric — the patched row is proven live too, not just
  the others.

## Coverage — honest status

VAmPI is the **first and currently only** target with reference patches, and only
**2 of its 9 challenges** are covered:

| Challenge id                         | Points | File patched            | Fix |
| ------------------------------------ | :----: | ----------------------- | --- |
| `challenge-3-sqli`                   |   2    | `models/user_model.py`  | Parameterize the username lookup query (bind, don't interpolate) |
| `challenge-1-excessive-data-exposure`|   1    | `api_views/users.py`    | `/_debug` serializes only username/email, not the password/admin fields |

These two are enough to prove the **mechanism** — including that the assertion
**discriminates** (they patch different challenges in different files: patching
challenge-3 scores challenge-3 and *not* challenge-1, and vice versa). They are
**not** full coverage. The remaining seven VAmPI challenges, and the other five
targets, are follow-on work; each needs its own reference patch authored and
verified against a real build.

## Pinning

The VAmPI source pin (`VAMPI_UPSTREAM_REF` in `scripts/acceptance-patched.sh`) is
a **commit SHA**, never a branch or a bare tag — either could move and silently
score a different app. Bump it only together with a fresh run of the gate and a
re-verification (or regeneration) of every patch against the new tree.
