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
SRH_TOKEN=fixture-srh-token
SRH_CONNECTION_STRING=redis://fixture-pass@fly-fixture.upstash.io
SCORE_IMAGE=ghcr.io/fixture-org/score:latest
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

# --- secrets stay out of the dry-run OUTPUT too --------------------------
#
# Keeping secrets out of committed files (above) is only half of it. The
# dry run printed every value in full until someone ran it and watched a
# GitHub App private key scroll past — into a terminal, a scrollback buffer,
# and whatever screen share or CI log was capturing it. A dry run is the
# command people run FIRST, casually, because they believe it is inert.

@test "--dry-run redacts secret values" {
  cat > "$BATS_TEST_TMPDIR/secret-env" <<'ENV'
EVENT_URL=https://ctf-in-a-box-app.fly.dev
BETTER_AUTH_SECRET=CANARY-auth-secret
GITHUB_CLIENT_ID=public-client-id
GITHUB_CLIENT_SECRET=CANARY-client-secret
SCORER_TOKEN=CANARY-scorer-token
SRH_TOKEN=CANARY-srh-token
SRH_CONNECTION_STRING=redis://CANARY-redis-password@fly-x.upstash.io
SCORE_IMAGE=ghcr.io/fixture-org/score:latest
GITHUB_APP_ID=123
GITHUB_APP_PRIVATE_KEY=CANARY-private-key
GITHUB_APP_INSTALLATION_ID=456
ENV
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/secret-env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [ -z "$(printf '%s' "$output" | grep -F 'CANARY-')" ]
}

@test "--dry-run still shows which variables are set, and non-secret values" {
  # Redaction that hid the variable NAMES would make the preview useless —
  # knowing which secrets land on which app is the reason to run it.
  cat > "$BATS_TEST_TMPDIR/secret-env" <<'ENV'
EVENT_URL=https://ctf-in-a-box-app.fly.dev
BETTER_AUTH_SECRET=CANARY-auth-secret
GITHUB_CLIENT_ID=public-client-id
GITHUB_CLIENT_SECRET=CANARY-client-secret
SCORER_TOKEN=CANARY-scorer-token
SRH_TOKEN=CANARY-srh-token
SRH_CONNECTION_STRING=redis://CANARY-redis-password@fly-x.upstash.io
SCORE_IMAGE=ghcr.io/fixture-org/score:latest
GITHUB_APP_ID=123
GITHUB_APP_PRIVATE_KEY=CANARY-private-key
GITHUB_APP_INSTALLATION_ID=456
ENV
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/secret-env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [[ "$output" == *"BETTER_AUTH_SECRET=<redacted>"* && "$output" == *"GITHUB_APP_ID=123"* ]]
}

# --- srh is REQUIRED on Fly, and that is the correction this module needed ---
#
# The first version of this module did not deploy srh at all, reasoning that it
# only fakes the Upstash REST API in front of local Redis. That was wrong:
# `fly redis create` provisions Upstash-MANAGED Redis, which speaks only the
# Redis protocol and exposes no REST endpoint (the REST API is an Upstash
# *cloud* feature). The app, scorer and sync speak REST and nothing else, so
# without srh the stack could not connect to its datastore at all.
#
# These tests pin the corrected shape so it cannot quietly regress to the
# broken one.

@test "srh is deployed, and every service is pointed at it" {
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [[ "$output" == *"srh.fly.toml"* && "$output" == *"UPSTASH_REDIS_REST_URL=http://ctf-in-a-box-srh.internal:80"* ]]
}

@test "srh publishes no public service" {
  # It fronts the entire datastore. A public port here would expose it behind
  # nothing but the bearer token.
  [ -z "$(uncommented "$FLY/srh.fly.toml" | grep -F '[http_service]')" ]
}

@test "srh is pinned by digest, like the compose service it mirrors" {
  grep -qE 'image = "hiett/serverless-redis-http:latest@sha256:[0-9a-f]{64}"' "$FLY/srh.fly.toml"
}

@test "srh's digest matches docker-compose.yml exactly" {
  # Two copies of a third-party pin drift silently; the local stack is what
  # organizers test against, so the deployed one must be the same bits.
  compose_digest="$(grep -oE 'hiett/serverless-redis-http:latest@sha256:[0-9a-f]{64}' "$REPO/docker-compose.yml" | head -1)"
  fly_digest="$(grep -oE 'hiett/serverless-redis-http:latest@sha256:[0-9a-f]{64}' "$FLY/srh.fly.toml" | head -1)"
  [ "$compose_digest" = "$fly_digest" ]
}

