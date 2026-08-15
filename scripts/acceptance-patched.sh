#!/usr/bin/env bash
# Patched-scores-right gate — the POSITIVE direction of scoring verification.
#
# Sibling to acceptance-target.sh. That script proves a STOCK app scores 0/N
# (no free points). This one proves the opposite end: a *correctly patched*
# contestant fork scores EXACTLY the patched challenge — its points equal the
# catalogue difficulty, and every other challenge still fails. Nothing else in
# the kit proves the positive direction, so a scorer that silently stopped
# awarding points for a real fix would pass every existing gate.
#
# Usage: scripts/acceptance-patched.sh <target> <challenge-id>
#   e.g. scripts/acceptance-patched.sh vampi challenge-3-sqli
#
# It stages the pinned upstream source (the same source path acceptance-target.sh
# exercises), applies patches/<target>/<challenge-id>.patch — a reference fix that
# closes ONE challenge's vulnerability in SOURCE — builds the fork from its own
# Dockerfile, runs the judge, and asserts the positive result.
#
# THE ANTI-VACUOUS-ZERO DISCIPLINE. A patch that breaks the build or the app's
# boot ALSO stops the exploit, which would score the challenge "patched" for the
# wrong reason while the whole app is down. This gate refuses that outcome:
#   * The judge only writes ctf-score.md when the exec runner measured EVERY
#     challenge; if the app stops answering the run aborts and NO report is
#     written (see scorer/src/judge.js "run.aborted"). So a report existing at
#     all proves all N challenges ran and reported.
#   * We then assert exactly ONE ✅ and (N-1) ❌. A ❌ means that challenge's
#     exploit child ran and the exploit SUCCEEDED — i.e. the app is up and still
#     genuinely vulnerable there. "1/9 with the other 8 unreached" cannot pass:
#     unreached challenges abort the run and produce no report.
#   * We assert the ✅ is the challenge we patched and its points equal the
#     catalogue difficulty (parsed independently from the catalogue JSON).
#   * POSITIVE CONTROL. The other-8-fail check proves the app is live for every
#     challenge EXCEPT the patched one — so on its own it cannot tell "vuln
#     closed" from "endpoint broke" for the ✅ row itself (a challenge whose
#     exploit test only asserts the exploit is absent scores ✅ just as well if
#     the route 500s or is deleted). So after the ✅ we boot the freshly built
#     patched image standalone and probe the endpoint the patch touched: it must
#     still return 200 with valid data. A broken endpoint FAILS the gate here.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/acceptance-lib.sh

TARGET="${1:?usage: $0 <target> <challenge-id>}"
CHALLENGE="${2:?usage: $0 <target> <challenge-id>}"

# Only VAmPI has reference patches today (see patches/vampi/README.md). Fail
# loudly rather than silently staging the wrong tree for another target.
if [ "$TARGET" != "vampi" ]; then
  echo "FAIL: $TARGET has no reference patches yet — vampi is the only target with a"
  echo "patches/<target>/ directory. See patches/vampi/README.md."
  exit 1
fi

PATCH="patches/$TARGET/$CHALLENGE.patch"
[ -f "$PATCH" ] || { echo "FAIL: no reference patch at $PATCH"; exit 1; }
PATCH_ABS="$PWD/$PATCH"

CATALOGUE="scorer/rubric.owasp/$TARGET/tests/challenges/catalogue.$TARGET.json"
[ -f "$CATALOGUE" ] || { echo "FAIL: no catalogue at $CATALOGUE"; exit 1; }

# Pinned upstream VAmPI SOURCE. Pinned to a COMMIT (verified to exist on
# erev0s/VAmPI on 2026-08-14, HEAD of master at the time), never a branch or a
# bare tag: a branch moves and a tag can be re-pointed, either of which would
# silently score a different app on some later run. VAmPI ships a root
# Dockerfile at this commit, so the workspace-Dockerfile build path in
# scorer/entrypoints/vampi.sh fires — the same path a real contestant fork takes.
# Bump only together with a fresh run of this gate and both reference patches.
VAMPI_UPSTREAM_REPO="${VAMPI_UPSTREAM_REPO:-erev0s/VAmPI}"
VAMPI_UPSTREAM_REF="${VAMPI_UPSTREAM_REF:-f16052dce83f05847133ec98f01c5193a41de7d8}"

IMG="ctf-score:acceptance-$TARGET"
NET="ctf-acceptance-$TARGET"
TMP="$(mktemp -d)"
WS="$TMP/workspace"
mkdir -p "$WS"

