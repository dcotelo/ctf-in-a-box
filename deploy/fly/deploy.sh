#!/usr/bin/env bash
# Stand the kit up on fly.io: three apps (app, scorer, sync) plus a managed
# Upstash Redis. Run from anywhere; it works from the repo root.
#
# Idempotent by design, like ctf-setup.sh: every step checks before it acts, so
# re-running after a failure resumes rather than duplicating. Secrets are set
# through `fly secrets`, never written into a committed file.
set -euo pipefail
cd "$(dirname "$0")/../.."

FLY_DIR=deploy/fly
DRY_RUN=""
ENV_FILE=".env"
CONFIG="event.yaml"

usage() {
  cat <<'EOF'
usage: deploy/fly/deploy.sh [--dry-run] [--env-file .env] [--config event.yaml]

Deploys, in order: scorer, sync, app. Reads secrets from --env-file (the same
file setup/ctf-setup.sh secrets writes) and bakes --config into both the app
and the sync images.

--dry-run prints every fly command it would run and makes NONE of them.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --config) CONFIG="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

# Every fly invocation goes through this, so --dry-run cannot leak a real call.
fly_run() {
  if [ -n "$DRY_RUN" ]; then
    echo "DRY-RUN: fly $*"
    return 0
  fi
  fly "$@"
}

app_name() {
  # `app = "name"` out of a fly.toml, without a TOML parser (no jq/python on
  # this path, same rule as the provisioning scripts).
  sed -n 's/^app *= *"\([^"]*\)".*/\1/p' "$FLY_DIR/$1" | head -1
}

env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -1
}

require() {
  if [ -z "$2" ]; then
    echo "FAIL: $1 is empty in $ENV_FILE" >&2
    exit 1
  fi
}

if [ -z "$DRY_RUN" ]; then
  command -v fly >/dev/null || { echo "fly CLI missing: https://fly.io/docs/flyctl/install/" >&2; exit 1; }
  [ -f "$ENV_FILE" ] || { echo "no $ENV_FILE — run ./setup/ctf-setup.sh secrets first" >&2; exit 1; }
  [ -f "$CONFIG" ] || { echo "no $CONFIG — copy event.yaml.example and edit it" >&2; exit 1; }
fi

APP_APP="$(app_name app.fly.toml)"
SCORER_APP="$(app_name scorer.fly.toml)"
SYNC_APP="$(app_name sync.fly.toml)"

echo "== apps: $APP_APP / $SCORER_APP / $SYNC_APP"

# ---------------------------------------------------------------------------
# EVENT_URL must be the fly hostname, and it must be https.
#
# The app refuses to serve a production event over plain HTTP to a non-local
# host (ADR 39) — so a leftover http://localhost in .env would deploy an app
# that answers 500 to everything. Catch it here, where the message can name
# the fix, rather than in a container log.
# ---------------------------------------------------------------------------
EVENT_URL="$(env_value EVENT_URL)"
EXPECTED_URL="https://$APP_APP.fly.dev"
case "$EVENT_URL" in
  https://*) ;;
  *)
    echo "FAIL: EVENT_URL in $ENV_FILE is '${EVENT_URL:-<empty>}'." >&2
    echo "      On Fly it must be your app's https hostname, normally:" >&2
    echo "        EVENT_URL=$EXPECTED_URL" >&2
    echo "      The app refuses to serve a production event over plain HTTP." >&2
    exit 1 ;;
esac

for name in BETTER_AUTH_SECRET GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET SCORER_TOKEN; do
  require "$name" "$(env_value "$name")"
done

# ---------------------------------------------------------------------------
# Redis. Fly's managed Upstash speaks the same REST protocol the app, scorer
# and sync already use, so `srh` (which exists only to fake that API in front
# of local Redis) is not deployed at all.
# ---------------------------------------------------------------------------
UPSTASH_URL="$(env_value UPSTASH_REDIS_REST_URL)"
UPSTASH_TOKEN="$(env_value UPSTASH_REDIS_REST_TOKEN)"
if [ -z "$UPSTASH_URL" ] || [ -z "$UPSTASH_TOKEN" ]; then
  echo "FAIL: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing from $ENV_FILE." >&2
  echo "      Create the database, then copy its REST URL and token in:" >&2
  echo "        fly redis create" >&2
  echo "        fly redis status <name>" >&2
  echo "      These REPLACE the local redis + srh services; do not deploy those." >&2
  exit 1
fi

