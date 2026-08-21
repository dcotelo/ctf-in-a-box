#!/usr/bin/env bash
# Stand the kit up on fly.io: ONE app, ONE machine, every container in it.
#
# The machine runs the same five services docker-compose.yml defines — app,
# scorer, sync, srh, redis — from a compose file rendered out of that very
# file, so the deployed wiring cannot drift from the local one. See fly.toml
# for why it is one app rather than five (short version: srh's Redis client is
# IPv4-only and Fly's private network is IPv6-only, so the containers have to
# share a network namespace and talk over localhost).
#
# Idempotent by design, like ctf-setup.sh: every step checks before it acts, so
# re-running after a failure resumes rather than duplicating. Secrets are set
# through `fly secrets`, never written into a file.
set -euo pipefail
cd "$(dirname "$0")/../.."

FLY_DIR=deploy/fly
CONFIG_TOML="$FLY_DIR/fly.toml"
RENDERED="compose.fly.yml"
DRY_RUN=""
ENV_FILE=".env.fly"
CONFIG="event.yaml"
FROM_ENV=".env"
CMD="deploy"
REGION_ARG=""
REFRESH=""
SKIP_BUILD=""

usage() {
  cat <<'EOF'
usage: deploy/fly/deploy.sh [init] [--dry-run] [--env-file .env.fly]
                            [--config event.yaml] [--from .env] [--region gru]
                            [--skip-build]

  init --refresh
          Re-copy the credentials that must match an EXTERNAL system (GitHub
          OAuth, the sync App, the scorer image) from --from into the env
          file, overwriting what is there. Run this after rotating anything.
          Fly-specific values (EVENT_URL, FLY_REGION, SRH_TOKEN,
          REDIS_PASSWORD) are left alone — they belong to this deployment.

  init    Prepare an env file for Fly: copies --from (default .env), rewrites
          EVENT_URL to the app's Fly hostname, and fills in SRH_TOKEN and
          REDIS_PASSWORD if they are absent. Touches nothing on Fly and needs
          no CLI. Asks which Fly region to run in, or takes --region. Safe to
          re-run — it tops up an existing file rather than overwriting it, and
          tightens it to mode 600.

  (none)  Deploy: build and push the app and sync images, mirror the scorer
          image, render the compose file, set secrets, deploy the machine.

          The region comes from FLY_REGION in the env file (init asks), and
          drives both volumes and `fly deploy --primary-region`.

--skip-build reuses the images already in Fly's registry. Use it when only
  event.yaml or a secret changed — it turns a multi-minute rebuild into a
  redeploy. It does NOT skip the app image when event.yaml changed, because
  that config is baked at build time; the script refuses the combination.
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
    --refresh) REFRESH=1; shift ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --config) CONFIG="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
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
# the run still shows exactly which variables are set — which is the whole
# point of previewing it — without showing what they are.
redact_arg() {
  case "$1" in
    *=*)
      name="${1%%=*}"
      case "$name" in
        # CONNECTION_STRING is here because a redis:// URL embeds the
        # password. It was missed on the first pass and caught by reading the
        # dry-run's own output — which is the argument for previewing.
        *SECRET*|*TOKEN*|*PRIVATE_KEY*|*PASSWORD*|*CONNECTION_STRING*|*AUTH|EVENT_CONFIG_B64)
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

