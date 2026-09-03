#!/usr/bin/env bash
# Proves a QUIZ-ONLY event.yaml (modules: { quiz: {} }, no secure-development
# at all) runs a whole event end to end, with no scorer/poll pipeline behind
# it. This is the standalone-module composition promise (docs/modules.md):
# a single module must be enough to run an event alone.
#
# Asserts:
#   - the compose line-up docs/hosting.md tells a quiz-only organizer to run
#     (`--profile app`) contains no secure-development service — no scorer to
#     pull, no poller — while the scored line-up still contains both
#   - the app builds and comes up bound to a quiz-only config (remember
#     EVENT_CONFIG_B64 is a BUILD-time arg — omitting it silently yields
#     neutral defaults, so this script never calls `docker build` without it)
#   - /quiz serves and shows a seeded question BY NAME
#   - /challenges 404s (module contract §5.4 — the route must not exist, not
#     just disappear from the nav; apps/web already pins this at the unit
#     level in app/(site)/challenges/__tests__/page-quiz-only.test.tsx, this
#     proves it through the real built app)
#   - /leaderboard shows a seeded contestant's quiz points BY LOGIN. A
#     quiz-only event always resolves the leaderboard source to "empty"
#     (lib/leaderboard/source.ts — secure-development disabled means no
#     scorer/lambda/upstash backend is even consulted), so a row landing here
#     at all can ONLY come from the module-contribution overlay reading real
#     quiz totals — this is the one assertion a vacuous "app never came up"
#     failure cannot fake (see the file header of scripts/acceptance-app.sh
#     and AGENTS.md's stock-scores-zero note for the same trap).
#   - `sync` exits 0 and STAYS exited rather than crash/restart-looping with
#     nothing to poll (sync/src/config.js + index.js's main(), and
#     docker-compose.yml's sync `restart: on-failure`)
#
# Seeding: no OAuth app exists in CI, and the DEMO_MODE 'Seed demo data'
# button is admin-session-gated (apps/web/src/app/api/admin/seed/route.ts) —
# faking that session is out of scope and not something any script in this
# repo does (dev-stack's own comment: it "does not fake or bypass that
# boundary"). Every existing acceptance/smoke script that needs
# admin-controlled state writes it straight to the same Redis the app reads
# (scripts/smoke.sh does this for ctf:admin:settings) rather than driving the
# authenticated route, and this script follows that precedent for the quiz
# module's exact real schema (key names from lib/quiz-keys.ts, question shape
# from lib/quiz-store.ts's `Question` type) — the same keys/shapes
# admin-store.ts's real seedDemoData would write, just written directly so
# the read side (getQuizTotals/listQuestions, exercised through the real
# built app) is what's actually under test.
#
# App: built directly via `docker build` (like acceptance-app.sh) and run
# standalone on a private network alongside real redis + srh images (the
# same ones docker-compose.yml pins) — a quiz-only event never touches the
# scorer, so there is nothing compose-shaped to gain by bringing it up too.
#
# sync: brought up through the REAL docker-compose.yml via `docker compose`
# (with only its event.yaml volume mount overridden to this script's scratch
# config) specifically so the restart-policy assertion below is testing the
# actual deployed policy, not a policy this script guessed and could drift
# from — the exact "on-failure vs. unless-stopped" concern Task 1 fixed.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/acceptance-lib.sh

NET=ctf-quiz-only-acceptance-net
TMP=$(mktemp -d)
SRH_TOKEN="quiz-only-acceptance-srh-token"
APP_PORT=3110

CFG="$TMP/event.yaml"
cat > "$CFG" <<'YAML'
event: { name: "Quiz Only Acceptance", start: 2026-10-01T09:00:00-03:00, end: 2026-10-01T18:00:00-03:00 }
github: { org: acceptance-quiz-org }
modules:
  quiz: {}
YAML

SYNC_OVERRIDE="$TMP/docker-compose.sync-override.yml"
cat > "$SYNC_OVERRIDE" <<OVERRIDE
services:
  sync:
    volumes:
      - "$CFG:/config/event.yaml:ro"
OVERRIDE

SYNC_PROJECT=ctf-quiz-only-sync-acceptance
sync_compose() {
  # Same requirement as compose_services above — the real docker-compose.yml
  # will not resolve without REDIS_PASSWORD.
  REDIS_PASSWORD="${REDIS_PASSWORD:-acceptance}" \
    docker compose -p "$SYNC_PROJECT" -f docker-compose.yml -f "$SYNC_OVERRIDE" "$@"
}

