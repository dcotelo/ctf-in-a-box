#!/usr/bin/env bash
# Proves a kit event.yaml drives the vendored app: custom name + reduced
# target set visible in the built app; default build is neutral OWASP CTF.
# Also proves the app's challenge fork links follow event.yaml's github.org
# rather than a hardcoded OWASP-CTF (self-hosted contestants must fork the
# org the kit actually created, not the upstream canonical one).
#
# ChallengeGrid (the /challenges app list) is a Client Component, but
# /challenges is statically prerendered at build time, so Next.js still emits
# the rendered app names into the server HTML response body — no need to
# fall back to grepping the flight/__NEXT_DATA__ payload separately.
set -euo pipefail
cd "$(dirname "$0")/.."

CFG=$(mktemp)
cat > "$CFG" <<'YAML'
event: { name: "Acceptance CTF", start: 2026-10-01T09:00:00-03:00, end: 2026-10-01T18:00:00-03:00, url: http://localhost }
github: { org: acceptance-org }
modules:
  secure-development:
    targets: [dvwa, vampi]
YAML

cleanup() {
  docker rm -f web-acceptance web-default >/dev/null 2>&1 || true
  rm -f "$CFG"
}
trap cleanup EXIT

# Waits (up to ~60s) for a container to answer GET / and prints the body.
wait_for_html() {
  local url=$1 deadline=$((SECONDS + 60))
  until curl -sf "$url" 2>/dev/null; do
    [ "$SECONDS" -ge "$deadline" ] && { echo "FAIL: $url never came up"; return 1; }
    sleep 1
  done
}

B64=$(base64 < "$CFG" | tr -d '\n')
docker build -f apps/web/Dockerfile -t ctf-web:acceptance --build-arg EVENT_CONFIG_B64="$B64" .
docker run -d --name web-acceptance -p 3100:3000 \
  -e BETTER_AUTH_SECRET=acceptance-app-secret-32-characters-min -e BETTER_AUTH_URL=http://localhost:3100 ctf-web:acceptance

HOME_HTML=$(wait_for_html http://localhost:3100/)
CHALLENGES_HTML=$(wait_for_html http://localhost:3100/challenges)

echo "--- custom event name renders"
echo "$HOME_HTML" | grep -q "Acceptance CTF"
echo "--- no DC34 branding"
if echo "$HOME_HTML$CHALLENGES_HTML" | grep -qi "DEF CON"; then echo "FAIL: DC34 leaked"; exit 1; fi
echo "--- only enabled targets appear"
echo "$CHALLENGES_HTML" | grep -q "DVWA"
echo "$CHALLENGES_HTML" | grep -q "VAmPI"
if echo "$CHALLENGES_HTML" | grep -q "WebGoat"; then echo "FAIL: disabled target rendered"; exit 1; fi

echo "--- fork links use event.yaml's github.org, not a hardcoded OWASP-CTF"
echo "$CHALLENGES_HTML" | grep -q "github.com/acceptance-org/DVWA"
echo "$CHALLENGES_HTML" | grep -q "github.com/acceptance-org/VAmPI"
if echo "$CHALLENGES_HTML" | grep -q "github.com/OWASP-CTF/"; then
  echo "FAIL: custom-org build still links OWASP-CTF forks"; exit 1
fi

echo "--- default build is neutral (no DEF CON, name OWASP CTF)"
docker build -f apps/web/Dockerfile -t ctf-web:default-check . >/dev/null
docker run -d --name web-default -p 3101:3000 \
  -e BETTER_AUTH_SECRET=acceptance-app-secret-32-characters-min -e BETTER_AUTH_URL=http://localhost:3101 ctf-web:default-check
DEFAULT_HTML=$(wait_for_html http://localhost:3101/)
DEFAULT_CHALLENGES_HTML=$(wait_for_html http://localhost:3101/challenges)
if echo "$DEFAULT_HTML" | grep -qi "DEF CON"; then echo "FAIL: default build carries DC34"; exit 1; fi
echo "$DEFAULT_HTML" | grep -q "OWASP CTF"

echo "--- default build's fork links fall back to OWASP-CTF"
echo "$DEFAULT_CHALLENGES_HTML" | grep -q "github.com/OWASP-CTF/"

echo "ACCEPTANCE PASS"