toml_value() {
  # `key = "value"` out of fly.toml, without a TOML parser (no jq/python on
  # this path, same rule as the provisioning scripts).
  sed -n "s/^$1 *= *\"\([^\"]*\)\".*/\1/p" "$CONFIG_TOML" | head -1
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

APP="$(toml_value app)"

# Checked at the point of use, not up front: `init`'s env-file half needs no
# CLI at all, and refusing to prepare a file because flyctl is not installed
# yet would be a gate on the one step that does not touch Fly.
require_fly() {
  command -v fly >/dev/null || { echo "fly CLI missing: https://fly.io/docs/flyctl/install/" >&2; exit 1; }
}

# ---------------------------------------------------------------------------
# init — prepare the env file.
#
# Split from `deploy` because the values it captures are then just ordinary
# env-file entries a human can read and edit. Idempotent: it never overwrites
# an existing env file, only tops it up.
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
        echo "EVENT_URL=https://$APP.fly.dev"
      } > "$ENV_FILE"
      chmod 600 "$ENV_FILE"
    else
      echo "DRY-RUN: would write $ENV_FILE (mode 600) with EVENT_URL=https://$APP.fly.dev"
    fi
  fi

  # ---- --refresh ---------------------------------------------------------
  #
  # init deliberately never overwrites an existing env file, which means a
  # rotated credential in .env never reaches .env.fly. That cost a live
  # debugging session: the OAuth client secret was rotated after a leak, the
  # Fly file kept the OLD one, and GitHub rejected the code exchange as
  # `?error=invalid_code` — an error that names nothing and points nowhere.
  #
  # The split is by OWNERSHIP, not convenience. These values must match an
  # external system (GitHub's OAuth app, GitHub's sync App, the registry), so
  # a stale copy is always wrong and refreshing is always right. EVENT_URL,
  # FLY_REGION, SRH_TOKEN and REDIS_PASSWORD belong to THIS deployment and
  # must never be pulled from a compose stack's file — sharing them is how
  # two environments end up fighting over one datastore.
  if [ -n "$REFRESH" ]; then
    [ -f "$FROM_ENV" ] || { echo "no $FROM_ENV to refresh from" >&2; exit 1; }
    echo "== refreshing external credentials from $FROM_ENV"
    for key in GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET GITHUB_APP_ID \
               GITHUB_APP_PRIVATE_KEY GITHUB_APP_INSTALLATION_ID SCORE_IMAGE; do
      src="$(sed -n "s/^$key=//p" "$FROM_ENV" | tail -1)"
      [ -n "$src" ] || continue
      cur="$(sed -n "s/^$key=//p" "$ENV_FILE" | tail -1)"
      if [ "$src" = "$cur" ]; then
        echo "   $key unchanged"
        continue
      fi
      if [ -n "$DRY_RUN" ]; then
        echo "DRY-RUN: would update $key"
        continue
      fi
      # Rewritten in place with awk rather than sed -i, because these values
      # contain / and + (base64) and would need escaping in a sed pattern.
      awk -v k="$key" -v v="$src" \
        'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' \
        "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
      chmod 600 "$ENV_FILE"
      echo "   $key updated"
    done
    echo
    echo "  Now redeploy so the machine picks them up:"
    echo "      ./deploy/fly/deploy.sh --env-file $ENV_FILE"
    exit 0
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
  # ASKED, not hardcoded. fly.toml carries `primary_region = "iad"` as a
  # default, and on the first real run that was wrong twice over: `fly volumes
  # create` prompted interactively mid-deploy (it needs an explicit --region),
  # and the operator — in Brazil — ended up with a volume in gru against an
  # app configured for iad. Volumes are region-pinned, so fixing that later
  # means destroying them.
  if grep -q "^FLY_REGION=." "$ENV_FILE" 2>/dev/null; then
    echo "   FLY_REGION already set ($(sed -n 's/^FLY_REGION=//p' "$ENV_FILE" | tail -1))"
  else
    default_region="${REGION_ARG:-$(toml_value primary_region)}"
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
      echo "    Pick the one nearest your contestants — it is where the whole"
      echo "    event runs, and where both volumes live. Volumes are"
      echo "    region-pinned, so changing this later means recreating them."
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

  # Redis credential. The datastore is our own `redis:7-alpine` container,
  # authenticated with the same REDIS_PASSWORD the compose stack uses — so an
  # env file copied from a working compose deployment already has it.
  if grep -q "^REDIS_PASSWORD=." "$ENV_FILE" 2>/dev/null; then
    echo "   REDIS_PASSWORD already set"
  elif [ -z "$DRY_RUN" ]; then
    printf 'REDIS_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> "$ENV_FILE"
    echo "   generated REDIS_PASSWORD"
  else
    echo "DRY-RUN: would generate REDIS_PASSWORD"
  fi

  # ---- the single-volume layout ------------------------------------------
  #
  # A Fly machine permits exactly ONE volume ("invalid config.mounts, only 1
  # volume supported"), so redis and sync share it under separate directories.
  # docker-compose.yml declares both as knobs defaulting to the local paths;
  # these are the values that move them onto the shared mount.
  #
  # Written to the env file rather than hardcoded in the renderer so an
  # organizer can see — and change — where their data actually lives.
  for pair in "REDIS_DIR=/data/redis" "STATE_PATH=/data/sync/state.json"; do
    key="${pair%%=*}"
    if grep -q "^$key=." "$ENV_FILE" 2>/dev/null; then
      echo "   $key already set"
    elif [ -z "$DRY_RUN" ]; then
      printf '%s\n' "$pair" >> "$ENV_FILE"
      echo "   set $pair"
    else
      echo "DRY-RUN: would set $pair"
    fi
  done

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