create_app() {
  # `fly apps create` fails if the app exists, which is the normal state on a
  # re-run — check first so re-running is not an error.
  if [ -n "$DRY_RUN" ]; then
    echo "DRY-RUN: fly apps create $1 (if absent)"
    return 0
  fi
  if fly apps list 2>/dev/null | grep -qE "^$1[[:space:]]"; then
    echo "   app $1 exists"
  else
    fly apps create "$1"
  fi
}

echo "== 1/4 scorer"
create_app "$SCORER_APP"
fly_run secrets set --app "$SCORER_APP" --stage \
  "UPSTASH_REDIS_REST_URL=$UPSTASH_URL" \
  "UPSTASH_REDIS_REST_TOKEN=$UPSTASH_TOKEN" \
  "CTF_SCORE_BEARER_TOKEN=$(env_value SCORER_TOKEN)"
fly_run deploy --config "$FLY_DIR/scorer.fly.toml" --app "$SCORER_APP"

echo "== 2/4 sync (poll mode)"
create_app "$SYNC_APP"
# The cursor volume. Without it the poller re-reads every comment in every
# fork after each restart — see sync.fly.toml.
if [ -n "$DRY_RUN" ]; then
  echo "DRY-RUN: fly volumes create ctf_sync_state --app $SYNC_APP --size 1 (if absent)"
elif fly volumes list --app "$SYNC_APP" 2>/dev/null | grep -q ctf_sync_state; then
  echo "   volume ctf_sync_state exists"
else
  fly volumes create ctf_sync_state --app "$SYNC_APP" --size 1 --yes
fi
fly_run secrets set --app "$SYNC_APP" --stage \
  "UPSTASH_REDIS_REST_URL=$UPSTASH_URL" \
  "UPSTASH_REDIS_REST_TOKEN=$UPSTASH_TOKEN" \
  "SCORER_TOKEN=$(env_value SCORER_TOKEN)" \
  "GITHUB_APP_ID=$(env_value GITHUB_APP_ID)" \
  "GITHUB_APP_PRIVATE_KEY=$(env_value GITHUB_APP_PRIVATE_KEY)" \
  "GITHUB_APP_INSTALLATION_ID=$(env_value GITHUB_APP_INSTALLATION_ID)"
# Built from the repo root so event.yaml is in the build context.
fly_run deploy --config "$FLY_DIR/sync.fly.toml" --app "$SYNC_APP" --dockerfile "$FLY_DIR/sync.Dockerfile"

echo "== 3/4 app"
create_app "$APP_APP"
fly_run secrets set --app "$APP_APP" --stage \
  "BETTER_AUTH_SECRET=$(env_value BETTER_AUTH_SECRET)" \
  "BETTER_AUTH_URL=$EVENT_URL" \
  "GITHUB_CLIENT_ID=$(env_value GITHUB_CLIENT_ID)" \
  "GITHUB_CLIENT_SECRET=$(env_value GITHUB_CLIENT_SECRET)" \
  "UPSTASH_REDIS_REST_URL=$UPSTASH_URL" \
  "UPSTASH_REDIS_REST_TOKEN=$UPSTASH_TOKEN"

# THE BUILD ARG THAT DECIDES WHETHER /admin WORKS.
#
# The app bakes event.yaml at BUILD time. Deploy without this and the build
# silently succeeds with an EMPTY admins list — /admin then 403s for everyone,
# including the organizer — and generic branding. There is no runtime error to
# notice; the event just looks wrong.
EVENT_CONFIG_B64="$(base64 < "$CONFIG" | tr -d '\n')"
fly_run deploy --config "$FLY_DIR/app.fly.toml" --app "$APP_APP" \
  --build-arg "EVENT_CONFIG_B64=$EVENT_CONFIG_B64"

echo "== 4/4 next steps"
cat <<EOF

  Deployed. Finish these by hand:

  1. OAuth callback must match the deployed host exactly:
       $EVENT_URL/api/auth/callback/github
     Update it at https://github.com/settings/developers if it still points
     somewhere else. Sign-in fails with a redirect_uri mismatch otherwise.

  2. Confirm the poller is ingesting:
       fly logs --app $SYNC_APP

  3. Open $EVENT_URL, sign in, and check /admin loads for a login listed in
     $CONFIG's admins. A 403 there almost always means the app was built
     without EVENT_CONFIG_B64 — redeploy through this script.

  Custom domain instead of *.fly.dev:
       fly certs add <domain> --app $APP_APP
     then set EVENT_URL to it, update the OAuth callback, and redeploy the app
     (BETTER_AUTH_URL is a secret, and the cookie's Secure flag follows it).
EOF
