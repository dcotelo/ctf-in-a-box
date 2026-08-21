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
REGION="iad"
CMD="deploy"

usage() {
  cat <<'EOF'
usage: deploy/fly/deploy.sh [init] [--dry-run] [--env-file .env.fly]
                            [--config event.yaml] [--from .env] [--region iad]

  init    Prepare an env file for Fly and provision the managed Redis:
          copies --from (default .env), rewrites EVENT_URL to the app's Fly
          hostname, generates SRH_TOKEN, runs `fly redis create` and captures
          its private URL. CREATES A BILLABLE RESOURCE — it says so and asks
          before it does. Safe to re-run: an existing env file is never
          overwritten, and an existing database is reused.

  (none)  Deploy, in order: srh, scorer, sync, app.

--dry-run prints every fly command it would run and makes NONE of them.
Secret VALUES are redacted from that output.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    init) CMD="init"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --from) FROM_ENV="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
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
REDIS_NAME="${REDIS_NAME:-$APP_APP-redis}"

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

  # ---- the managed Redis --------------------------------------------------
  #
  # Fly's managed Redis is Upstash-operated but speaks ONLY the Redis
  # protocol: `fly redis status` hands back `redis://…`, and there is no REST
  # endpoint. The REST API the app/scorer/sync speak is an Upstash CLOUD
  # feature, not part of this integration — which is why srh is deployed in
  # front of it rather than skipped.
  if grep -q "^SRH_CONNECTION_STRING=." "$ENV_FILE" 2>/dev/null; then
    echo "== redis already wired in $ENV_FILE"
  elif [ -n "$DRY_RUN" ]; then
    echo "DRY-RUN: fly redis create --name $REDIS_NAME --region $REGION --no-replicas"
    echo "DRY-RUN: would append SRH_CONNECTION_STRING=<redacted> to $ENV_FILE"
  else
    echo
    echo "  About to create a MANAGED REDIS DATABASE on Fly:"
    echo "      name:   $REDIS_NAME"
    echo "      region: $REGION"
    echo "  This is a billable resource on your Fly account."
    printf "  Type 'create' to continue (anything else aborts): "
    read -r reply
    [ "$reply" = "create" ] || { echo "aborted; nothing was created" >&2; exit 1; }

    require_fly
    fly redis create --name "$REDIS_NAME" --region "$REGION" --no-replicas || {
      echo "FAIL: fly redis create did not succeed." >&2
      echo "      If the database already exists, add its URL by hand:" >&2
      echo "        fly redis status $REDIS_NAME" >&2
      echo "        echo \"SRH_CONNECTION_STRING=redis://…\" >> $ENV_FILE" >&2
      exit 1
    }
    # `fly redis status` prints a table; the private URL is the redis:// token
    # on it. Extracted rather than parsed positionally so a cosmetic change to
    # the table does not silently capture the wrong field.
    url="$(fly redis status "$REDIS_NAME" 2>/dev/null | grep -oE 'redis://[^[:space:]]+' | head -1)"
    if [ -z "$url" ]; then
      echo "FAIL: could not read a redis:// URL out of 'fly redis status $REDIS_NAME'." >&2
      echo "      Read it yourself and append it:" >&2
      echo "        echo \"SRH_CONNECTION_STRING=redis://…\" >> $ENV_FILE" >&2
      exit 1
    fi
    printf 'SRH_CONNECTION_STRING=%s\n' "$url" >> "$ENV_FILE"
    echo "   wired $REDIS_NAME into $ENV_FILE"
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

echo "== apps: $APP_APP / $SCORER_APP / $SYNC_APP / $SRH_APP"

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
SRH_CONNECTION_STRING="$(env_value SRH_CONNECTION_STRING)"
# Name the variable that is ACTUALLY missing. Listing both when only one is
# absent sends the reader to check the one they already set — the exact wrong
# turn, on the message whose only job is to shorten the search.
missing=""
[ -n "$SRH_TOKEN" ] || missing="SRH_TOKEN"
if [ -z "$SRH_CONNECTION_STRING" ]; then
  if [ -n "$missing" ]; then missing="$missing and SRH_CONNECTION_STRING"; else missing="SRH_CONNECTION_STRING"; fi
fi
if [ -n "$missing" ]; then
  echo "FAIL: $missing missing from $ENV_FILE." >&2
  echo "      Run: ./deploy/fly/deploy.sh init --env-file $ENV_FILE" >&2
  case "$missing" in
    *SRH_CONNECTION_STRING*)
      echo "      That provisions the managed Redis and writes its redis:// URL here." >&2
      echo "      It needs the fly CLI: https://fly.io/docs/flyctl/install/" >&2 ;;
  esac
  echo "      (Fly's managed Redis speaks only the Redis protocol, so srh sits" >&2
  echo "       in front of it and serves the REST API the services speak.)" >&2
  exit 1
fi

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

echo "== 1/4 srh (Upstash-REST proxy in front of the managed Redis)"
create_app "$SRH_APP"
fly_run secrets set --app "$SRH_APP" --stage \
  "SRH_TOKEN=$SRH_TOKEN" \
  "SRH_CONNECTION_STRING=$SRH_CONNECTION_STRING"
fly_run deploy --config "$FLY_DIR/srh.fly.toml" --app "$SRH_APP"

echo "== 2/4 scorer"
create_app "$SCORER_APP"
fly_run secrets set --app "$SCORER_APP" --stage \
  "UPSTASH_REDIS_REST_URL=$REST_URL" \
  "UPSTASH_REDIS_REST_TOKEN=$SRH_TOKEN" \
  "CTF_SCORE_BEARER_TOKEN=$(env_value SCORER_TOKEN)"
fly_run deploy --config "$FLY_DIR/scorer.fly.toml" --app "$SCORER_APP" --image "$SCORE_IMAGE"

echo "== 3/4 sync (poll mode)"
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

echo "== 4/4 app"
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