echo "== app: $APP (one machine, five containers)"

# ---------------------------------------------------------------------------
# EVENT_URL must be the fly hostname, and it must be https.
#
# The app refuses to serve a production event over plain HTTP to a non-local
# host (ADR 39) — so a leftover http://localhost would deploy an app that
# answers 500 to everything. Catch it here, where the message can name the
# fix, rather than in a container log.
# ---------------------------------------------------------------------------
EVENT_URL="$(env_value EVENT_URL)"
EXPECTED_URL="https://$APP.fly.dev"
# A placeholder that was never filled in. It passes the https:// test below,
# so without this it deploys — and the failure surfaces much later as a
# redirect_uri mismatch at sign-in, on a BETTER_AUTH_URL nobody can resolve.
case "$EVENT_URL" in
  *"<"*|*">"*|*" "*)
    echo "FAIL: EVENT_URL in $ENV_FILE is '$EVENT_URL' — that still has a placeholder in it." >&2
    echo "      Set it to your real hostname, normally:" >&2
    echo "        EVENT_URL=https://$APP.fly.dev" >&2
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
# IS wrong, and common, is a *.fly.dev host naming an app that does not exist.
EVENT_HOST="${EVENT_URL#https://}"
EVENT_HOST="${EVENT_HOST%%/*}"
case "$EVENT_HOST" in
  "$APP.fly.dev") ;;                           # exactly right
  *.fly.dev)
    # A fly.dev host is a claim about an app name, and this one disagrees.
    echo "WARNING: EVENT_URL is https://$EVENT_HOST, but the app deploys as '$APP'" >&2
    echo "         and will be served at https://$APP.fly.dev." >&2
    echo "         Sign-in will fail with a redirect_uri mismatch. Either set" >&2
    echo "           EVENT_URL=https://$APP.fly.dev" >&2
    echo "         or rename the app in deploy/fly/fly.toml to match." >&2
    echo >&2 ;;
  *)
    # A custom domain. Legitimate, but it only works once a certificate
    # exists, so say the command rather than assuming it was run.
    echo "NOTE: EVENT_URL is a custom domain ($EVENT_HOST), not *.fly.dev." >&2
    echo "      That needs: fly certs add $EVENT_HOST --app $APP" >&2
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

REGION="$(env_value FLY_REGION)"
[ -n "$REGION" ] || REGION="$(toml_value primary_region)"

# The image the FORKS already pull to judge PRs — same one, not a rebuild.
SCORE_IMAGE="$(env_value SCORE_IMAGE)"
require SCORE_IMAGE "$SCORE_IMAGE"

# Everything lives in one machine, so every address is loopback. srh's Redis
# client is IPv4-only, which is precisely why 127.0.0.1 — and not a Fly
# private hostname — is the only address that works here (see fly.toml).
SRH_CONNECTION_STRING="redis://:$REDIS_PASSWORD@127.0.0.1:6379"

# The event config, baked into the app image at BUILD time and handed to sync
# at START-UP. Deploy the app without it and the build silently succeeds with
# an EMPTY admins list — /admin then 403s for everyone, including the
# organizer — and generic branding. There is no runtime error to notice.
if [ -f "$CONFIG" ]; then
  EVENT_CONFIG_B64="$(base64 < "$CONFIG" | tr -d '\n')"
else
  EVENT_CONFIG_B64=""
fi

APP_IMAGE="registry.fly.io/$APP:app"
SYNC_IMAGE="registry.fly.io/$APP:sync"
SCORER_IMAGE="registry.fly.io/$APP:scorer"

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
  echo "      Rename it to something event-specific:" >&2
  echo "        sed -i '' 's/^app = \"ctf-in-a-box\"/app = \"my-event\"/' $CONFIG_TOML" >&2
  echo "      then set EVENT_URL to match the new app name." >&2
  exit 1
}

