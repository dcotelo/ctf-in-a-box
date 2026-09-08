#!/usr/bin/env bash
#
# Build the app image with event.yaml baked in, push it to this module's ECR
# repository, and hand Terraform the tag to run.
#
# Terraform cannot build an image, and the app's `event.yaml` is baked at BUILD
# time via `EVENT_CONFIG_B64` — an unset arg silently yields an empty `admins`
# list (so /admin 403s for everyone) and neutral branding. On the old EC2 box
# that bake happened on the instance at bring-up; on Fargate the image is
# prebuilt, so the bake moves into the deploy. That is what this script owns.
#
# The tag is CONTENT-ADDRESSED: `<revision>-<config-hash>`. ECR here is
# `IMMUTABLE` (registry.tf says why), so re-pushing a tag is an error rather
# than an overwrite — and with a content-addressed tag that error only ever
# means "nothing changed", which this script reports and skips instead of
# failing. Same code plus same config produces the same tag, every time.
#
# The tag reaches Terraform through `image.auto.tfvars`, which Terraform loads
# on its own and .gitignore excludes. `terraform.tfvars` stays yours: this
# script never edits it, so a deploy cannot quietly rewrite your event config.
#
# --dry-run prints every docker/aws/terraform command and runs NONE of them,
# with secret values redacted — deploy/fly/deploy.sh printed them in full once,
# into whatever log or screen share happened to be capturing it.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

DRY_RUN=""
SKIP_BUILD=""
APPLY=""
CONFIG="$ROOT/event.yaml"

usage() {
  cat <<'EOT'
usage: deploy/aws-terraform/deploy.sh [--dry-run] [--skip-build] [--apply]
                                      [--config path/to/event.yaml]

Builds the app image with event.yaml baked in, pushes it to the ECR repository
this module created, and writes the resulting tag to image.auto.tfvars.

--apply      also runs `terraform apply` once the image is pushed. Without it
             the script stops after writing image.auto.tfvars and prints the
             command to run.
--skip-build reuses the image already in ECR for this revision and config.
             Refused when that tag is not there yet — there would be nothing
             to deploy.
--dry-run    prints every command and makes none of them. Secrets redacted.
--config     path to event.yaml. Defaults to the repo root's.

Requires an applied stack: the ECR URL and region come from `terraform output`,
so the script never duplicates configuration that already lives in state.
EOT
}

while [ $# -gt 0 ]; do
  case "$1" in
  --dry-run)
    DRY_RUN=1
    shift
    ;;
  --skip-build)
    SKIP_BUILD=1
    shift
    ;;
  --apply)
    APPLY=1
    shift
    ;;
  --config)
    CONFIG="${2:-}"
    shift 2
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    echo "unknown argument: $1" >&2
    usage >&2
    exit 2
    ;;
  esac
done

# Every external call goes through `run`, so --dry-run cannot leak a real one.
# Anything that looks like a secret is redacted in the printed form: a dry run
# exists to be pasted into a terminal or a review, and the build arg below
# carries the entire event config.
redacted() {
  local out=""
  local arg=""
  for arg in "$@"; do
    case "$arg" in
    EVENT_CONFIG_B64=* | *SECRET* | *TOKEN* | *PASSWORD*)
      out="$out ${arg%%=*}=<redacted>"
      ;;
    *) out="$out $arg" ;;
    esac
  done
  echo "${out# }"
}

run() {
  if [ -n "$DRY_RUN" ]; then
    echo "   DRY-RUN: $(redacted "$@")"
    return 0
  fi
  "$@"
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "FAIL: $1 is not installed, and this script needs it to $2." >&2
    exit 1
  fi
}

need docker "build and push the app image"
need aws "log in to ECR and read the stack's outputs"
need terraform "read the stack's outputs"

# --- the config bake ---------------------------------------------------------
#
# Refused rather than defaulted. A missing event.yaml produces an image with no
# admins and generic branding, and the failure surfaces hours later as "/admin
# 403s for everyone" — the most expensive mistake this kit has.
if [ ! -f "$CONFIG" ]; then
  echo "FAIL: no event.yaml at $CONFIG" >&2
  echo "      The app image bakes it at build time; without it the image ships" >&2
  echo "      an empty admins list and neutral branding. Pass --config, or copy" >&2
  echo "      event.yaml.example to event.yaml and fill it in." >&2
  exit 1
fi

EVENT_CONFIG_B64="$(base64 < "$CONFIG" | tr -d '\n')"

# Content address: the revision that built it, plus a hash of the config baked
# into it. The config half matters — two images from one commit differ when the
# event changes, and a tag that ignored that would name the wrong one.
if REV="$(git -C "$ROOT" rev-parse --short=12 HEAD 2>/dev/null)"; then
  if [ -n "$(git -C "$ROOT" status --porcelain -- apps/web 2>/dev/null)" ]; then
    # Scoped to apps/web, for the reason deploy/fly/deploy.sh gives: the image
    # is built from `apps/web`, so dirt anywhere else does not describe it. A
    # dirty app tree gets its own tag so it is never mistaken for the commit.
    REV="${REV}-dirty"
  fi
else
  REV="nogit"
fi

