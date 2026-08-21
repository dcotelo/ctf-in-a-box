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
REGION_ARG=""

usage() {
  cat <<'EOF'
usage: deploy/fly/deploy.sh [init] [--dry-run] [--env-file .env.fly]
                            [--config event.yaml] [--from .env] [--region gru]

  init    Prepare an env file for Fly: copies --from (default .env), rewrites
          EVENT_URL to the app's Fly hostname, and fills in SRH_TOKEN and
          REDIS_PASSWORD if they are absent. Touches nothing on Fly and needs
          no CLI. Asks which Fly region to run in, or takes --region. Safe to re-run — it tops
          up an existing file rather than overwriting it, and tightens it to
          mode 600.

  (none)  Deploy, in order: redis, srh, scorer, sync, app.

          The region comes from FLY_REGION in the env file (init asks), and
          drives both volumes and every `fly deploy --primary-region`.

--dry-run prints every fly command it would run and makes NONE of them.
Secret VALUES are redacted from that output.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    init) CMD="init"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --from) FROM_ENV="$2"; shift 2 ;;
    --region) REGION_ARG="$2"; shift 2 ;;
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

toml_region() {
  # A volume MUST be created in the same region the machine runs in, and
  # `fly volumes create` PROMPTS when no --region is given — which on a real
  # run put the volume in `gru` while the app's primary_region said `iad`.
  # Read it from the same file that declares it, so the two cannot disagree
  # and so the deploy stays non-interactive.
  sed -n 's/^primary_region *= *"\([^"]*\)".*/\1/p' "$FLY_DIR/$1" | head -1
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

  # ---- region ------------------------------------------------------------
  #
  # ASKED, not hardcoded. The toml files carry `primary_region = "iad"` as a
  # default, and on the first real run that was wrong twice over: `fly volumes
  # create` prompted interactively mid-deploy (it needs an explicit --region),
  # and the operator — in Brazil — ended up with a volume in gru against an
  # app configured for iad. Volumes are region-pinned, so fixing that later
  # means destroying them.
  #
  # The answer is written to the env file and drives BOTH the volumes and
  # `fly deploy --primary-region`, so there is one value and nothing to keep
  # in sync by hand.
  if grep -q "^FLY_REGION=." "$ENV_FILE" 2>/dev/null; then
    echo "   FLY_REGION already set ($(sed -n 's/^FLY_REGION=//p' "$ENV_FILE" | tail -1))"
  else
    default_region="${REGION_ARG:-$(toml_region app.fly.toml)}"
    if [ -n "$REGION_ARG" ]; then
      # Given explicitly: no prompt. Lets a scripted or CI run set the region
      # without a tty, and makes the validation below directly testable.
      case "$REGION_ARG" in
        [a-z][a-z][a-z]) ;;
        *) echo "FAIL: '$REGION_ARG' is not a Fly region code (three lowercase letters, e.g. gru)." >&2; exit 1 ;;
      esac
      if [ -z "$DRY_RUN" ]; then printf 'FLY_REGION=%s\n' "$REGION_ARG" >> "$ENV_FILE"; fi
      echo "   region: $REGION_ARG"
    elif [ -n "$DRY_RUN" ]; then
      echo "DRY-RUN: would ask for a region (default $default_region)"
    elif [ -t 0 ]; then
      echo
      echo "  Which Fly region should the event run in?"
      echo "    Pick the one nearest your contestants — it is where the app,"
      echo "    the datastore and both volumes live. Volumes are region-pinned,"
      echo "    so changing this later means destroying and recreating them."
      echo
      echo "    Common: iad (Virginia)  gru (Sao Paulo)  lhr (London)"
      echo "            fra (Frankfurt) syd (Sydney)     nrt (Tokyo)"
      echo "    Full list: fly platform regions"
      echo
      printf "  Region [%s]: " "$default_region"
      read -r reply
      region="${reply:-$default_region}"
      # A region code is three lowercase letters. Catching a typo here beats
      # discovering it as an opaque failure part-way through the deploy.
      case "$region" in
        [a-z][a-z][a-z]) ;;
        *) echo "FAIL: '$region' is not a Fly region code (three lowercase letters, e.g. gru)." >&2; exit 1 ;;
      esac
      printf 'FLY_REGION=%s\n' "$region" >> "$ENV_FILE"
      echo "   region: $region"
    else
      # Non-interactive (a test, a CI job): take the default rather than hang.
      printf 'FLY_REGION=%s\n' "$default_region" >> "$ENV_FILE"
      echo "   region: $default_region (no tty — took the default)"
    fi
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

