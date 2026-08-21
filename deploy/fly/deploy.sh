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
ENV_FILE=".env.fly"
CONFIG="event.yaml"
FROM_ENV=".env"
CMD="deploy"

usage() {
  cat <<'EOF'
usage: deploy/fly/deploy.sh [init] [--dry-run] [--env-file .env.fly]
                            [--config event.yaml] [--from .env]

  init    Prepare an env file for Fly: copies --from (default .env), rewrites
          EVENT_URL to the app's Fly hostname, and fills in SRH_TOKEN and
          REDIS_PASSWORD if they are absent. Touches nothing on Fly and needs
          no CLI. Safe to re-run — it tops up an existing file rather than
          overwriting it, and tightens it to mode 600.

  (none)  Deploy, in order: redis, srh, scorer, sync, app.

          Regions come from the fly.toml files (primary_region), not a flag.

--dry-run prints every fly command it would run and makes NONE of them.
Secret VALUES are redacted from that output.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    init) CMD="init"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --from) FROM_ENV="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --config) CONFIG="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

# Every fly invocation goes through this, so --dry-run cannot leak a real call.
#
# --dry-run REDACTS SECRET VALUES. It printed them in full until an organizer
# ran it and watched their GitHub App private key, OAuth client secret and
# BETTER_AUTH_SECRET scroll past — into a terminal, a scrollback buffer, and
# whatever CI log or screen share happened to be capturing it. A dry run is
# the command people run FIRST, casually, precisely because they believe it
# is inert; printing credentials is the last thing it should do.
#
# The redaction is on the VALUE half of `NAME=value`, keyed on the name, so
# the run still shows exactly which variables are set on which app — which is
# the whole point of previewing it — without showing what they are.
redact_arg() {
  case "$1" in
    *=*)
      name="${1%%=*}"
      case "$name" in
        # CONNECTION_STRING is here because a redis:// URL embeds the
        # password. It was missed on the first pass and caught by reading the
        # dry-run's own output — which is the argument for previewing.
        *SECRET*|*TOKEN*|*PRIVATE_KEY*|*PASSWORD*|*CONNECTION_STRING*|EVENT_CONFIG_B64)
          echo "$name=<redacted>" ;;
        *) echo "$1" ;;
      esac ;;
    *) echo "$1" ;;
  esac
}

