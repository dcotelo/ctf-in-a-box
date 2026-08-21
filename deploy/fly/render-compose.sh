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
#   1. NOTHING. Specifically: secret values are LEFT IN, and this file is
#      therefore a credential file — mode 600, gitignored, and deleted by
#      deploy.sh once the deploy succeeds.
#
#      It was built the other way first: values stripped, `fly secrets` relied
#      on, because Fly's documentation says secrets are "global and available
#      to every container". They are not. A machine's containers receive only
#      their own `ExtraEnv`, which comes from this file's `environment:` block;
#      the machine config carries no `secrets` key at all. Every container came
#      up without its credentials while `fly secrets list` showed all fourteen
#      as `Deployed` — the app answering 500 from better-auth's default-secret
#      error, the scorer refusing to start, sync falling back to a mounted
#      event.yaml that does not exist on a Fly machine.
#
#      The compensation is real, though: per-service scoping that Fly's global
#      secrets cannot express. The app never receives REDIS_PASSWORD, and redis
#      never receives GITHUB_CLIENT_SECRET.
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
EVENT_CONFIG=""
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
                                    --scorer-image REF [--event-config event.yaml]
                                    [--services "a b c"]
                                    [--profiles "--profile poll --profile app"]

Renders docker-compose.yml to a Fly-deployable compose file.

THE OUTPUT IS A CREDENTIAL FILE: mode 600, and refused unless gitignored.
Per-container `environment:` is the only channel that reaches a container in a
Fly machine — `fly secrets` does not, whatever the documentation says — so the
values have to travel in it. deploy.sh removes it once the deploy succeeds.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --app-image) APP_IMAGE="$2"; shift 2 ;;
    --sync-image) SYNC_IMAGE="$2"; shift 2 ;;
    --scorer-image) SCORER_IMAGE="$2"; shift 2 ;;
    --event-config) EVENT_CONFIG="$2"; shift 2 ;;
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
case "$EVENT_CONFIG" in
  ""|/*) ;;
  *) EVENT_CONFIG="$PWD/$EVENT_CONFIG" ;;
esac

cd "$(dirname "$0")/../.."

command -v docker >/dev/null || { echo "FAIL: docker is required to render the compose file" >&2; exit 1; }

# EVENT_CONFIG_B64 comes in through the ENVIRONMENT, not the env file.
#
# sync reads it at start-up (a Fly machine has no ./event.yaml to bind-mount),
# and the app has already baked it at build time. It is a multi-kilobyte blob
# derived from event.yaml on every run, so keeping it out of .env.fly avoids a
# second copy that can silently go stale against the file it came from.
#
# A shell variable beats --env-file in compose's precedence order, which is
# what makes this work even if someone does put it in the env file.
if [ -n "$EVENT_CONFIG" ]; then
  [ -f "$EVENT_CONFIG" ] || { echo "FAIL: no $EVENT_CONFIG to read the event config from" >&2; exit 1; }
  EVENT_CONFIG_B64="$(base64 < "$EVENT_CONFIG" | tr -d '\n')"
  export EVENT_CONFIG_B64
fi

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
                           -v scorer_image="$SCORER_IMAGE" '
BEGIN {
  # Service names that must become loopback wherever they appear as a host in
  # a URL. Containers in one Fly machine share a netns, so these never resolve.
  svc["srh"] = 1; svc["scorer"] = 1; svc["redis"] = 1; svc["app"] = 1; svc["sync"] = 1
  print "# GENERATED by deploy/fly/render-compose.sh from docker-compose.yml."
  print "# Do not edit: every change belongs in docker-compose.yml, so the local"
  print "# stack and the deployed one cannot diverge. Regenerate with deploy.sh."
  print "#"
  print "#"
  print "# THIS FILE CONTAINS CREDENTIALS. Mode 600, gitignored, and removed once"
  print "# the deploy succeeds. Per-container environment is the ONLY channel that"
  print "# reaches a container in a Fly machine - fly secrets does not, despite"
  print "# what the docs say - so the values have to travel here."
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
# --- environment values ---------------------------------------------------
# LEFT INTACT, INCLUDING SECRETS. Per-container `environment:` is the only
# channel that reaches a container in a Fly machine (see the header). What this
# does buy is scoping: each credential appears only under the service that
# `docker-compose.yml` gives it to.

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
# `http://srh:80` -> `http://localhost:80`.
#
# TWO anchors, because a URL authority can carry userinfo. the srh connection
# string is `redis://:PASSWORD@redis:6379`, where the host follows an `@` and
# not the `//` — with only the `//host:` form it was left pointing at `redis`,
# which resolves nowhere in a shared network namespace. That is the original
# bug this whole module exists to fix, reintroduced by the renderer, and it
# would have looked exactly like it did before: srh healthy, unable to connect.
#
# Both forms end in `:` so they can only match an authority followed by a port.
# A bare word like `scorer` in a comment, or `app` inside a longer hostname, is
# left alone.
{
  out = ""
  rest = $0
  while (match(rest, /(\/\/|@)[A-Za-z0-9_-]+:/)) {
    lead = substr(rest, RSTART, 1) == "@" ? 1 : 2
    host = substr(rest, RSTART + lead, RLENGTH - lead - 1)
    out = out substr(rest, 1, RSTART + lead - 1)
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

# Mode 600 BEFORE the content lands. `mv` would otherwise leave the file
# world-readable for the moment between rename and chmod, and it now holds
# every credential the event has.
: > "$OUT"
chmod 600 "$OUT"
cat "$OUT.tmp" > "$OUT"
rm -f "$OUT.tmp"

# ---------------------------------------------------------------------------
# FAIL-CLOSED CHECK: this file holds credentials, so prove git cannot see it.
#
# It used to check the opposite — that no secret value survived — back when the
# values were stripped and `fly secrets` was expected to supply them. Fly does
# not do that for compose containers (see the header), so the check has to
# guard the thing that is now true: a credential file exists on disk, beside a
# repo whose .env.fly reached a PUBLIC remote twice.
#
# `git check-ignore` is asked directly rather than trusting that .gitignore
# still has the right rule: the rule and the output path have already moved
# once in this module's life.
# ---------------------------------------------------------------------------
if git -C "$(dirname "$OUT")" rev-parse --git-dir >/dev/null 2>&1; then
  if ! git -C "$(dirname "$OUT")" check-ignore -q "$(basename "$OUT")"; then
    rm -f "$OUT"
    echo "FAIL: $OUT is NOT gitignored, and it contains every credential this" >&2
    echo "      event has. Refusing to leave it on disk." >&2
    echo "      Add it to .gitignore, then re-run." >&2
    exit 1
  fi
fi

echo "   rendered $OUT ($(grep -c '' "$OUT") lines, mode 600 — contains secrets, gitignored)"