@test "the scorer deploys the SAME image the forks pull, not a rebuild" {
  # docker-compose.yml uses `image: ${SCORE_IMAGE}` for the scorer and
  # `build:` only for app and sync. Building a second scorer here would put a
  # different artifact in front of the leaderboard than the one judging PRs.
  [ -z "$(uncommented "$FLY/scorer.fly.toml" | grep -F 'dockerfile')" ]
}

@test "the scorer deploy passes --image from the env file" {
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [[ "$output" == *"--image ghcr.io/fixture-org/score:latest"* ]]
}

@test "a redis:// connection string is redacted — it embeds the password" {
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [ -z "$(printf '%s' "$output" | grep -F 'fixture-pass')" ]
}

@test "deploying without srh credentials fails with the reason, not a stack trace" {
  grep -vE '^(SRH_TOKEN|SRH_CONNECTION_STRING)=' "$BATS_TEST_TMPDIR/env" > "$BATS_TEST_TMPDIR/no-srh"
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/no-srh" --config "$BATS_TEST_TMPDIR/event.yaml"
  [ "$status" -ne 0 ]
}

# --- init ------------------------------------------------------------------

@test "init --dry-run creates no file and no database" {
  printf 'BETTER_AUTH_SECRET=x\nEVENT_URL=http://localhost\n' > "$BATS_TEST_TMPDIR/src"
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" init --dry-run \
    --from "$BATS_TEST_TMPDIR/src" --env-file "$BATS_TEST_TMPDIR/generated"
  [ ! -f "$BATS_TEST_TMPDIR/generated" ]
}

@test "init rewrites EVENT_URL to the app's Fly hostname" {
  # The source env is a compose one, so it carries http://localhost — which
  # the deploy step correctly refuses. Carrying it over would make init
  # produce a file that cannot deploy.
  printf 'BETTER_AUTH_SECRET=x\nEVENT_URL=http://localhost\n' > "$BATS_TEST_TMPDIR/src"
  printf 'no\n' | env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" init \
    --from "$BATS_TEST_TMPDIR/src" --env-file "$BATS_TEST_TMPDIR/generated" || true
  grep -qx "EVENT_URL=https://ctf-in-a-box-app.fly.dev" "$BATS_TEST_TMPDIR/generated"
}

@test "init generates an SRH_TOKEN rather than reusing the local stack's" {
  printf 'BETTER_AUTH_SECRET=x\nSRH_TOKEN=local-stack-token\n' > "$BATS_TEST_TMPDIR/src"
  printf 'no\n' | env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" init \
    --from "$BATS_TEST_TMPDIR/src" --env-file "$BATS_TEST_TMPDIR/generated" || true
  # The local value is copied through, then a fresh one is appended and wins
  # on read (env_value takes the last match). What must NOT happen is the file
  # having no token at all.
  [ -n "$(grep -c '^SRH_TOKEN=' "$BATS_TEST_TMPDIR/generated")" ]
}

@test "init does NOT create the billable database without a typed confirmation" {
  printf 'BETTER_AUTH_SECRET=x\n' > "$BATS_TEST_TMPDIR/src"
  run bash -c "printf 'yes\n' | env PATH=/usr/bin:/bin bash '$FLY/deploy.sh' init --from '$BATS_TEST_TMPDIR/src' --env-file '$BATS_TEST_TMPDIR/generated'"
  # "yes" is not the required word; only "create" proceeds.
  [[ "$output" == *"aborted"* ]]
}

@test "init writes the env file with owner-only permissions" {
  printf 'BETTER_AUTH_SECRET=x\n' > "$BATS_TEST_TMPDIR/src"
  printf 'no\n' | env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" init \
    --from "$BATS_TEST_TMPDIR/src" --env-file "$BATS_TEST_TMPDIR/generated" || true
  # It holds every secret the event has; 644 would be a leak on a shared box.
  #
  # GNU `stat -c` FIRST, BSD `stat -f` as the fallback, and the order is the
  # whole point: `-c` is an invalid option on BSD and exits nonzero, so the
  # fallback fires cleanly on macOS. The reverse order silently breaks on
  # Linux — there `-f` is valid but means "filesystem status", so it SUCCEEDS
  # with unrelated output and the fallback never runs. That is how this test
  # passed locally and failed in CI.
  mode="$(stat -c '%a' "$BATS_TEST_TMPDIR/generated" 2>/dev/null || stat -f '%Lp' "$BATS_TEST_TMPDIR/generated")"
  [ "$mode" = "600" ]
}

