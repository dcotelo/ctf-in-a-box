#!/usr/bin/env bash
# Offline e2e: mock-github -> sync -> mock-scorer -> leaderboard.
# Proves the poll pipeline (trust filter included) with zero external services.
set -euo pipefail
cd "$(dirname "$0")/.."

export SRH_TOKEN=smoke-srh SCORER_TOKEN=smoke-scorer GITHUB_PAT=smoke-pat
compose() { docker compose -f docker-compose.yml -f docker-compose.smoke.yml --profile poll "$@"; }

# Fixture comments cover dvwa + juice-shop; write a minimal matching config to
# a scratch file — never the organizer's real event.yaml. docker-compose.smoke.yml
# mounts this over /config/event.yaml in the sync service (compose merges the
# sync service's volumes list by target path, so this override replaces the
# base compose file's ./event.yaml bind rather than stacking alongside it).
cat > .smoke-event.yaml <<'YAML'
github: { org: evt-org }
modules:
  secure-development:
    targets: [juice-shop, dvwa]
YAML

cleanup() { compose down -v --remove-orphans >/dev/null 2>&1 || true; rm -f .smoke-event.yaml; }
trap cleanup EXIT

compose up -d --build redis srh scorer mock-github sync

echo "--- redis answers"
compose exec -T redis redis-cli ping | grep -q PONG

echo "--- srh proxies redis (upstash REST contract)"
compose exec -T redis redis-cli set smoke-key smoke-val >/dev/null
# hiett/serverless-redis-http (srh) does not implement upstash's path-style
# GET shortcut (GET /get/<key> returns 404) — only the body/command-array
# form the @upstash/redis SDK uses (POST / with a JSON array) is supported.
# srh's Erlang VM also takes a beat past "compose up" returning to bind its
# listener, so retry a few times instead of asserting on the first attempt.
srh_deadline=$((SECONDS + 15))
until compose run --rm --no-deps --entrypoint sh sync -c \
  "wget -qO- --header='Authorization: Bearer ${SRH_TOKEN}' --header='Content-Type: application/json' --post-data='[\"GET\",\"smoke-key\"]' http://srh:80/" \
  2>/dev/null | grep -q smoke-val; do
  [ "$SECONDS" -ge "$srh_deadline" ] && { echo "FAIL: srh never proxied redis"; compose logs srh; exit 1; }
  sleep 1
done

echo "--- sync ingests fixture comments (waiting up to 30s)"
deadline=$((SECONDS + 30))
until curl -sf http://localhost:4000/leaderboard | grep -q '"octocat"'; do
  [ "$SECONDS" -ge "$deadline" ] && { echo "FAIL: octocat never appeared"; compose logs sync; exit 1; }
  sleep 2
done

board=$(curl -sf http://localhost:4000/leaderboard)
echo "$board"

echo "--- scores match fixtures (1 point per solved id)"
echo "$board" | grep -q '"author":"octocat","points":2'
echo "$board" | grep -q '"author":"mona","points":1'

echo "--- forged comment from mallory was ignored (trust filter)"
if echo "$board" | grep -q '"author":"mallory"'; then
  echo "FAIL: forged comment was scored"; exit 1
fi

echo "--- unauthenticated POST /score rejected"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:4000/score \
  -H 'content-type: application/json' -d '{"author":"evil","target":"dvwa","solved":["x"]}')
[ "$code" = "401" ]

echo "--- organizer freeze holds ingestion (poll mode)"
# The app isn't in this smoke profile (only redis/srh/scorer/mock-github/sync
# are brought up), so there's no /api/admin/settings route to call here.
# Set the pause flag straight on the same ctf:admin:settings hash the sync
# poller reads (sync/src/redis.js isPaused()) — the write path differs from
# the dashboard's, but the read path the poller exercises is identical, so
# this genuinely proves the poll-mode freeze, not just a Redis fact.
compose exec -T redis redis-cli HSET ctf:admin:settings paused 1 >/dev/null

echo "--- sync heartbeat reports paused (waiting up to 15s)"
pause_deadline=$((SECONDS + 15))
until compose exec -T redis redis-cli HGET ctf:sync:status paused 2>/dev/null | grep -q '^1$'; do
  [ "$SECONDS" -ge "$pause_deadline" ] && { echo "FAIL: sync never reported paused"; compose logs sync; exit 1; }
  sleep 1
done

# Queue a fresh score comment behind the flag: mock-github serves it only
# once this marker file exists (test/fixtures/mock-github.mjs), simulating a
# contributor's PR getting scored while the organizer is holding ingestion.
compose exec -T mock-github touch /tmp/extra-comment >/dev/null

echo "--- paused poller does not ingest the queued score (holding 5s)"
sleep 5
board=$(curl -sf http://localhost:4000/leaderboard)
if echo "$board" | grep -q '"author":"trinity"'; then
  echo "FAIL: trinity was scored while paused"; exit 1
fi
compose exec -T redis redis-cli HGET ctf:sync:status paused 2>/dev/null | grep -q '^1$' \
  || { echo "FAIL: ctf:sync:status paused was not 1 after the hold"; exit 1; }

echo "--- clearing the freeze resumes ingestion"
compose exec -T redis redis-cli HDEL ctf:admin:settings paused >/dev/null

echo "--- queued score is ingested once unpaused (waiting up to 15s)"
resume_deadline=$((SECONDS + 15))
until curl -sf http://localhost:4000/leaderboard | grep -q '"trinity"'; do
  [ "$SECONDS" -ge "$resume_deadline" ] && { echo "FAIL: trinity never appeared after unpausing"; compose logs sync; exit 1; }
  sleep 1
done
curl -sf http://localhost:4000/leaderboard | grep -q '"author":"trinity","points":1' \
  || { echo "FAIL: trinity's score did not match the queued fixture"; exit 1; }
compose exec -T redis redis-cli HGET ctf:sync:status paused 2>/dev/null | grep -q '^0$' \
  || { echo "FAIL: ctf:sync:status paused was not 0 after resuming"; exit 1; }

echo "SMOKE PASS"