make_volume() {
  # A volume MUST be created in the same region the machine runs in, and
  # `fly volumes create` PROMPTS when no --region is given — which on a real
  # run put the volume in `gru` while the app's primary_region said `iad`.
  if [ -n "$DRY_RUN" ]; then
    echo "DRY-RUN: fly volumes create $1 --app $APP --size 1 --region $REGION (if absent)"
  elif fly volumes list --app "$APP" 2>/dev/null | grep -q "$1"; then
    echo "   volume $1 exists"
  else
    fly volumes create "$1" --app "$APP" --size 1 --region "$REGION" --yes
  fi
}

echo "== 1/5 app exists"
create_app "$APP"
# ONE volume: a Fly machine permits no more than one ("invalid config.mounts,
# only 1 volume supported"). redis and sync share it under separate
# directories, set by REDIS_DIR and STATE_PATH in the env file.
make_volume ctf_data

# ---------------------------------------------------------------------------
# 2/5 Images.
#
# Fly builds NOTHING here, and that is deliberate. Its compose parser cannot
# pass build args (so EVENT_CONFIG_B64 could never be baked) and refuses a file
# where more than one service declares `build:` — which docker-compose.yml does
# twice. Building here instead means the machine runs the exact images this
# checkout produces, which is a stronger parity guarantee than a rebuild.
#
# --platform linux/amd64 is not optional. Fly machines are amd64; an image
# built on Apple Silicon without it is arm64 and fails at start with an exec
# format error, after a successful-looking deploy.
# ---------------------------------------------------------------------------
echo "== 2/5 images"
if [ -n "$SKIP_BUILD" ] && [ -n "$EVENT_CONFIG_B64" ]; then
  # The app bakes event.yaml at build time, so "skip the build" and "pick up
  # the new event.yaml" are contradictory instructions. Refuse rather than
  # deploy a stale config that looks deployed.
  echo "NOTE: --skip-build reuses the app image already in Fly's registry."
  echo "      If you changed $CONFIG, drop --skip-build — that config is baked"
  echo "      into the app image at build time and will NOT be picked up."
fi

if [ -n "$DRY_RUN" ]; then
  echo "DRY-RUN: fly auth docker"
  echo "DRY-RUN: docker build --platform linux/amd64 -f apps/web/Dockerfile --build-arg EVENT_CONFIG_B64=<redacted> -t $APP_IMAGE ."
  echo "DRY-RUN: docker push $APP_IMAGE"
  echo "DRY-RUN: docker build --platform linux/amd64 -t $SYNC_IMAGE ./sync"
  echo "DRY-RUN: docker push $SYNC_IMAGE"
  echo "DRY-RUN: docker buildx imagetools create --tag $SCORER_IMAGE $SCORE_IMAGE"
elif [ -n "$SKIP_BUILD" ]; then
  echo "   --skip-build: reusing $APP_IMAGE, $SYNC_IMAGE and $SCORER_IMAGE"