fly_run() {
  if [ -n "$DRY_RUN" ]; then
    printf 'DRY-RUN: fly'
    for arg in "$@"; do
      printf ' %s' "$(redact_arg "$arg")"
    done
    printf '\n'
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

APP_APP="$(app_name app.fly.toml)"
SCORER_APP="$(app_name scorer.fly.toml)"
SYNC_APP="$(app_name sync.fly.toml)"
SRH_APP="$(app_name srh.fly.toml)"
REDIS_APP="$(app_name redis.fly.toml)"

# Checked at the point of use, not up front: `init`'s env-file half needs no
# CLI at all, and refusing to prepare a file because flyctl is not installed
# yet would be a gate on the one step that does not touch Fly.
require_fly() {
  command -v fly >/dev/null || { echo "fly CLI missing: https://fly.io/docs/flyctl/install/" >&2; exit 1; }
}

# ---------------------------------------------------------------------------
# init — prepare the env file and provision Redis.
#
# Split from `deploy` because it CREATES A BILLABLE RESOURCE and because the
# values it captures are then just ordinary env-file entries a human can read
# and edit. Idempotent: it never overwrites an existing env file, and it
# reuses an existing database rather than making a second one.
# ---------------------------------------------------------------------------
if [ "$CMD" = "init" ]; then
  if [ -f "$ENV_FILE" ]; then
    echo "== $ENV_FILE exists — topping it up, not overwriting"
    # Tighten permissions even on a file we did not create. A hand-made env
    # file is usually 644 from a plain shell redirect, and this one holds
    # every secret the event has — the OAuth client secret, the App private
    # key, the session signing key. Chmod'ing only on creation left exactly
    # the files most likely to be wrong.
    [ -n "$DRY_RUN" ] || chmod 600 "$ENV_FILE"
  else
    [ -f "$FROM_ENV" ] || { echo "no $FROM_ENV to copy from — run ./setup/ctf-setup.sh secrets first" >&2; exit 1; }
    echo "== writing $ENV_FILE from $FROM_ENV"
    if [ -z "$DRY_RUN" ]; then
      {
        echo "# Fly deployment env, generated by deploy/fly/deploy.sh init."
        echo "# Separate from $FROM_ENV on purpose: a compose stack and a Fly"
        echo "# deployment need different EVENT_URLs, and one file cannot hold both."
        grep -vE "^(EVENT_URL|UPSTASH_REDIS_REST_URL|UPSTASH_REDIS_REST_TOKEN)=" "$FROM_ENV"
        echo "EVENT_URL=https://$APP_APP.fly.dev"
      } > "$ENV_FILE"
      chmod 600 "$ENV_FILE"
    else
      echo "DRY-RUN: would write $ENV_FILE (mode 600) with EVENT_URL=https://$APP_APP.fly.dev"
    fi
  fi

  # SRH bearer token. Generated here rather than reused from $FROM_ENV so a
  # local stack and a Fly deployment never share one.
  if grep -q "^SRH_TOKEN=." "$ENV_FILE" 2>/dev/null; then
    echo "   SRH_TOKEN already set"
  elif [ -z "$DRY_RUN" ]; then
    printf 'SRH_TOKEN=%s\n' "$(openssl rand -hex 24)" >> "$ENV_FILE"
    echo "   generated SRH_TOKEN"
  else
    echo "DRY-RUN: would generate SRH_TOKEN"
  fi

  # Redis credential. The datastore is our own `redis:7-alpine` app (see
  # redis.fly.toml), authenticated with the same REDIS_PASSWORD the compose
  # stack uses — so an env file copied from a working compose deployment
  # already has it, and nothing needs provisioning through the CLI.
  if grep -q "^REDIS_PASSWORD=." "$ENV_FILE" 2>/dev/null; then
    echo "   REDIS_PASSWORD already set"
  elif [ -z "$DRY_RUN" ]; then
    printf 'REDIS_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> "$ENV_FILE"
    echo "   generated REDIS_PASSWORD"
  else
    echo "DRY-RUN: would generate REDIS_PASSWORD"
  fi

  echo
  echo "  Ready. Next:"
  echo "      ./deploy/fly/deploy.sh --dry-run --env-file $ENV_FILE"
  echo "      ./deploy/fly/deploy.sh --env-file $ENV_FILE"
  exit 0
fi

# ---------------------------------------------------------------------------
# deploy
# ---------------------------------------------------------------------------
if [ -z "$DRY_RUN" ]; then
  require_fly
  [ -f "$ENV_FILE" ] || { echo "no $ENV_FILE — run: ./deploy/fly/deploy.sh init" >&2; exit 1; }
  [ -f "$CONFIG" ] || { echo "no $CONFIG — copy event.yaml.example and edit it" >&2; exit 1; }
fi

echo "== apps: $APP_APP / $SCORER_APP / $SYNC_APP / $SRH_APP / $REDIS_APP"

# ---------------------------------------------------------------------------
# EVENT_URL must be the fly hostname, and it must be https.
#
# The app refuses to serve a production event over plain HTTP to a non-local
# host (ADR 39) — so a leftover http://localhost would deploy an app that
# answers 500 to everything. Catch it here, where the message can name the
# fix, rather than in a container log.
# ---------------------------------------------------------------------------
EVENT_URL="$(env_value EVENT_URL)"
EXPECTED_URL="https://$APP_APP.fly.dev"
# A placeholder that was never filled in. It passes the https:// test below,
# so without this it deploys — and the failure surfaces much later as a
# redirect_uri mismatch at sign-in, on a BETTER_AUTH_URL nobody can resolve.
case "$EVENT_URL" in
  *"<"*|*">"*|*" "*)
    echo "FAIL: EVENT_URL in $ENV_FILE is '$EVENT_URL' — that still has a placeholder in it." >&2
    echo "      Set it to your real hostname, normally:" >&2
    echo "        EVENT_URL=https://$APP_APP.fly.dev" >&2
    exit 1 ;;
esac

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

SRH_TOKEN="$(env_value SRH_TOKEN)"
REDIS_PASSWORD="$(env_value REDIS_PASSWORD)"

# Name the variable that is ACTUALLY missing. Listing several when one is
# absent sends the reader to check the ones they already set — the exact wrong
# turn, on the message whose only job is to shorten the search.
missing=""
[ -n "$SRH_TOKEN" ] || missing="SRH_TOKEN"
if [ -z "$REDIS_PASSWORD" ]; then
  if [ -n "$missing" ]; then missing="$missing and REDIS_PASSWORD"; else missing="REDIS_PASSWORD"; fi
fi
if [ -n "$missing" ]; then
  echo "FAIL: $missing missing from $ENV_FILE." >&2
  echo "      Run: ./deploy/fly/deploy.sh init --env-file $ENV_FILE" >&2
  echo "      (It generates both. REDIS_PASSWORD is the same credential the" >&2
  echo "       compose stack uses, so an env file copied from one already has it.)" >&2
  exit 1
fi

# srh reaches the redis app over the private network. Empty username,
# password only — the RFC form for a Redis using `requirepass`.
SRH_CONNECTION_STRING="redis://:$REDIS_PASSWORD@$REDIS_APP.internal:6379"

# The image the FORKS already pull to judge PRs — same one, not a rebuild.
SCORE_IMAGE="$(env_value SCORE_IMAGE)"
require SCORE_IMAGE "$SCORE_IMAGE"