cleanup() {
  docker rm -f qo-app qo-redis qo-srh >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  sync_compose down -v --remove-orphans >/dev/null 2>&1 || true
  # `compose down` was observed to silently no-op in local testing (exits 0,
  # prints nothing, container survives) — belt-and-suspenders direct removal
  # so a stray sync container/volume/network never outlives this script even
  # when that happens.
  docker rm -f "${SYNC_PROJECT}-sync-1" >/dev/null 2>&1 || true
  docker volume rm "${SYNC_PROJECT}_sync-state" "${SYNC_PROJECT}_redis-data" >/dev/null 2>&1 || true
  docker network rm "${SYNC_PROJECT}_default" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# The DOCUMENTED quiz-only bring-up must be runnable as printed.
#
# This is a structural check on docker-compose.yml itself, deliberately made
# before anything heavy runs: the rest of this script builds and runs the app
# by hand (and brings sync up with --no-deps), so it can pass with flying
# colours while the command docs/hosting.md tells a quiz-only organizer to run
# is unrunnable. That is exactly what happened — `scorer` had no `profiles:`
# key and `app` depended on it, so the documented line-up tried to pull the
# maintainers' PRIVATE scorer image on an event that has no scorer at all.
#
# Both directions are asserted: quiz-only must not drag in secure-development's
# services, and the scored line-up must still contain them (a fix that merely
# hid the scorer everywhere would break every real event instead).
# ---------------------------------------------------------------------------
echo "--- the documented quiz-only profile set pulls no secure-development services"
compose_services() {
  # REDIS_PASSWORD is REQUIRED, not decorative: docker-compose.yml uses `:?`
  # on it, so without a value `config` fails — and stderr is discarded here,
  # which would turn that into an empty service list and a silently vacuous
  # comparison below.
  SRH_TOKEN=acceptance SCORER_TOKEN=acceptance BETTER_AUTH_SECRET=acceptance \
    REDIS_PASSWORD=acceptance \
    GITHUB_CLIENT_ID=acceptance GITHUB_CLIENT_SECRET=acceptance \
    docker compose -f docker-compose.yml "$@" config --services 2>/dev/null | sort | tr '\n' ' '
}
QUIZ_SERVICES=$(compose_services --profile app)
SCORED_SERVICES=$(compose_services --profile poll --profile app)
echo "    quiz-only (--profile app):            $QUIZ_SERVICES"
echo "    scored    (--profile poll + app):     $SCORED_SERVICES"
for svc in scorer sync; do
  case " $QUIZ_SERVICES " in
    *" $svc "*) echo "FAIL: '$svc' is in the quiz-only line-up — a quiz-only event has no $svc"; exit 1 ;;
  esac
done
for svc in app redis srh; do
  case " $QUIZ_SERVICES " in
    *" $svc "*) ;;
    *) echo "FAIL: '$svc' is missing from the quiz-only line-up"; exit 1 ;;
  esac
done
for svc in app redis srh scorer sync; do
  case " $SCORED_SERVICES " in
    *" $svc "*) ;;
    *) echo "FAIL: '$svc' is missing from the scored (poll) line-up"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# redis + srh (the exact images/config docker-compose.yml pins), on a private
# network. No scorer: a quiz-only event never resolves to a scored
# leaderboard source, so there is nothing here for it to serve.
# ---------------------------------------------------------------------------
docker network rm "$NET" >/dev/null 2>&1 || true
docker network create "$NET" >/dev/null

echo "--- booting redis + srh"
docker rm -f qo-redis qo-srh >/dev/null 2>&1 || true
docker run -d --name qo-redis --network "$NET" --network-alias redis \
  redis:7-alpine redis-server --appendonly yes >/dev/null
docker run -d --name qo-srh --network "$NET" --network-alias srh \
  -e SRH_MODE=env -e SRH_TOKEN="$SRH_TOKEN" -e SRH_CONNECTION_STRING=redis://redis:6379 \
  hiett/serverless-redis-http:latest@sha256:5b0bb9239fce53abf87b2018a7a0deb9ec7bd900c5360738fe5fbeeb426f9150 >/dev/null

echo "--- waiting for redis"
redis_deadline=$((SECONDS + 30))
until docker exec qo-redis redis-cli ping 2>/dev/null | grep -q PONG; do
  [ "$SECONDS" -ge "$redis_deadline" ] && { echo "FAIL: redis never answered"; exit 1; }
  sleep 1
done