else
  command -v docker >/dev/null || {
    echo "FAIL: docker is required to build and mirror the images." >&2
    exit 1
  }
  # Authenticates the local docker client for registry.fly.io; the GHCR side
  # uses the login the operator already has from pushing the scorer image.
  fly auth docker >/dev/null || { echo "FAIL: fly auth docker failed" >&2; exit 1; }

  echo "   building app -> $APP_IMAGE"
  docker build --platform linux/amd64 -f apps/web/Dockerfile \
    --build-arg "EVENT_CONFIG_B64=$EVENT_CONFIG_B64" -t "$APP_IMAGE" .
  docker push "$APP_IMAGE"

  echo "   building sync -> $SYNC_IMAGE"
  docker build --platform linux/amd64 -t "$SYNC_IMAGE" ./sync
  docker push "$SYNC_IMAGE"

  # MIRROR, DO NOT REBUILD. Fly cannot pull from a private third-party
  # registry ("Authentication required to access image ...") and has no flag
  # for supplying credentials; its documented answer is its own registry. The
  # scorer serving the leaderboard has to be the same artifact the forks pull
  # to judge PRs, or a rubric difference between them shows up as totals that
  # disagree. `buildx imagetools create` copies the manifest
  # registry-to-registry, preserving the digest exactly.
  echo "   mirroring $SCORE_IMAGE -> $SCORER_IMAGE"
  if ! docker buildx imagetools create --tag "$SCORER_IMAGE" "$SCORE_IMAGE" 2>/dev/null; then
    echo "   (buildx imagetools unavailable — falling back to pull/tag/push)"
    docker pull --platform linux/amd64 "$SCORE_IMAGE" || {
      echo "FAIL: cannot pull $SCORE_IMAGE. Run: docker login ghcr.io" >&2
      exit 1
    }
    docker tag "$SCORE_IMAGE" "$SCORER_IMAGE"
    docker push "$SCORER_IMAGE" || { echo "FAIL: cannot push to $SCORER_IMAGE" >&2; exit 1; }
  fi

  # ---- the mirrored image must actually run on a Fly machine ---------------
  #
  # `buildx imagetools create` MIRRORS: it faithfully copies whatever the
  # source is, including a single-arch arm64 image built on an Apple Silicon
  # laptop. Fly machines are amd64, and the failure surfaces at the very END of
  # the deploy — after both images are rebuilt, pushed and the secrets set:
  #
  #   failed to resolve image for container "scorer":
  #   platform not found: linux/amd64
  #
  # The app and sync images cannot hit this because THIS script builds them
  # with --platform linux/amd64. The scorer is the one image built elsewhere,
  # by hand, following docs/scorer.md — so it is the one that needs checking.
  # ONLY fails when the platforms are KNOWN and amd64 is absent.
  #
  # The first version treated "inspect failed" as "no amd64" and blocked a
  # perfectly good deploy: registry.fly.io returns transient errors (the same
  # flakiness that produces `app repository not found` on a push), stderr went
  # to /dev/null, and an empty result read as a missing platform. A check that
  # cannot tell "absent" from "could not look" is worse than no check — it
  # fails exactly when the registry is briefly unwell, which is unrelated to
  # the thing it is guarding.
  #
  # One retry, because the flakiness is transient. If both attempts fail the
  # deploy CONTINUES with a warning: an unverified platform is Fly's problem to
  # report, and it reports it clearly.
  platforms=""
  for _ in 1 2; do
    platforms="$(docker buildx imagetools inspect "$SCORER_IMAGE" 2>&1 || true)"
    case "$platforms" in *Platform:*) break ;; esac
    platforms=""
  done
  if [ -z "$platforms" ]; then
    echo "   NOTE: could not inspect $SCORER_IMAGE to verify its platform — continuing." >&2
  elif ! printf '%s' "$platforms" | grep -q "linux/amd64"; then
    echo "FAIL: $SCORE_IMAGE has no linux/amd64 build, so Fly cannot run it." >&2
    echo "      Fly machines are amd64. An image built on Apple Silicon without" >&2
    echo "      an explicit platform is arm64 only, and this mirrors it faithfully." >&2
    echo "      Rebuild it and push again:" >&2
    echo "        docker build --platform linux/amd64 -t $SCORE_IMAGE scorer/" >&2
    echo "        docker push $SCORE_IMAGE" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# PIN EVERY IMAGE BY DIGEST, not by tag.
#
# A tag is a moving pointer, and Fly resolves it when the machine starts. A
# rebuilt-and-repushed `:scorer` therefore did NOT reach a running machine: the
# registry held the new image, the machine kept serving the old one, and the
# only symptom was a 404 on a route the new build has and the old one does not.
# Nothing in the deploy output was wrong, which is what made it expensive.
#
# Resolving here means the rendered compose names the exact artifact that was
# just pushed, so what runs is what was built. It matches how docker-compose.yml
# already pins srh, and it makes a deploy reproducible: the same file redeployed
# later brings up the same bytes rather than whatever the tag points at then.
#
# Falls back to the tag if resolution fails (an old buildx without --format).
# A deploy that still works on a tag beats a deploy that refuses to run.
# ---------------------------------------------------------------------------
pin_digest() {
  local ref="$1" repo digest
  repo="${ref%%:*}"
  digest="$(docker buildx imagetools inspect "$ref" --format '{{.Manifest.Digest}}' 2>/dev/null || true)"
  case "$digest" in
    sha256:*) echo "$repo@$digest" ;;
    *) echo "$ref" ;;
  esac
}

if [ -z "$DRY_RUN" ] && command -v docker >/dev/null; then
  APP_IMAGE="$(pin_digest "$APP_IMAGE")"
  SYNC_IMAGE="$(pin_digest "$SYNC_IMAGE")"
  SCORER_IMAGE="$(pin_digest "$SCORER_IMAGE")"
  echo "   pinned scorer -> ${SCORER_IMAGE#*@}"
