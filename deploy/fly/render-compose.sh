#!/usr/bin/env bash
# Render docker-compose.yml into the compose file Fly deploys.
#
# WHY THIS EXISTS, AND WHY IT IS A RENDER RATHER THAN A SECOND FILE.
#
# Fly can deploy a compose file directly (`[build.compose]` in fly.toml), which
# is what lets the hosted event run the SAME services, in the same wiring, as
# `docker compose up` — one source of truth, no hand-maintained cloud twin to
# drift from the real stack.
#
# But flyctl's compose parser is not Docker's. It is a hand-rolled yaml.v3
# unmarshal (`internal/containerconfig/compose.go`), and as of flyctl 0.4.87 it
# does NOT implement:
#
#   * `profiles:`            — every service in the file is deployed
#   * `${VAR}` interpolation — `${SRH_TOKEN}` arrives as that literal string
#   * build `args:`          — so EVENT_CONFIG_B64 could never be baked
#
# and it rejects a file where more than one service declares `build:`
# ("only one service can specify build"), which docker-compose.yml does twice.
#
# `docker compose config` implements all three, correctly, because it is
# Docker's own parser. So the real compose file goes through Docker first and
# Fly receives the result. Everything Fly cannot do is therefore done by the
# tool that defines the format, not reimplemented here.
#
# WHAT THIS SCRIPT ADDS on top of `docker compose config`:
#
#   1. Secret VALUES are stripped. `config` interpolates them, which would put
#      every credential the event has into a file on disk. They are set with
#      `fly secrets` instead, which is also why stripping them is safe: Fly
#      injects secrets as environment variables into EVERY container in the
#      machine, and the variable names already match across services.
#   2. `build:` becomes `image:`. Images are built and pushed beforehand, so
#      Fly builds nothing — and the images the event runs are the exact ones
#      built from this checkout.
#   3. Service hostnames become localhost. Containers in one Fly machine share
#      a network namespace; there is no DNS between them, and `srh` resolves
#      nowhere. This is also what makes the deployment work at all: srh's Redis
#      client is IPv4-only and Fly's private network is IPv6-only, so reaching
#      redis over loopback is the only arrangement srh can connect through.
#   4. Host bind mounts are dropped. A Fly machine has no repo checkout to bind
#      FROM. sync's event.yaml arrives through EVENT_CONFIG_B64 instead.
#   5. Named volumes and networks are dropped. Fly ignores both; volumes are
#      declared as `[[mounts]]` in fly.toml, and a single machine has no
#      networks to join.
set -euo pipefail

ENV_FILE=".env.fly"
OUT=""
APP_IMAGE=""
SYNC_IMAGE=""
SCORER_IMAGE=""
# The services that go to Fly. Named explicitly rather than filtered out later:
# `docker compose config SERVICE...` limits the output to these, which is how
# caddy is excluded WITHOUT giving it a profile. Fly terminates TLS itself, so
# caddy has no job there — and profiling it would have made the edge opt-in for
# every local bring-up, turning a forgotten flag into an event with no ingress.
SERVICES="app scorer sync srh redis"
# Compose profiles to select with. Poll mode is the documented default.
PROFILES="--profile poll --profile app"

usage() {
  cat <<'EOF'
usage: deploy/fly/render-compose.sh --out FILE [--env-file .env.fly]
                                    --app-image REF --sync-image REF
                                    --scorer-image REF [--services "a b c"]
                                    [--profiles "--profile poll --profile app"]

Renders docker-compose.yml to a Fly-deployable compose file. Contains no
secret values: those are set with `fly secrets` and arrive as environment
variables in every container.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --app-image) APP_IMAGE="$2"; shift 2 ;;
    --sync-image) SYNC_IMAGE="$2"; shift 2 ;;
    --scorer-image) SCORER_IMAGE="$2"; shift 2 ;;
    --services) SERVICES="$2"; shift 2 ;;
    --profiles) PROFILES="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

[ -n "$OUT" ] || { echo "FAIL: --out is required" >&2; exit 1; }
for pair in "app:$APP_IMAGE" "sync:$SYNC_IMAGE" "scorer:$SCORER_IMAGE"; do
  if [ -z "${pair#*:}" ]; then
    echo "FAIL: --${pair%%:*}-image is required (Fly builds nothing; every service needs a prebuilt image)" >&2
    exit 1
  fi