if command -v shasum > /dev/null 2>&1; then
  CONFIG_HASH="$(shasum -a 256 "$CONFIG" | cut -c1-8)"
else
  CONFIG_HASH="$(sha256sum "$CONFIG" | cut -c1-8)"
fi

TAG="${REV}-${CONFIG_HASH}"

# --- where it goes -----------------------------------------------------------
#
# From state, not from a second copy of the same settings. A wrapper that asked
# for region and repository again would be one more thing to keep in step.
# --dry-run reads nothing either: the point of a preview is to work BEFORE the
# stack exists, and "makes none of them" is a property worth being able to test
# rather than approximately true. So the placeholder is obviously a placeholder
# — a preview that printed a plausible-looking account id would be worse than
# one that cannot be mistaken for the real thing.
if [ -n "$DRY_RUN" ]; then
  REPO_URL="<account>.dkr.ecr.<region>.amazonaws.com/${TF_NAME:-owasp-ctf}-app"
  echo "   (dry run: the real registry comes from terraform output)"
elif ! REPO_URL="$(terraform -chdir="$HERE" output -raw ecr_app_repository_url 2>/dev/null)" ||
  [ -z "$REPO_URL" ]; then
  # Emptiness is checked separately from the exit status. `terraform output`
  # can succeed and hand back nothing, and an empty repository URL would build
  # a tag like ":abc123" and push it nowhere in particular — the failure would
  # surface as a confusing docker error rather than as the missing stack it is.
  echo "FAIL: could not read a non-empty 'ecr_app_repository_url' from" >&2
  echo "      terraform output. This script deploys INTO an applied stack:" >&2
  echo "      run terraform apply in deploy/aws-terraform first, then re-run." >&2
  exit 1
fi

REGION="${REPO_URL#*.dkr.ecr.}"
REGION="${REGION%%.amazonaws.com/*}"
REGISTRY="${REPO_URL%%/*}"
REPO_NAME="${REPO_URL##*/}"
IMAGE="${REPO_URL}:${TAG}"

echo "=> app image  $IMAGE"
echo "   config     $CONFIG ($CONFIG_HASH)"
echo "   revision   $REV"

# --- is it already there? ----------------------------------------------------
#
# `--query`/`--output text` rather than jq: AGENTS.md keeps jq off the
# provisioning path, and this is the aws CLI's own filtering, the same way
# `gh api --jq` is the gh CLI's.
ALREADY=""
if [ -z "$DRY_RUN" ]; then
  if aws ecr describe-images --region "$REGION" \
    --repository-name "$REPO_NAME" \
    --image-ids "imageTag=$TAG" \
    --query 'imageDetails[0].imageDigest' --output text > /dev/null 2>&1; then
    ALREADY=1
  fi
fi

if [ -n "$SKIP_BUILD" ] && [ -z "$ALREADY" ] && [ -z "$DRY_RUN" ]; then
  echo "FAIL: --skip-build, but $TAG is not in ECR yet — nothing to deploy." >&2
  echo "      That tag is derived from this revision and this event.yaml, so" >&2
  echo "      the image for them has never been built. Drop --skip-build." >&2
  exit 1
fi

if [ -n "$ALREADY" ]; then
  echo "   ECR already has $TAG — same revision, same config. Skipping build."
elif [ -n "$SKIP_BUILD" ]; then
  echo "   --skip-build: assuming $TAG is present"
else
  echo "=> building"
  run docker build \
    --file "$ROOT/apps/web/Dockerfile" \
    --build-arg "EVENT_CONFIG_B64=$EVENT_CONFIG_B64" \
    --build-arg "APP_BUILD_REV=$REV" \
    --build-arg "APP_BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --tag "$IMAGE" \
    "$ROOT/apps/web"

  echo "=> pushing"
  # Piped into docker login, never passed as an argument: a --password on a
  # command line is readable by every other process on the host.
  if [ -n "$DRY_RUN" ]; then
    echo "   DRY-RUN: aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REGISTRY"
  else
    aws ecr get-login-password --region "$REGION" |
      docker login --username AWS --password-stdin "$REGISTRY"
  fi
  run docker push "$IMAGE"
fi

# --- hand it to Terraform ----------------------------------------------------
#
# A generated auto-loaded file, not an edit to terraform.tfvars. Terraform picks
# up *.auto.tfvars on its own, .gitignore excludes it, and your own tfvars is
# never rewritten by a deploy.
VARS_FILE="$HERE/image.auto.tfvars"
if [ -n "$DRY_RUN" ]; then
  echo "   DRY-RUN: write image.auto.tfvars with app_image = \"$IMAGE\""
else
  cat > "$VARS_FILE" <<EOT
# Written by deploy/aws-terraform/deploy.sh — do not edit by hand.
# Terraform loads *.auto.tfvars automatically; .gitignore excludes this file.
app_image = "$IMAGE"
EOT
  echo "=> wrote image.auto.tfvars"
fi

if [ -n "$APPLY" ]; then
  echo "=> applying"
  run terraform -chdir="$HERE" apply -input=false
else
  echo
  echo "Image is in ECR and image.auto.tfvars names it. To roll it out:"
  echo "   terraform -chdir=deploy/aws-terraform apply"
fi