# EVENT_URL's host vs the app it will actually be served from.
#
# WARNS, NEVER FAILS. A custom domain is a first-class setup — `fly certs add`
# then EVENT_URL pointing at it — so a mismatch is not wrong by itself. What
# IS wrong, and common, is a *.fly.dev host naming an app that does not exist:
# rename the apps in these toml files and forget the env file, or the reverse,
# and the deploy succeeds while BETTER_AUTH_URL claims a hostname nothing
# answers on. That surfaces at sign-in as an opaque redirect_uri mismatch,
# long after the deploy that caused it.
EVENT_HOST="${EVENT_URL#https://}"
EVENT_HOST="${EVENT_HOST%%/*}"
case "$EVENT_HOST" in
  "$APP_APP.fly.dev") ;;                       # exactly right
  *.fly.dev)
    # A fly.dev host is a claim about an app name, and this one disagrees.
    echo "WARNING: EVENT_URL is https://$EVENT_HOST, but the app deploys as '$APP_APP'" >&2
    echo "         and will be served at https://$APP_APP.fly.dev." >&2
    echo "         Sign-in will fail with a redirect_uri mismatch. Either set" >&2
    echo "           EVENT_URL=https://$APP_APP.fly.dev" >&2
    echo "         or rename the apps in deploy/fly/*.fly.toml to match." >&2
    echo >&2 ;;
  *)
    # A custom domain. Legitimate, but it only works once a certificate
    # exists, so say the command rather than assuming it was run.
    echo "NOTE: EVENT_URL is a custom domain ($EVENT_HOST), not *.fly.dev." >&2
    echo "      That needs: fly certs add $EVENT_HOST --app $APP_APP" >&2
    echo >&2 ;;
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

# One region for every app and both volumes. From the env file when init
# asked for it, else the toml's primary_region as the documented default.
REGION="$(env_value FLY_REGION)"
[ -n "$REGION" ] || REGION="$(toml_region app.fly.toml)"

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
  # Existence is asked DIRECTLY, not scraped out of `fly apps list`'s
  # human-readable table. That table is formatted for people, and matching
  # "^name<whitespace>" against it silently failed on a real re-run: the app
  # existed, the check said it did not, `fly apps create` ran, and the deploy
  # died on `Validation failed: Name has already been taken`. A check-then-act
  # step that cannot see the state it is checking is not idempotent, which is
  # the one property this whole script is supposed to have.
  if fly status --app "$1" >/dev/null 2>&1; then
    echo "   app $1 exists"
    return 0
  fi
  if fly apps create "$1"; then
    return 0
  fi
  # Fly app names are unique across ALL of Fly, not just this organization, so
  # a plausible name may be held by someone else entirely. Say that, because
  # the raw error reads like a bug in this script.
  echo "FAIL: could not create app '$1'." >&2
  echo "      Fly app names are globally unique — this one may be taken by an" >&2
  echo "      app you cannot see, or held by an earlier attempt in another org." >&2
  echo "      Rename all five apps to something event-specific:" >&2
  echo "        sed -i '' 's/^app = \"ctf-in-a-box-/app = \"my-event-/' deploy/fly/*.fly.toml" >&2
  echo "      then set EVENT_URL to match the new app name." >&2
  exit 1
}

echo "== 1/5 redis"
create_app "$REDIS_APP"
# Durable store for scores, teams and hint purchases — the same named-volume
# arrangement as compose's `redis-data`.
if [ -n "$DRY_RUN" ]; then
  echo "DRY-RUN: fly volumes create ctf_redis_data --app $REDIS_APP --size 1 --region $REGION (if absent)"
elif fly volumes list --app "$REDIS_APP" 2>/dev/null | grep -q ctf_redis_data; then
  echo "   volume ctf_redis_data exists"
else
  fly volumes create ctf_redis_data --app "$REDIS_APP" --size 1 \
    --region "$REGION" --yes
fi
fly_run secrets set --app "$REDIS_APP" --stage "REDIS_PASSWORD=$REDIS_PASSWORD"
fly_run deploy --config "$FLY_DIR/redis.fly.toml" --app "$REDIS_APP" --primary-region "$REGION"

echo "== 2/5 srh (the Upstash-REST API the services speak)"
create_app "$SRH_APP"
fly_run secrets set --app "$SRH_APP" --stage \
  "SRH_TOKEN=$SRH_TOKEN" \
  "SRH_CONNECTION_STRING=$SRH_CONNECTION_STRING"
fly_run deploy --config "$FLY_DIR/srh.fly.toml" --app "$SRH_APP" --primary-region "$REGION"

echo "== 3/5 scorer"
create_app "$SCORER_APP"
fly_run secrets set --app "$SCORER_APP" --stage \
  "UPSTASH_REDIS_REST_URL=$REST_URL" \
  "UPSTASH_REDIS_REST_TOKEN=$SRH_TOKEN" \
  "CTF_SCORE_BEARER_TOKEN=$(env_value SCORER_TOKEN)"
