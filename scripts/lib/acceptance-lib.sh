# scripts/lib/acceptance-lib.sh
# Shared machinery for the acceptance gates. Sourced, never executed.
#
# acceptance-target.sh proves the NEGATIVE direction (stock app scores 0/N);
# acceptance-patched.sh proves the POSITIVE direction (a correctly patched fork
# scores exactly the patched challenge). Both stage the same way, build the same
# scorer image, and run the same judge — the only differences are "apply a
# reference patch before the build" and "assert a different result". These
# functions are that common core, factored out so the positive gate reuses the
# negative gate's proven staging/build/judge path instead of reimplementing it.
#
# Portability: these run under bash on BSD (macOS) and GNU (Linux CI) userlands.
# No GNU-only sed/grep escapes.

# acc_url_for <target> — sets APP_SCHEME and APP_URL_SUFFIX for the target.
# This is the same per-target URL table acceptance-target.sh carries (see its
# header for why the suffix, not just a port, is per-target). Kept in lockstep
# with that table and setup/ctf-setup.sh's app_url_for(); a new target needs an
# entry in all three.
acc_url_for() {
  APP_SCHEME="http"
  case "$1" in
    vampi) APP_URL_SUFFIX=":5000" ;;
    vulnerableapp) APP_URL_SUFFIX=":9090/VulnerableApp" ;;
    juice-shop) APP_URL_SUFFIX=":3000" ;;
    webgoat) APP_URL_SUFFIX=":8080/WebGoat" ;;
    securityshepherd) APP_SCHEME="https"; APP_URL_SUFFIX=":8443" ;;
    *) APP_URL_SUFFIX="" ;;
  esac
}

# acc_build_scorer <image-tag> — build the scorer image with the vendored rubric.
acc_build_scorer() {
  echo "Building scorer image with the vendored rubric…"
  docker build -q -t "$1" scorer/ >/dev/null
}

# acc_stage_source <workspace> <repo> <ref> — stage a pinned upstream tree into
# the workspace exactly the way a contestant's PR checkout looks: a fork tree
# with a root Dockerfile, so the bring-up takes the workspace-Dockerfile branch.
# Pins to a COMMIT (init + fetch + checkout, because `git clone -b` cannot take a
# bare SHA); asserts the Dockerfile precondition loudly rather than letting the
# bring-up fall through to a confusing "need APP_IMAGE or a workspace Dockerfile".
acc_stage_source() {
  ws="$1"; repo="$2"; ref="$3"
  echo "Staging $repo@${ref:0:12} into the workspace (source path)…"
  git init -q "$ws"
  git -C "$ws" remote add origin "https://github.com/$repo.git"
  git -C "$ws" fetch --depth 1 -q origin "$ref"
  git -C "$ws" checkout -q FETCH_HEAD
  [ -f "$ws/Dockerfile" ] || {
    echo "FAIL: $repo@$ref has no root Dockerfile — the bring-up's source branch"
    echo "keys on that file and would never fire."
    return 1
  }
}

# acc_write_event <path> — the stock-check pull_request webhook payload the judge
# reads (author/pr/sha). Identical to acceptance-target.sh's.
acc_write_event() {
  cat > "$1" <<'JSON'
{"pull_request":{"user":{"login":"stock-check"},"number":1,"head":{"sha":"0000000000000000000000000000000000000000"}}}
JSON
}

# acc_run_judge — boot the app under test and score the rubric against it.
# Reads: IMG NET WS TMP TARGET APP_URL and (optional) APP_IMAGE from the env.
# An empty APP_IMAGE means "score from SOURCE" — the bring-up builds the staged
# workspace Dockerfile, the same branch a contestant's PR takes.
acc_run_judge() {
  docker run --rm \
    --network "$NET" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$WS:/github/workspace" \
    -v "$TMP/event.json:/github/event.json:ro" \
    -e "TARGET=$TARGET" \
    -e "APP_URL=$APP_SCHEME://$TARGET$APP_URL_SUFFIX" \
    -e "APP_IMAGE=${APP_IMAGE:-}" \
    -e "NETWORK=$NET" \
    --entrypoint /usr/local/bin/entrypoint.sh \
    "$IMG"
}

# acc_score_counts <report> — echo "SOLVED TOTAL" parsed from the score line
# ("**S / T** challenges patched"). Same extraction acceptance-target.sh uses.
acc_score_counts() {
  sed -n 's/.*\*\*\([0-9][0-9]*\) \/ \([0-9][0-9]*\)\*\* challenges patched.*/\1 \2/p' "$1"
}
