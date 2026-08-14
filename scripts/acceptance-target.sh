#!/usr/bin/env bash
# Stock-scores-zero gate (docs/modules.md §6.4) against a REAL target.
#
# Boots the stock, unpatched upstream image and scores the vendored rubric
# against it. Every challenge MUST fail: a vendored test that passes here is a
# free point for every contestant, which is the exact failure the golden rule
# ("assert the fix, not the exploit") exists to prevent.
#
# Usage: scripts/acceptance-target.sh <target> <stock-image>
#
# <stock-image> may be the literal `none`, meaning "this target HAS no published stock
# image — its bring-up builds the pinned upstream source instead". That is not a
# convenience: securityshepherd genuinely has none (`owaspsecurityshepherd/shepherd`
# does not exist, and `owasp/security-shepherd` was last pushed in 2018, years before
# the release-17 tree the rubric targets), which is why upstream's own six-target CI
# matrix leaves that one row's app-image empty. `none` becomes an empty APP_IMAGE,
# which keeps the two-argument contract intact and states the intent at the call site
# instead of overloading a missing argument. A target whose bring-up cannot build from
# source still fails loudly on the empty APP_IMAGE, exactly as it does today.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:?usage: $0 <target> <stock-image|none>}"
STOCK_IMAGE="${2:?usage: $0 <target> <stock-image|none>}"
if [ "$STOCK_IMAGE" = "none" ]; then STOCK_IMAGE=""; fi

IMG="ctf-score:acceptance-$TARGET"
NET="ctf-acceptance-$TARGET"
TMP="$(mktemp -d)"
WS="$TMP/workspace"
mkdir -p "$WS"

# entrypoint.sh already reaps the containers its bring-up started (BOOTED plus
# EXTRA_CONTAINERS) on its own EXIT. This is the belt-and-braces for the case where
# the scorer container itself dies hard and never runs that trap — so it names every
# sibling any bring-up can start: dvwa's `db`, and securityshepherd's three (plus the
# source volume its Maven handoff creates, which would otherwise leak a GB of disk).
cleanup() {
  docker rm -f "ctf-app-$TARGET" db secshep_tomcat secshep_mariadb secshep_mongo >/dev/null 2>&1 || true
  docker volume rm -f ss_src >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "Building scorer image with the vendored rubric…"
docker build -q -t "$IMG" scorer/ >/dev/null

docker network create --internal "$NET" >/dev/null 2>&1 || true

# Some targets' apps hardcode a nonstandard listen port, a servlet context
# path, or both, inside their own image (there is no way to discover this at
# runtime — it is a fact about the vendor's Dockerfile/entrypoint, not
# something docker networking can smooth over). This mirrors the read-only
# reference engine's own per-target app-url convention (dc34
# .github/workflows/stock-scores-zero.yml): VAmPI's Flask app is hardcoded to
# `app.run(port=5000)`, so the suffix must carry :5000 or the app is simply
# unreachable at the default :80 — the exact "bad port" this gate exists to
# catch. VulnerableApp additionally hardcodes a servlet context path
# (`server.servlet.context-path=/VulnerableApp` baked into the image): the
# stock container 404s at `/` and only answers under `/VulnerableApp`, so its
# suffix carries the path as well as the port — verified directly against the
# stock image (`curl :9090/` -> 404, `curl :9090/VulnerableApp/allEndPointJson`
# -> 200). Hence APP_URL_SUFFIX, not APP_PORT: it is whatever string turns
# `http://$TARGET` into the real, reachable app URL — port, path, or both.
#
# The SCHEME is per-target for the same reason: securityshepherd is the only one
# that speaks HTTPS (Tomcat's TLS connector on 8443, with a self-signed cert that
# expired in 2019 — its bring-up exports NODE_TLS_REJECT_UNAUTHORIZED=0 rather than
# re-issuing it, because the rubric's helpers disable verification deliberately and
# several tests assert on TLS-level behaviour). It defaults to http, so the other
# five compose exactly the URLs they always have.
#
# setup/ctf-setup.sh's app_url_for() carries the same per-target URL facts
# for the rendered organizer workflow. The two tables are intentionally NOT
# derived from one another (that script has provisioning side effects; this
# gate should not source it) — a new target's scheme and suffix need an entry
# in BOTH.
APP_SCHEME="http"
case "$TARGET" in
  vampi) APP_URL_SUFFIX=":5000" ;;
  vulnerableapp) APP_URL_SUFFIX=":9090/VulnerableApp" ;;
  juice-shop) APP_URL_SUFFIX=":3000" ;;
  webgoat) APP_URL_SUFFIX=":8080/WebGoat" ;;
  securityshepherd) APP_SCHEME="https"; APP_URL_SUFFIX=":8443" ;;
  *) APP_URL_SUFFIX="" ;;
esac

cat > "$TMP/event.json" <<'JSON'
{"pull_request":{"user":{"login":"stock-check"},"number":1,"head":{"sha":"0000000000000000000000000000000000000000"}}}
JSON

echo "Scoring STOCK $TARGET — expecting every challenge to FAIL…"
docker run --rm \
  --network "$NET" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$WS:/github/workspace" \
  -v "$TMP/event.json:/github/event.json:ro" \
  -e "TARGET=$TARGET" \
  -e "APP_URL=$APP_SCHEME://$TARGET$APP_URL_SUFFIX" \
  -e "APP_IMAGE=$STOCK_IMAGE" \
  -e "NETWORK=$NET" \
  --entrypoint /usr/local/bin/entrypoint.sh \
  "$IMG"

REPORT="$WS/ctf-score.md"
[ -f "$REPORT" ] || { echo "FAIL: no ctf-score.md produced"; exit 1; }

SCORE="$(sed -n 's/.*\*\*\([0-9][0-9]*\) \/ \([0-9][0-9]*\)\*\* challenges patched.*/\1 \2/p' "$REPORT")"
SOLVED="${SCORE% *}"
TOTAL="${SCORE#* }"

echo "stock $TARGET scored $SOLVED / $TOTAL"

if [ "$SOLVED" != "0" ]; then
  echo
  echo "FAIL: $SOLVED challenge(s) passed against the STOCK app."
  echo "Those tests assert the exploit rather than the fix, or the stock image is"
  echo "already hardened. Offending challenges:"
  grep -F "✅ Patched" "$REPORT" || true
  exit 1
fi

[ "$TOTAL" -gt 0 ] || { echo "FAIL: rubric scored 0 challenges total — is it wired up?"; exit 1; }

echo "PASS: stock $TARGET scores 0 / $TOTAL"