# ---------------------------------------------------------------------------
# MIRROR THE SCORER IMAGE INTO FLY'S REGISTRY.
#
# Fly cannot pull from a private third-party registry. `fly deploy --image
# ghcr.io/<org>/score:latest` fails with:
#
#   Authentication required to access image "ghcr.io/<org>/score:latest"
#
# and there is no flag for supplying credentials — Fly's documented answer for
# private images is its own registry, registry.fly.io/<app>.
#
# So this MIRRORS rather than rebuilds, and that distinction is the point: the
# scorer serving the leaderboard has to be the same artifact the forks pull to
# judge PRs, or a rubric difference between them shows up as totals that
# disagree with the scores. `buildx imagetools create` copies the manifest
# registry-to-registry — no local pull, no re-tag of a single-arch layer, and
# the digest is preserved exactly.
#
# This is the same move `ctf-setup org` already makes when it mirrors
# SCORE_IMAGE into the event org's GHCR so the forks' Actions can pull it.
# Same pattern, different destination.
FLY_IMAGE="registry.fly.io/$SCORER_APP:latest"
if [ -n "$DRY_RUN" ]; then
  echo "DRY-RUN: fly auth docker"
  echo "DRY-RUN: docker buildx imagetools create --tag $FLY_IMAGE $SCORE_IMAGE"
else
  command -v docker >/dev/null || {
    echo "FAIL: docker is required to mirror the scorer image into Fly's registry." >&2
    exit 1
  }
  echo "   mirroring $SCORE_IMAGE -> $FLY_IMAGE"
  # Authenticates the local docker client for registry.fly.io only; the GHCR
  # side uses the login the operator already has from pushing the image.
  fly auth docker >/dev/null || { echo "FAIL: fly auth docker failed" >&2; exit 1; }
  if ! docker buildx imagetools create --tag "$FLY_IMAGE" "$SCORE_IMAGE" 2>/dev/null; then
    # buildx is not always present. Fall back to pull/tag/push, pinning
    # linux/amd64 — the forks' runners are amd64, and an arm64 pull on an
    # Apple Silicon machine would mirror an image the scorer cannot run.
    echo "   (buildx imagetools unavailable — falling back to pull/tag/push)"
    docker pull --platform linux/amd64 "$SCORE_IMAGE" || {
      echo "FAIL: cannot pull $SCORE_IMAGE. Run: docker login ghcr.io" >&2
      exit 1
    }
    docker tag "$SCORE_IMAGE" "$FLY_IMAGE"
    docker push "$FLY_IMAGE" || { echo "FAIL: cannot push to $FLY_IMAGE" >&2; exit 1; }
  fi
fi
fly_run deploy --config "$FLY_DIR/scorer.fly.toml" --app "$SCORER_APP" --image "$FLY_IMAGE" --primary-region "$REGION"

echo "== 4/5 sync (poll mode)"
create_app "$SYNC_APP"
# The cursor volume. Without it the poller re-reads every comment in every
# fork after each restart — see sync.fly.toml.
if [ -n "$DRY_RUN" ]; then
  echo "DRY-RUN: fly volumes create ctf_sync_state --app $SYNC_APP --size 1 --region $REGION (if absent)"
elif fly volumes list --app "$SYNC_APP" 2>/dev/null | grep -q ctf_sync_state; then
  echo "   volume ctf_sync_state exists"
else
  fly volumes create ctf_sync_state --app "$SYNC_APP" --size 1 \
    --region "$REGION" --yes
fi
fly_run secrets set --app "$SYNC_APP" --stage \
  "UPSTASH_REDIS_REST_URL=$REST_URL" \
  "UPSTASH_REDIS_REST_TOKEN=$SRH_TOKEN" \
  "SCORER_TOKEN=$(env_value SCORER_TOKEN)" \
  "GITHUB_APP_ID=$(env_value GITHUB_APP_ID)" \
  "GITHUB_APP_PRIVATE_KEY=$(env_value GITHUB_APP_PRIVATE_KEY)" \
  "GITHUB_APP_INSTALLATION_ID=$(env_value GITHUB_APP_INSTALLATION_ID)"
# Built from the repo root so event.yaml is in the build context.
fly_run deploy --config "$FLY_DIR/sync.fly.toml" --app "$SYNC_APP" --dockerfile "$FLY_DIR/sync.Dockerfile" --primary-region "$REGION"

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
  --primary-region "$REGION" --build-arg "EVENT_CONFIG_B64=$EVENT_CONFIG_B64"

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
