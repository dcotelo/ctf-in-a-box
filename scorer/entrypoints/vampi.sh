# scorer/entrypoints/vampi.sh
# VAmPI bring-up. Sourced by entrypoint.sh with NETWORK / APP_HOST / APP_URL /
# APP_CONTAINER / APP_IMAGE already set.
#
# VAmPI is a single Flask container with a self-contained SQLite database; the
# rubric's own createDb() helper seeds it over HTTP, so there is no database
# sibling to start. The only thing this adds over the generic path is the
# vulnerable-mode env var — VAmPI ships a hardened mode, and scoring a hardened
# instance would pass every probe against an unpatched fork.
: "${APP_IMAGE:?vampi: APP_IMAGE is required (no PR-source build path for this target)}"

docker pull "$APP_IMAGE" >/dev/null
docker run -d --rm \
  --network "$NETWORK" \
  --network-alias "$APP_HOST" \
  --name "$APP_CONTAINER" \
  -e vulnerable=1 \
  "$APP_IMAGE" >/dev/null
BOOTED="$APP_CONTAINER"