CTRL_IMG="ctf-fork-$TARGET-control"
CTRL_NAME="ctf-ctrl-$TARGET"
cleanup() {
  docker rm -f "ctf-app-$TARGET" "$CTRL_NAME" >/dev/null 2>&1 || true
  docker rmi -f "$CTRL_IMG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

acc_build_scorer "$IMG"
docker network create --internal "$NET" >/dev/null 2>&1 || true
acc_url_for "$TARGET"

acc_stage_source "$WS" "$VAMPI_UPSTREAM_REPO" "$VAMPI_UPSTREAM_REF"

echo "Applying reference patch $PATCH …"
# git apply, because the staged tree is a git repo (acc_stage_source init/fetches
# it) and the patch is a git-format diff. --check first so a stale patch fails
# here with a clear message rather than as a confusing build error later.
git -C "$WS" apply --check "$PATCH_ABS" || {
  echo "FAIL: $PATCH does not apply cleanly to $VAMPI_UPSTREAM_REPO@${VAMPI_UPSTREAM_REF:0:12}."
  echo "The pin moved out from under the patch, or the patch is stale — regenerate it."
  exit 1
}
git -C "$WS" apply "$PATCH_ABS"

# Belt-and-braces: the Dockerfile must survive staging+patch, or the bring-up
# would fall through to the no-source error and the run would look like a
# packaging bug instead of a patch problem.
[ -f "$WS/Dockerfile" ] || { echo "FAIL: workspace lost its Dockerfile after patching"; exit 1; }

acc_write_event "$TMP/event.json"

echo "Scoring PATCHED $TARGET fork ($CHALLENGE) — expecting exactly that challenge solved…"
APP_IMAGE="" acc_run_judge

REPORT="$WS/ctf-score.md"
# The judge writes this ONLY when every challenge was measured (an aborted run —
# the app stopped answering — throws and writes nothing). So its very existence
# is the first anti-vacuous signal: all challenges ran and reported.
[ -f "$REPORT" ] || {
  echo
  echo "FAIL: no ctf-score.md produced. The exec runner aborts (and writes no report)"
  echo "when the app stops answering mid-run — a broken/booted-down patched app lands"
  echo "here, NOT at a vacuous 1/N. Check the judge output above."
  exit 1
}

echo
echo "----- ctf-score.md -----"
cat "$REPORT"
echo "------------------------"

SCORE="$(acc_score_counts "$REPORT")"
SOLVED_N="${SCORE% *}"
TOTAL_N="${SCORE#* }"

# The solved ids, authoritative, from the report's machine-readable marker:
#   <!-- ctf-score: {"author":...,"solved":["challenge-3-sqli"],...} -->
SOLVED_JSON="$(sed -n 's/.*"solved":\[\([^]]*\)\].*/\1/p' "$REPORT")"

# Count the result cells directly (fixed-string, emoji-safe on BSD and GNU).
N_PATCHED="$(grep -Fc '✅ Patched' "$REPORT" || true)"
N_NOTYET="$(grep -Fc '❌ Not yet' "$REPORT" || true)"

# Expected points = the catalogue difficulty for THIS challenge id. Parsed from
# the catalogue JSON here (the entries are one field per line); the id is the
# lowercased catalogue key. Independent of the scorer's own loader, so comparing
# it to the report's points cross-checks the two paths.
EXPECTED_PTS="$(awk -v id="$CHALLENGE" '
  /"key":/ { v=$0; sub(/.*"key":[[:space:]]*"/,"",v); sub(/".*/,"",v); f=(tolower(v)==id) }
  f && /"difficulty":/ { d=$0; sub(/[^0-9]*/,"",d); sub(/[^0-9].*/,"",d); print d; f=0 }
' "$CATALOGUE")"
[ -n "$EXPECTED_PTS" ] || { echo "FAIL: challenge id '$CHALLENGE' not found in $CATALOGUE"; exit 1; }

# Points shown in the report for the one ✅ row.
PATCHED_ROW="$(grep -F '✅ Patched' "$REPORT" || true)"
PATCHED_PTS="$(printf '%s\n' "$PATCHED_ROW" | sed -n 's/^|[^|]*|[[:space:]]*\([0-9][0-9]*\)[[:space:]]*|.*/\1/p')"

echo
echo "patched $TARGET/$CHALLENGE scored $SOLVED_N / $TOTAL_N"
echo "  solved ids: [$SOLVED_JSON]"
echo "  ✅ Patched cells: $N_PATCHED    ❌ Not yet cells: $N_NOTYET"
echo "  expected points (catalogue difficulty): $EXPECTED_PTS    reported points: ${PATCHED_PTS:-<none>}"

fail() { echo; echo "FAIL: $1"; exit 1; }

[ "$TOTAL_N" = "9" ] || fail "expected 9 challenges total, saw $TOTAL_N — is the rubric wired up?"
# Exactly one solved, and it is the challenge we patched (not a different one).
[ "$SOLVED_N" = "1" ] || fail "expected exactly 1 challenge solved, saw $SOLVED_N."
[ "$N_PATCHED" = "1" ] || fail "expected exactly 1 ✅ Patched cell, saw $N_PATCHED."
[ "$SOLVED_JSON" = "\"$CHALLENGE\"" ] || fail "the solved challenge is [$SOLVED_JSON], not the patched \"$CHALLENGE\"."
# Anti-vacuous: the OTHER 8 must be present AND genuinely failed (a ❌ cell means
# that exploit ran and succeeded). 8 ❌ cells rules out "the others never ran".
[ "$N_NOTYET" = "8" ] || fail "expected 8 ❌ Not yet cells (the other challenges still exploitable), saw $N_NOTYET — the app may be broken/unreached rather than serving."
# Points equal the catalogue difficulty.
[ "$PATCHED_PTS" = "$EXPECTED_PTS" ] || fail "patched challenge scored $PATCHED_PTS points, expected catalogue difficulty $EXPECTED_PTS."

# --- Positive control ----------------------------------------------------------
# The checks above prove the app is live for every challenge EXCEPT the patched
# one. They CANNOT tell "vuln closed" from "endpoint broke" for the ✅ row: an
# exploit test that only asserts the exploit is absent scores ✅ just as well if
# the patched route now 500s or was deleted. So boot the freshly built patched
# image standalone and prove the endpoint the patch touched still SERVES valid
# data. A broken endpoint FAILS here — the exact vacuous win the gate exists for.
echo
echo "Positive control: booting the patched fork standalone to prove $CHALLENGE's endpoint still serves…"
docker build -q -t "$CTRL_IMG" "$WS" >/dev/null   # cache-hot: the judge already built these layers
CTRL_BASE="$(acc_boot_standalone "$CTRL_IMG" "$CTRL_NAME" 5000)" || fail "could not boot the patched fork for the positive control."
acc_wait_http "$CTRL_BASE" || fail "the patched fork never became reachable for the positive control ($CTRL_BASE) — the patch may break the app's boot."
# VAmPI boots with an empty DB; /createdb drop+create+reseeds it. Seed, then give
# the reseed a moment before probing.
curl -s -o /dev/null "$CTRL_BASE/createdb" || true
sleep 2

CTRL_BODY="$TMP/control-body.json"
case "$CHALLENGE" in
  challenge-1-excessive-data-exposure)
    code="$(curl -s -o "$CTRL_BODY" -w '%{http_code}' "$CTRL_BASE/users/v1/_debug")"
    [ "$code" = "200" ] || fail "positive control: GET /users/v1/_debug returned $code, not 200 — the patch broke/removed the endpoint instead of closing the leak."
    grep -q '"users"' "$CTRL_BODY" || fail "positive control: /_debug returned no users array — the patch gutted the endpoint rather than filtering it."
    grep -q 'name1' "$CTRL_BODY" || fail "positive control: /_debug served no seeded user — the endpoint returns no real data."
    if grep -q 'password' "$CTRL_BODY"; then fail "positive control: /_debug STILL contains a password field — the fix did not actually close the leak."; fi
    echo "  control OK: GET /users/v1/_debug → 200, serves users (username/email present), no password field."
    ;;
  challenge-3-sqli)
    code="$(curl -s -o "$CTRL_BODY" -w '%{http_code}' "$CTRL_BASE/users/v1/name1")"
    [ "$code" = "200" ] || fail "positive control: GET /users/v1/name1 (a benign real lookup) returned $code, not 200 — the patch broke the endpoint."
    grep -q 'name1' "$CTRL_BODY" || fail "positive control: benign lookup for name1 served no user — the endpoint returns no real data."
    echo "  control OK: GET /users/v1/name1 → 200, a benign real lookup still resolves (the SQLi test also controls the injected-payload → 404 path)."
    ;;
  *)
    fail "no positive control defined for $CHALLENGE — add a case arm here before shipping its patch."
    ;;
esac
docker rm -f "$CTRL_NAME" >/dev/null 2>&1 || true

echo
echo "PASS: patched $TARGET fork solves exactly $CHALLENGE for $EXPECTED_PTS point(s);"
echo "      the other 8 challenges ran and still fail (app up and still vulnerable there);"
echo "      and the patched endpoint still serves valid data (positive control passed)."
