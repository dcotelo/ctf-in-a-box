#!/usr/bin/env bash
# Offline e2e: mock-github -> sync -> mock-scorer -> leaderboard.
# Proves the poll pipeline (trust filter included) with zero external services.
set -euo pipefail
cd "$(dirname "$0")/.."

export SRH_TOKEN=smoke-srh SCORER_TOKEN=smoke-scorer GITHUB_PAT=smoke-pat
compose() { docker compose -f docker-compose.yml -f docker-compose.smoke.yml --profile poll "$@"; }

# Fixture comments cover dvwa + juice-shop; write a minimal matching config.
cat > event.yaml <<'YAML'
github: { org: evt-org }
modules:
  secure-development:
    targets: [juice-shop, dvwa]
YAML

cleanup() { compose down -v --remove-orphans >/dev/null 2>&1 || true; }
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

echo "SMOKE PASS"