done
[ -f "$ENV_FILE" ] || { echo "FAIL: no $ENV_FILE" >&2; exit 1; }
# Resolved against the CALLER's directory, before the cd to the repo root
# below. Without this a perfectly valid `--env-file .env.fly` passes the test
# above and then fails inside docker compose, or — worse — silently resolves to
# a different file that happens to exist at the root.
case "$ENV_FILE" in
  /*) ;;
  *) ENV_FILE="$PWD/$ENV_FILE" ;;
esac
case "$OUT" in
  /*) ;;
  *) OUT="$PWD/$OUT" ;;
esac

# ---------------------------------------------------------------------------
# The environment variables whose VALUES must never reach the rendered file.
#
# Keyed by NAME, matched exactly. `fly secrets set` supplies each one at
# runtime, so dropping the line here removes the credential without removing
# the variable from the container.
#
# EVENT_CONFIG_B64 is not a credential, but it is a multi-kilobyte blob that
# would dominate the file and is already delivered as a secret alongside the
# rest — keeping it out keeps the rendered file readable, which matters because
# reviewing it is how an organizer confirms nothing sensitive is in it.
#
# GITHUB_CLIENT_ID, GITHUB_APP_ID and GITHUB_APP_INSTALLATION_ID are public
# identifiers and deliberately stay: they make the file diffable and are what
# an organizer checks when sign-in points at the wrong OAuth app.
# ---------------------------------------------------------------------------
SECRET_KEYS="BETTER_AUTH_SECRET GITHUB_CLIENT_SECRET GITHUB_APP_PRIVATE_KEY SRH_TOKEN UPSTASH_REDIS_REST_TOKEN CTF_SCORE_BEARER_TOKEN SCORER_TOKEN SRH_CONNECTION_STRING REDIS_PASSWORD REDISCLI_AUTH EVENT_CONFIG_B64"

cd "$(dirname "$0")/../.."

command -v docker >/dev/null || { echo "FAIL: docker is required to render the compose file" >&2; exit 1; }

# shellcheck disable=SC2086
# PROFILES and SERVICES are deliberately word-split: both are lists of
# arguments, not single values.
RAW="$(docker compose --env-file "$ENV_FILE" -f docker-compose.yml $PROFILES config $SERVICES)" || {
  echo "FAIL: 'docker compose config' rejected docker-compose.yml with $ENV_FILE." >&2
  echo "      Every variable it needs must be set there — REDIS_PASSWORD and" >&2
  echo "      SRH_TOKEN especially, which compose marks required with ':?'." >&2
  exit 1
}

printf '%s\n' "$RAW" | awk -v app_image="$APP_IMAGE" \
                           -v sync_image="$SYNC_IMAGE" \
                           -v scorer_image="$SCORER_IMAGE" \
                           -v secret_keys="$SECRET_KEYS" '
BEGIN {
  n = split(secret_keys, k, " ")
  for (i = 1; i <= n; i++) secret[k[i]] = 1
  # Service names that must become loopback wherever they appear as a host in
  # a URL. Containers in one Fly machine share a netns, so these never resolve.
  svc["srh"] = 1; svc["scorer"] = 1; svc["redis"] = 1; svc["app"] = 1; svc["sync"] = 1
  print "# GENERATED by deploy/fly/render-compose.sh from docker-compose.yml."
  print "# Do not edit: every change belongs in docker-compose.yml, so the local"
  print "# stack and the deployed one cannot diverge. Regenerate with deploy.sh."
  print "#"
  print "# Contains NO secret values - they are set with `fly secrets` and arrive"
  print "# as environment variables in every container of the machine."
}

# Indentation is the structure: `docker compose config` always emits a
# normalized document (two-space indent, keys sorted), which is what makes a
# line-oriented pass safe here rather than a YAML-parser-in-awk.
{
  line = $0
  match(line, /^ */)
  indent = RLENGTH
}

# --- block skipping -------------------------------------------------------
# When a dropped key opens a block, every following line indented deeper than
# it belongs to that block and goes too.
skip_indent >= 0 {
  if (indent > skip_indent) next
  skip_indent = -1
}

# --- top level ------------------------------------------------------------
indent == 0 {
  section = $0
  sub(/:.*$/, "", section)
  # Fly ignores both, and a single machine has neither. Dropping them keeps the
  # rendered file an honest description of what actually gets deployed.
  if (section == "networks" || section == "volumes") { skip_indent = 0; next }
  print
  next
}

# --- service headers ------------------------------------------------------
# `image:` is INSERTED here, immediately under the service name, rather than
# where compose would have put it: app and sync have no image key at all (they
# are `build:` services locally), and Fly requires every service to name one.
indent == 2 && section == "services" {
  service = $0
  sub(/^ +/, "", service); sub(/:.*$/, "", service)
  print
  if (service == "app")  print "    image: " app_image
  if (service == "sync") print "    image: " sync_image
  in_env = 0
  next
}