# ---------------------------------------------------------------------------
# Seed the quiz's real Redis schema directly (see header comment for why).
# Key names/shapes are the canonical ones from apps/web/src/lib/quiz-keys.ts
# (ctf:quiz:questions, ctf:quiz:key, ctf:quiz:answers:<login>, ctf:quiz:points,
# ctf:quiz:answered) — this duplication fails CLOSED, not silently: a renamed
# key or a value shape parseQuestion()/parseCounterHash() (quiz-store.ts)
# rejects yields a blank /quiz or /leaderboard and a failed grep below, never
# a silent pass.
#
# One question (price 137) and one contestant. The contestant's TOTAL is a
# separate, deliberately larger figure (4321, >= 1000 so
# entry.points.toLocaleString() — leaderboard.tsx — comma-formats it to
# "4,321") specifically so the /leaderboard assertion below can tell "the
# totals hash" apart from "the question's own price": both would otherwise
# render as the same bare "137", and a bare unanchored grep for either could
# also coincidentally match a chunk id/hash elsewhere on the page.
#
# `ctf:quiz:key` and `ctf:quiz:answers:<login>` are seeded here for realism
# (a real answer always writes all five keys together) but NOT independently
# asserted below — this script never exercises grading, so their shapes are
# not verified by anything here.
# ---------------------------------------------------------------------------
QUESTION_ID="acceptance-xss-basics"
QUESTION_PROMPT="ACCEPTANCE-GATE-QUESTION: what does XSS stand for?"
QUESTION_POINTS=137
CONTESTANT_LOGIN="quiz-acceptance-bot"
CONTESTANT_POINTS=4321
CONTESTANT_POINTS_FORMATTED="4,321"

echo "--- seeding one quiz question + one contestant's answer"
docker exec qo-redis redis-cli HSET ctf:quiz:questions "$QUESTION_ID" \
  '{"id":"acceptance-xss-basics","prompt":"'"$QUESTION_PROMPT"'","type":"single","choices":[{"id":"a","label":"Cross-Site Scripting"},{"id":"b","label":"XML Signature Exchange"}],"points":'"$QUESTION_POINTS"',"order":1}' \
  >/dev/null
docker exec qo-redis redis-cli HSET ctf:quiz:key "$QUESTION_ID" '["a"]' >/dev/null
docker exec qo-redis redis-cli HSET "ctf:quiz:answers:$CONTESTANT_LOGIN" "$QUESTION_ID" \
  '{"choices":["a"],"points":'"$QUESTION_POINTS"',"at":"2026-08-19T00:00:00.000Z"}' >/dev/null
docker exec qo-redis redis-cli HSET ctf:quiz:points "$CONTESTANT_LOGIN" "$CONTESTANT_POINTS" >/dev/null
docker exec qo-redis redis-cli HSET ctf:quiz:answered "$CONTESTANT_LOGIN" 1 >/dev/null

# ---------------------------------------------------------------------------
# Build + boot the app bound to the quiz-only config. EVENT_CONFIG_B64 is a
# BUILD-time arg (apps/web/Dockerfile) — always pass it, never fall through
# to the neutral-default build.
# ---------------------------------------------------------------------------
echo "--- building app with the quiz-only event.yaml baked in"
B64=$(base64 < "$CFG" | tr -d '\n')
docker build -f apps/web/Dockerfile -t ctf-web:quiz-only-acceptance --build-arg EVENT_CONFIG_B64="$B64" .

echo "--- booting the app"
docker rm -f qo-app >/dev/null 2>&1 || true
docker run -d --name qo-app --network "$NET" -p "$APP_PORT:3000" \
  -e BETTER_AUTH_SECRET=quiz-only-acceptance-secret-32-characters-min \
  -e BETTER_AUTH_URL="http://localhost:$APP_PORT" \
  -e UPSTASH_REDIS_REST_URL=http://srh:80 \
  -e UPSTASH_REDIS_REST_TOKEN="$SRH_TOKEN" \
  ctf-web:quiz-only-acceptance >/dev/null

APP_URL="http://localhost:$APP_PORT"
echo "--- waiting for /quiz to serve (also waits out srh's startup lag — a"
echo "    quiz read that hits srh before it's bound would 500, not hang)"
acc_wait_http "$APP_URL" 90 /quiz || {
  echo "FAIL: /quiz never returned 200"
  docker logs qo-app 2>&1 | tail -80
  exit 1
}

echo "--- /quiz shows the seeded question by name"
QUIZ_HTML=$(curl -sf "$APP_URL/quiz")
# Guarded, not bare: a bare `grep -q` under `set -e` exits with no message at
# all — the failure mode acceptance-classic-only.sh documents having hit in CI.
if ! echo "$QUIZ_HTML" | grep -qF "$QUESTION_PROMPT"; then
  echo "FAIL: /quiz does not show the seeded question '$QUESTION_PROMPT'"
  exit 1
