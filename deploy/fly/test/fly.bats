#!/usr/bin/env bats
#
# Static checks on the fly.io module. There is no `terraform validate`
# equivalent for fly.toml, and no account to deploy against in CI, so these
# assert the invariants that a broken port would violate — the same posture as
# `deploy/aws-terraform/userdata.tftest.hcl`, which exists because `validate`
# never inspects rendered output.
#
# Each assertion is the LAST statement in its test on purpose (AGENTS.md): a
# `[[ ... ]]` or a negated pipeline that is not last does not fail the test.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
  FLY="$REPO/deploy/fly"

  # Strip comments before asserting on TOML structure. These files EXPLAIN the
  # blocks they deliberately omit, so a naive grep for "[http_service]" matches
  # the paragraph saying why there isn't one — a test that fails on its own
  # documentation.
  uncommented() { grep -v '^[[:space:]]*#' "$1"; }

  # A complete fixture env so --dry-run reaches the deploy steps. An empty file
  # exits early on the required-value checks, which would make the dry-run
  # tests below pass for the wrong reason.
  cat > "$BATS_TEST_TMPDIR/env" <<'ENV'
EVENT_URL=https://ctf-in-a-box-app.fly.dev
BETTER_AUTH_SECRET=fixture-secret-value-at-least-32-chars
GITHUB_CLIENT_ID=fixture-client-id
GITHUB_CLIENT_SECRET=fixture-client-secret
SCORER_TOKEN=fixture-scorer-token
UPSTASH_REDIS_REST_URL=https://fixture.upstash.io
UPSTASH_REDIS_REST_TOKEN=fixture-upstash-token
GITHUB_APP_ID=1
GITHUB_APP_PRIVATE_KEY=Zml4dHVyZQ==
GITHUB_APP_INSTALLATION_ID=1
ENV
  printf 'github: { org: fixture-org }\n' > "$BATS_TEST_TMPDIR/event.yaml"
}

# --- the poll-mode invariant ----------------------------------------------
#
# The kit's headline security property in poll mode is ZERO inbound scoring
# surface. On compose that is `caddy/Caddyfile.poll` having no /score route.
# Here it is the scorer and sync apps publishing no ports at all. A stray
# `[http_service]` in either file hands the internet a POST /score guarded by
# nothing but a bearer token.

@test "scorer publishes no public service" {
  [ -z "$(uncommented "$FLY/scorer.fly.toml" | grep -F '[http_service]')" ]
}

@test "scorer declares no published ports" {
  [ -z "$(uncommented "$FLY/scorer.fly.toml" | grep -F '[[services.ports]]')" ]
}

@test "sync publishes no public service" {
  [ -z "$(uncommented "$FLY/sync.fly.toml" | grep -E '^\[http_service\]|^\[\[services')" ]
}

@test "the app is the one service that IS public, over https only" {
  grep -q 'force_https = true' "$FLY/app.fly.toml"
}

# --- the two blockers a naive port gets wrong ------------------------------

@test "sync mounts a volume for its poll cursor" {
  # Without this the cursor resets on every machine restart and the poller
  # re-reads every comment in every fork from the beginning.
  grep -q 'destination = "/state"' "$FLY/sync.fly.toml"
}

@test "sync's STATE_PATH points at that mount, not at ephemeral disk" {
  # A volume nobody writes to is decoration. These two must agree.
  grep -q 'STATE_PATH = "/state/' "$FLY/sync.fly.toml"
}

@test "the app deploy passes EVENT_CONFIG_B64 as a build arg" {
  # Omit it and the build SUCCEEDS with an empty admins list — /admin then
  # 403s for everyone, with no error anywhere to explain why.
  grep -q -- '--build-arg "EVENT_CONFIG_B64=' "$FLY/deploy.sh"
}

@test "EVENT_CONFIG_B64 is NOT committed into the app's fly.toml" {
  # It would embed the organizer's admins list in the repo, and go stale
  # silently — a stale value still builds.
  [ -z "$(uncommented "$FLY/app.fly.toml" | grep -E '^ *EVENT_CONFIG_B64 *=')" ]
}

# --- the reason this runs on Firecracker at all ----------------------------

@test "the scorer runs in serve mode, never judge" {
  # Judge mode boots target containers as siblings through docker.sock. That
  # happens on GitHub's runners. A judge-mode scorer here would need
  # privileged Docker, which Fly does not give it — it would fail at runtime,
  # not at deploy.
  grep -q 'CTF_MODE = "serve"' "$FLY/scorer.fly.toml"
}

# --- secrets stay out of committed files -----------------------------------

@test "no fly.toml carries a secret value" {
  # Secrets go through `fly secrets set`. A committed one is a leak that
  # survives in git history.
  [ -z "$(cat "$FLY"/*.fly.toml | grep -v '^[[:space:]]*#' | grep -E '^ *(BETTER_AUTH_SECRET|GITHUB_CLIENT_SECRET|SCORER_TOKEN|UPSTASH_REDIS_REST_TOKEN|GITHUB_APP_PRIVATE_KEY) *=')" ]
}

# --- dry-run makes no calls ------------------------------------------------

@test "--dry-run makes zero fly calls" {
  # Same contract ctf-setup.sh --dry-run holds. A PATH with no `fly` in it
  # proves it by construction: if the script shelled out, it would fail.
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [ "$status" -eq 0 ]
}

@test "--dry-run prints the fly commands it would have run" {
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [[ "$output" == *"DRY-RUN: fly deploy"* ]]
}

# --- EVENT_URL guard -------------------------------------------------------

@test "a non-https EVENT_URL is refused before anything is deployed" {
  # The app refuses to serve a production event over plain HTTP (ADR 39), so
  # deploying with a leftover http://localhost would ship an app that 500s on
  # every request. Catch it where the message can name the fix.
  printf 'EVENT_URL=http://localhost\n' > "$BATS_TEST_TMPDIR/bad-env"
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/bad-env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [ "$status" -ne 0 ]
}

@test "the EVENT_URL refusal names the value to use" {
  printf 'EVENT_URL=http://localhost\n' > "$BATS_TEST_TMPDIR/bad-env"
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/bad-env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [[ "$output" == *".fly.dev"* ]]
}

# --- drift guard between the two sync Dockerfiles --------------------------

@test "sync.Dockerfile stays equivalent to sync/Dockerfile" {
  # deploy/fly/sync.Dockerfile duplicates sync/Dockerfile with `sync/`-prefixed
  # COPY sources, because a repo-root build context cannot use the bare paths —
  # and it adds the event.yaml bake that Fly needs (no bind mounts).
  #
  # Derive one from the other so the copy cannot silently rot: strip the
  # `sync/` prefixes and the event.yaml line, and what remains must be
  # sync/Dockerfile exactly.
  derived="$(grep -v '^#' "$FLY/sync.Dockerfile" \
    | grep -v 'COPY event.yaml' \
    | sed 's#sync/##g' \
    | sed '/^$/d')"
  original="$(grep -v '^#' "$REPO/sync/Dockerfile" | sed '/^$/d')"
  [ "$derived" = "$original" ]
}

@test "sync.Dockerfile bakes event.yaml in (Fly has no bind mounts)" {
  grep -q 'COPY event.yaml /config/event.yaml' "$FLY/sync.Dockerfile"
}