fi

# ---------------------------------------------------------------------------
# 3/5 Render the compose file Fly deploys, out of the real docker-compose.yml.
# ---------------------------------------------------------------------------
echo "== 3/5 rendering $RENDERED from docker-compose.yml"
if [ -n "$DRY_RUN" ] && [ ! -f "$ENV_FILE" ]; then
  echo "DRY-RUN: would render $RENDERED (no $ENV_FILE to render from)"
else
  "$FLY_DIR/render-compose.sh" --env-file "$ENV_FILE" --out "$RENDERED" \
    --app-image "$APP_IMAGE" --sync-image "$SYNC_IMAGE" --scorer-image "$SCORER_IMAGE" \
    --event-config "$CONFIG"
fi

# The rendered file holds every credential the event has, so it does not
# outlive the deploy that needs it. Removed on ANY exit — including a failed
# or interrupted deploy, which is exactly when a forgotten credential file is
# most likely to be left behind and least likely to be noticed.
#
# A dry run keeps it: reviewing it is the point of previewing, nothing has
# been sent anywhere, and it is mode 600 and gitignored either way.
cleanup_rendered() {
  if [ -z "$DRY_RUN" ]; then
    rm -f "$RENDERED"
  fi
  # The autostop config is a derived copy of fly.toml and holds nothing
  # sensitive, but it goes too: leaving it behind invites someone to edit the
  # copy and wonder why their change never deploys.
  rm -f "$FLY_DIR/.fly.autostop.toml"
}
trap cleanup_rendered EXIT INT TERM

# ---------------------------------------------------------------------------
# 4/5 Secrets.
#
# ONE app now, so ONE `fly secrets set`. Fly injects secrets as environment
# variables into EVERY container in the machine, which is what lets the
# rendered compose file carry no credentials at all: the variable names
# already match across services.
#
# The flip side is that scoping is impossible — the app container also
# receives REDIS_PASSWORD, and the redis container also receives
# GITHUB_CLIENT_SECRET. That is a Fly platform limit, not a choice here, and
# it is recorded in ADR 42 alongside the loss of the frontend/backend split.
#
# NOTE: no `--stage`. `--stage` means "hold these, apply on the next deploy",
# and on a real run it left six secrets permanently staged — better-auth with
# no baseURL and no signing secret answers 403 to /api/auth/sign-in/social, so
# sign-in was broken with nothing in the app's own logs to explain it.
# `--detach` keeps it from blocking on the machine restart, since the deploy
# that follows waits anyway.
# ---------------------------------------------------------------------------
echo "== 4/5 secrets"
fly_run secrets set --detach --app "$APP" \
  "BETTER_AUTH_SECRET=$(env_value BETTER_AUTH_SECRET)" \
  "BETTER_AUTH_URL=$EVENT_URL" \
  "GITHUB_CLIENT_SECRET=$(env_value GITHUB_CLIENT_SECRET)" \
  "SRH_TOKEN=$SRH_TOKEN" \
  "SRH_CONNECTION_STRING=$SRH_CONNECTION_STRING" \
  "UPSTASH_REDIS_REST_TOKEN=$SRH_TOKEN" \
  "CTF_SCORE_BEARER_TOKEN=$(env_value SCORER_TOKEN)" \
  "SCORER_TOKEN=$(env_value SCORER_TOKEN)" \
  "GITHUB_APP_ID=$(env_value GITHUB_APP_ID)" \
  "GITHUB_APP_PRIVATE_KEY=$(env_value GITHUB_APP_PRIVATE_KEY)" \
  "GITHUB_APP_INSTALLATION_ID=$(env_value GITHUB_APP_INSTALLATION_ID)" \
  "REDIS_PASSWORD=$REDIS_PASSWORD" \
  "REDISCLI_AUTH=$REDIS_PASSWORD" \
  "EVENT_CONFIG_B64=$EVENT_CONFIG_B64"