# Every service reaches Redis through srh, over the private network.
REST_URL="http://$SRH_APP.internal:80"

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

echo "== 1/5 redis"
create_app "$REDIS_APP"
# Durable store for scores, teams and hint purchases — the same named-volume
# arrangement as compose's `redis-data`.
if [ -n "$DRY_RUN" ]; then
  echo "DRY-RUN: fly volumes create ctf_redis_data --app $REDIS_APP --size 1 (if absent)"
elif fly volumes list --app "$REDIS_APP" 2>/dev/null | grep -q ctf_redis_data; then
  echo "   volume ctf_redis_data exists"
else
  fly volumes create ctf_redis_data --app "$REDIS_APP" --size 1 --yes
fi
fly_run secrets set --app "$REDIS_APP" --stage "REDIS_PASSWORD=$REDIS_PASSWORD"
fly_run deploy --config "$FLY_DIR/redis.fly.toml" --app "$REDIS_APP"

echo "== 2/5 srh (the Upstash-REST API the services speak)"
create_app "$SRH_APP"
fly_run secrets set --app "$SRH_APP" --stage \
  "SRH_TOKEN=$SRH_TOKEN" \
  "SRH_CONNECTION_STRING=$SRH_CONNECTION_STRING"
fly_run deploy --config "$FLY_DIR/srh.fly.toml" --app "$SRH_APP"

echo "== 3/5 scorer"
create_app "$SCORER_APP"
fly_run secrets set --app "$SCORER_APP" --stage \
  "UPSTASH_REDIS_REST_URL=$REST_URL" \
  "UPSTASH_REDIS_REST_TOKEN=$SRH_TOKEN" \
  "CTF_SCORE_BEARER_TOKEN=$(env_value SCORER_TOKEN)"
fly_run deploy --config "$FLY_DIR/scorer.fly.toml" --app "$SCORER_APP" --image "$SCORE_IMAGE"

echo "== 4/5 sync (poll mode)"
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
  "UPSTASH_REDIS_REST_URL=$REST_URL" \
  "UPSTASH_REDIS_REST_TOKEN=$SRH_TOKEN" \
  "SCORER_TOKEN=$(env_value SCORER_TOKEN)" \
  "GITHUB_APP_ID=$(env_value GITHUB_APP_ID)" \
  "GITHUB_APP_PRIVATE_KEY=$(env_value GITHUB_APP_PRIVATE_KEY)" \
  "GITHUB_APP_INSTALLATION_ID=$(env_value GITHUB_APP_INSTALLATION_ID)"
# Built from the repo root so event.yaml is in the build context.
fly_run deploy --config "$FLY_DIR/sync.fly.toml" --app "$SYNC_APP" --dockerfile "$FLY_DIR/sync.Dockerfile"

echo "== 5/5 app"
create_app "$APP_APP"
fly_run secrets set --app "$APP_APP" --stage \
  "BETTER_AUTH_SECRET=$(env_value BETTER_AUTH_SECRET)" \
  "BETTER_AUTH_URL=$EVENT_URL" \
  "GITHUB_CLIENT_ID=$(env_value GITHUB_CLIENT_ID)" \
  "GITHUB_CLIENT_SECRET=$(env_value GITHUB_CLIENT_SECRET)" \
  "UPSTASH_REDIS_REST_URL=$REST_URL" \
  "UPSTASH_REDIS_REST_TOKEN=$SRH_TOKEN"

# THE BUILD ARG THAT DECIDES WHETHER /admin WORKS.
#
# The app bakes event.yaml at BUILD time. Deploy without this and the build
# silently succeeds with an EMPTY admins list — /admin then 403s for everyone,
# including the organizer — and generic branding. There is no runtime error to
# notice; the event just looks wrong.
EVENT_CONFIG_B64="$(base64 < "$CONFIG" | tr -d '\n')"
fly_run deploy --config "$FLY_DIR/app.fly.toml" --app "$APP_APP" \
  --build-arg "EVENT_CONFIG_B64=$EVENT_CONFIG_B64"

echo "== done"
cat <<EOF

  Deployed. Finish these by hand:

  1. OAuth callback must match the deployed host exactly:
       $EVENT_URL/api/auth/callback/github
     Update it at https://github.com/settings/developers if it still points
     somewhere else. Sign-in fails with a redirect_uri mismatch otherwise.

  2. Confirm the poller is ingesting, and that srh is answering it:
       fly logs --app $SYNC_APP
       fly logs --app $SRH_APP

  3. Open $EVENT_URL, sign in, and check /admin loads for a login listed in
     $CONFIG's admins. A 403 there almost always means the app was built
     without EVENT_CONFIG_B64 — redeploy through this script.

  Custom domain instead of *.fly.dev:
       fly certs add <domain> --app $APP_APP
     then set EVENT_URL to it, update the OAuth callback, and redeploy the app
     (BETTER_AUTH_URL is a secret, and the cookie's Secure flag follows it).
EOF