fi

echo "--- /challenges 404s (no secure-development module — must not exist,"
echo "    not just be hidden from the nav)"
CHALLENGES_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/challenges")
[ "$CHALLENGES_CODE" = "404" ] || { echo "FAIL: /challenges returned $CHALLENGES_CODE, want 404"; exit 1; }

echo "--- /leaderboard shows the seeded contestant by login, with their quiz points"
LEADERBOARD_HTML=$(curl -sf "$APP_URL/leaderboard")
if ! echo "$LEADERBOARD_HTML" | grep -qF "$CONTESTANT_LOGIN"; then
  echo "FAIL: /leaderboard has no row for $CONTESTANT_LOGIN — a contestant whose" >&2
  echo "      only points are quiz points did not get a row created at all." >&2
  exit 1
fi

# The formatted TOTAL, matched across the whole page rather than inside a
# window around the login.
#
# This used to extract a fixed-width window (chained `.{0,200}` quantifiers,
# sized from an empirically measured ~350-char gap between the login and the
# total) and search inside it. That measurement is a property of one machine's
# rendered markup, not of the app: it held locally and broke in CI, where the
# gap falls outside the window and the assertion failed with no message at all
# — the job printed the step banner and died under `set -e`.
#
# A whole-page match is safe here because the expected string carries a
# thousands separator (`4,321`). The coincidence the window was defending
# against is a digit run in a chunk id, hash or asset query — none of which
# contain commas. And CONTESTANT_POINTS is deliberately chosen to differ from
# every seeded question price, so this still cannot be satisfied by the
# questions hash rendering instead of the totals hash.
if ! echo "$LEADERBOARD_HTML" | grep -qF "$CONTESTANT_POINTS_FORMATTED"; then
  echo "FAIL: /leaderboard shows $CONTESTANT_LOGIN but not their quiz total" >&2
  echo "      ($CONTESTANT_POINTS_FORMATTED) — the row exists, so the module" >&2
  echo "      overlay ran, but the points did not reach it." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# sync: through the real docker-compose.yml (see header comment for why),
# only overriding its event.yaml mount. Must exit 0 and STAY exited — not
# merely exit once and then get restarted by a too-eager restart policy.
# ---------------------------------------------------------------------------
echo "--- bringing up sync (poll profile) against the quiz-only config"
sync_compose --profile poll up -d --build --no-deps sync


# `ps -q` (running only) races a fast-exiting container — exactly what this
# script expects sync to do — and can come back empty even though sync
# started and already exited cleanly, misreporting a PASS as "never
# started". `ps -aq` includes exited containers too.
SYNC_CID=$(sync_compose ps -aq sync)
[ -n "$SYNC_CID" ] || { echo "FAIL: sync container never started"; exit 1; }

echo "--- waiting for sync to exit"
exit_deadline=$((SECONDS + 30))
until [ "$(docker inspect -f '{{.State.Running}}' "$SYNC_CID")" = "false" ]; do
  [ "$SECONDS" -ge "$exit_deadline" ] && {
    echo "FAIL: sync never exited (still running with nothing to poll)"
    sync_compose logs sync
    exit 1
  }
  sleep 1
done

SYNC_EXIT_CODE=$(docker inspect -f '{{.State.ExitCode}}' "$SYNC_CID")
[ "$SYNC_EXIT_CODE" = "0" ] || {
  echo "FAIL: sync exited $SYNC_EXIT_CODE, want 0"
  sync_compose logs sync
  exit 1
}

echo "--- sync logged the clean no-op reason (not a swallowed crash)"
sync_compose logs sync 2>&1 | grep -qF "ctf-sync: no polled module enabled, nothing to do"

echo "--- confirming sync STAYS exited (on-failure, not unless-stopped —"
echo "    a too-eager restart policy would turn this clean exit into a"
echo "    silent restart-loop; sampled 4 times over ~9s)"
i=0
while [ "$i" -lt 4 ]; do
  sleep 3
  running=$(docker inspect -f '{{.State.Running}}' "$SYNC_CID" 2>/dev/null || echo "gone")
  restarts=$(docker inspect -f '{{.RestartCount}}' "$SYNC_CID" 2>/dev/null || echo "?")
  [ "$running" = "false" ] || { echo "FAIL: sync is running again (restarted) — RestartCount=$restarts"; exit 1; }
  [ "$restarts" = "0" ] || { echo "FAIL: sync's RestartCount is $restarts, want 0 (it restarted)"; exit 1; }
  i=$((i + 1))
done

echo "ACCEPTANCE PASS (quiz-only event)"