@test "init tightens permissions on a PRE-EXISTING env file too" {
  # A hand-made env file is usually 644 from a plain shell redirect, and it
  # holds every secret the event has. Chmod'ing only on creation left exactly
  # the files most likely to be wrong.
  printf 'BETTER_AUTH_SECRET=x\n' > "$BATS_TEST_TMPDIR/pre-existing"
  chmod 644 "$BATS_TEST_TMPDIR/pre-existing"
  printf 'no\n' | env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" init \
    --env-file "$BATS_TEST_TMPDIR/pre-existing" || true
  mode="$(stat -c '%a' "$BATS_TEST_TMPDIR/pre-existing" 2>/dev/null || stat -f '%Lp' "$BATS_TEST_TMPDIR/pre-existing")"
  [ "$mode" = "600" ]
}

@test "init tops up a pre-existing env file instead of overwriting it" {
  printf 'BETTER_AUTH_SECRET=keep-me\n' > "$BATS_TEST_TMPDIR/pre-existing"
  printf 'no\n' | env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" init \
    --env-file "$BATS_TEST_TMPDIR/pre-existing" || true
  # The original value survives AND the missing one was added.
  grep -q "^BETTER_AUTH_SECRET=keep-me$" "$BATS_TEST_TMPDIR/pre-existing"
}

@test "an unfilled EVENT_URL placeholder is refused before anything deploys" {
  # "https://<your-app>.fly.dev" passes a bare https:// check, so without this
  # it deploys and the failure surfaces much later as a redirect_uri mismatch
  # at sign-in, against a host nobody can resolve.
  sed 's#^EVENT_URL=.*#EVENT_URL=https://<your-app>.fly.dev#' \
    "$BATS_TEST_TMPDIR/env" > "$BATS_TEST_TMPDIR/placeholder-env"
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/placeholder-env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [ "$status" -ne 0 ]
}

@test "the placeholder refusal names the value to use" {
  sed 's#^EVENT_URL=.*#EVENT_URL=https://<your-app>.fly.dev#' \
    "$BATS_TEST_TMPDIR/env" > "$BATS_TEST_TMPDIR/placeholder-env"
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/placeholder-env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [[ "$output" == *"EVENT_URL=https://ctf-in-a-box-app.fly.dev"* ]]
}

@test "the srh-credentials refusal names only the variable that is actually missing" {
  # Listing both when one is present sends the reader to re-check the one they
  # already set — the exact wrong turn, on the message whose only job is to
  # shorten the search.
  grep -v '^SRH_CONNECTION_STRING=' "$BATS_TEST_TMPDIR/env" > "$BATS_TEST_TMPDIR/half-srh"
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/half-srh" --config "$BATS_TEST_TMPDIR/event.yaml"
  [[ "$output" == *"SRH_CONNECTION_STRING missing"* && "$output" != *"SRH_TOKEN and"* ]]
}

@test "a missing connection string points at the fly CLI it needs" {
  # Running init is the fix, and init's redis step cannot work without flyctl.
  # Saying so here saves a second failed run.
  grep -v '^SRH_CONNECTION_STRING=' "$BATS_TEST_TMPDIR/env" > "$BATS_TEST_TMPDIR/half-srh"
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/half-srh" --config "$BATS_TEST_TMPDIR/event.yaml"
  [[ "$output" == *"flyctl"* ]]
}

@test "both missing still names both" {
  grep -vE '^(SRH_TOKEN|SRH_CONNECTION_STRING)=' "$BATS_TEST_TMPDIR/env" > "$BATS_TEST_TMPDIR/no-srh2"
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/no-srh2" --config "$BATS_TEST_TMPDIR/event.yaml"
  [[ "$output" == *"SRH_TOKEN and SRH_CONNECTION_STRING missing"* ]]
}