# ---------------------------------------------------------------------------
# FLY_AUTO_STOP — let the machine stop when idle. OFF unless asked for.
#
# There is no `fly deploy` flag for this: `auto_stop_machines` lives in
# fly.toml, and `fly machine update --autostop` is undone by the next deploy.
# So when the knob is set, the committed fly.toml is rendered to a temporary
# copy with the value substituted and THAT is deployed. fly.toml itself is
# never edited — a deploy that dirties a tracked file is a deploy that gets
# committed by accident.
#
#   off      (default) always running
#   stop     stopped when idle; cold start on the next request
#   suspend  memory snapshotted and restored; much faster wake, costs storage
#
# min_machines_running must drop to 0 alongside it, or Fly keeps one machine up
# and the setting does nothing — a silent no-op that looks like it worked.
# ---------------------------------------------------------------------------
DEPLOY_TOML="$CONFIG_TOML"
AUTO_STOP="$(env_value FLY_AUTO_STOP)"
[ -n "$AUTO_STOP" ] || AUTO_STOP="off"
case "$AUTO_STOP" in
  off) ;;
  stop|suspend)
    echo
    echo "WARNING: FLY_AUTO_STOP=$AUTO_STOP — this machine will stop when idle." >&2
    echo "         It holds redis AND the sync poller, so while it is stopped the" >&2
    echo "         leaderboard does not advance: PR score comments pile up on" >&2
    echo "         GitHub and are only collected once someone loads a page and" >&2
    echo "         wakes the machine. Fine between events, wrong during one." >&2
    echo "         Set FLY_AUTO_STOP=off in $ENV_FILE before the event starts." >&2
    echo
    DEPLOY_TOML="$FLY_DIR/.fly.autostop.toml"
    if [ -z "$DRY_RUN" ]; then
      sed -e "s/^  auto_stop_machines = false/  auto_stop_machines = \"$AUTO_STOP\"/" \
          -e "s/^  min_machines_running = 1/  min_machines_running = 0/" \
          "$CONFIG_TOML" > "$DEPLOY_TOML"
      # Fail loudly rather than deploying a config where the substitution
      # silently missed — a renamed key here would just quietly keep the
      # machine running forever while the operator believed otherwise.
      grep -q "auto_stop_machines = \"$AUTO_STOP\"" "$DEPLOY_TOML" || {
        echo "FAIL: could not set auto_stop_machines in $CONFIG_TOML." >&2
        rm -f "$DEPLOY_TOML"
        exit 1
      }
    fi
    ;;
  *)
    echo "FAIL: FLY_AUTO_STOP=$AUTO_STOP is not valid. Use off, stop or suspend." >&2
    exit 1 ;;
esac

echo "== 5/5 deploy"
# `--image`, AND IT IS REQUIRED HERE.
#
# flyctl's compose parser is happy with zero buildable services — it only
# rejects MORE than one ("only one service can specify build") — but `fly
# deploy` still resolves a machine image of its own before it gets that far,
# and with no `[build]` section it has nothing to resolve:
#
#   Error: failed to fetch an image or build from source: app does not have a
#   Dockerfile or buildpacks configured.
#
# Passing an already-built image skips that step entirely. The app image is
# the right one to hand it: it is the container Fly's proxy routes to
# (internal_port 3000), and the compose file assigns every container its own
# image regardless, so this cannot disagree with what actually runs.
#
# The alternative — leaving one service buildable so flyctl builds it — does
# not work for `app`, whose event.yaml must arrive as a build ARG, and flyctl
# implements no build args at all.
fly_run deploy --config "$DEPLOY_TOML" --app "$APP" --image "$APP_IMAGE" --primary-region "$REGION"

echo "== done"
cat <<EOF

  Deployed. Finish these by hand:

  1. OAuth callback must match the deployed host exactly:
       $EVENT_URL/api/auth/callback/github
     Update it at https://github.com/settings/developers if it still points
     somewhere else. Sign-in fails with a redirect_uri mismatch otherwise.

  2. Confirm every container came up, and that srh reached redis:
       fly logs --app $APP
       fly ssh console --app $APP -C "redis-cli PING"

  3. Open $EVENT_URL, sign in, and check /admin loads for a login listed in
     $CONFIG's admins. A 403 there almost always means the app was built
     without EVENT_CONFIG_B64 — redeploy through this script.

  Custom domain instead of *.fly.dev:
       fly certs add <domain> --app $APP
     then set EVENT_URL to it, update the OAuth callback, and redeploy
     (BETTER_AUTH_URL is a secret, and the cookie's Secure flag follows it).
EOF