# --- per-service keys -----------------------------------------------------
indent == 4 && section == "services" {
  key = $0
  sub(/^ +/, "", key); sub(/:.*$/, "", key)
  in_env = (key == "environment")
  # build:    Fly allows at most one, and cannot pass build args; images are
  #           built and pushed before the deploy instead.
  # volumes:  named volumes are ignored by Fly (they become `[[mounts]]`), and
  #           bind mounts name host paths that do not exist on a Fly machine.
  # networks: one machine, one namespace.
  # profiles: flyctl does not implement them; selection already happened, in
  #           `docker compose config SERVICE...`. Leaving them would suggest
  #           Fly honours a filter it ignores entirely.
  if (key == "build" || key == "volumes" || key == "networks" || key == "profiles") {
    skip_indent = 4
    next
  }
  # The scorer runs a prebuilt image that must be the one the forks judge with,
  # mirrored into the Fly registry, so its image line is replaced, not kept.
  if (key == "image" && service == "scorer") { print "    image: " scorer_image; next }
}

# --- environment values ---------------------------------------------------
in_env && indent == 6 {
  key = $0
  sub(/^ +/, "", key); sub(/:.*$/, "", key)
  if (key in secret) next
}

# --- compose escaping -----------------------------------------------------
# `$$` IS COMPOSE-SPECIFIC AND MUST NOT SURVIVE.
#
# In a compose file `$$` means "a literal $, do not interpolate", and `docker
# compose config` faithfully re-emits it that way because its output is meant
# to be read by compose again. Fly is not compose: it passes the string
# through untouched, so redis would receive
#
#     sh -c "exec redis-server ... --requirepass \"$$REDIS_PASSWORD\""
#
# where `$$` is the SHELL PID. The password would silently become something
# like "12345REDIS_PASSWORD" — redis starts, reports healthy, and every client
# fails to authenticate against a credential nobody can predict.
{ gsub(/\$\$/, "$") }

# --- host rewriting -------------------------------------------------------
# `http://srh:80` -> `http://localhost:80`. Anchored on `//host:` so it can
# only ever match a URL authority: a bare word like `scorer` in a comment, or
# the string "app" inside a longer hostname, is left alone.
{
  out = ""
  rest = $0
  while (match(rest, /\/\/[A-Za-z0-9_-]+:/)) {
    host = substr(rest, RSTART + 2, RLENGTH - 3)
    out = out substr(rest, 1, RSTART + 1)
    out = out ((host in svc) ? "localhost" : host) ":"
    rest = substr(rest, RSTART + RLENGTH)
  }
  print out rest
}
' | awk '
# SECOND PASS: drop `environment:` keys left with nothing under them.
#
# A service whose every environment entry was a secret (redis: REDIS_PASSWORD
# and REDISCLI_AUTH, both stripped) ends up with a bare `environment:` — which
# is YAML null, not an empty mapping. Docker tolerates that; a hand-rolled
# unmarshal into a map type need not, and an empty key carries no information
# either way.
#
# Deferring by one line is enough to decide: the block is empty exactly when
# the next line is not indented deeper than the key.
{
  if (held != "") {
    match($0, /^ */)
    if (RLENGTH > held_indent) print held
    held = ""
  }
  match($0, /^ */)
  if ($0 ~ /^ +environment:[ \t]*$/) { held = $0; held_indent = RLENGTH; next }
  print
}
END { if (held != "") { } }
'  > "$OUT.tmp"

mv "$OUT.tmp" "$OUT"

# ---------------------------------------------------------------------------
# FAIL-CLOSED CHECK: prove no secret VALUE survived.
#
# The stripping above is keyed on variable NAMES, which is exactly the kind of
# list that goes stale when a service gains a credential. This checks the
# rendered file for the VALUES themselves, straight out of the env file, so a
# secret that this script does not know about still cannot ship silently.
#
# Short values are skipped deliberately: a two-character secret would match
# half the file and turn a real check into a permanent false alarm. Anything
# that short is not a credential worth protecting.
# ---------------------------------------------------------------------------
leaked=""
while IFS= read -r entry; do
  case "$entry" in
    ''|'#'*) continue ;;
    *=*) ;;
    *) continue ;;
  esac
  name="${entry%%=*}"
  value="${entry#*=}"
  [ ${#value} -ge 8 ] || continue
  case " $SECRET_KEYS " in
    *" $name "*) ;;
    *) continue ;;
  esac
  if grep -qF -- "$value" "$OUT"; then
    leaked="$leaked $name"
  fi
done < "$ENV_FILE"

if [ -n "$leaked" ]; then
  rm -f "$OUT"
  echo "FAIL: the rendered compose file contained secret values:$leaked" >&2
  echo "      Refusing to leave it on disk. This is a bug in render-compose.sh." >&2
  exit 1
fi

# Readable, not secret — reviewing this file is how an organizer confirms what
# the deploy will run, and it holds no credentials by the check above.
chmod 644 "$OUT"
echo "   rendered $OUT ($(grep -c '' "$OUT") lines, no secret values)"
