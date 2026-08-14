# scorer/entrypoints/vulnerableapp.sh
# VulnerableApp bring-up. Sourced by entrypoint.sh.
#
# A single Spring Boot container serving on 9090 with no external dependencies.
# The generic boot would work, except the rubric's tests read VULNERABLEAPP_URL
# in addition to APP_URL, and the app needs its startup grace period before the
# first challenge child spawns — 110 children at concurrency 8 would otherwise
# all race an unready app and trip the unreachable early-abort.
: "${APP_IMAGE:?vulnerableapp: APP_IMAGE is required}"

docker pull "$APP_IMAGE" >/dev/null
docker run -d --rm \
  --network "$NETWORK" \
  --network-alias "$APP_HOST" \
  --name "$APP_CONTAINER" \
  "$APP_IMAGE" >/dev/null
BOOTED="$APP_CONTAINER"
