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
REDIS_PASSWORD=fixture-redis-password
SCORE_IMAGE=ghcr.io/fixture-org/score:latest
FLY_REGION=gru
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
REDIS_PASSWORD=CANARY-redis-password
SCORE_IMAGE=ghcr.io/fixture-org/score:latest
FLY_REGION=gru
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
REDIS_PASSWORD=CANARY-redis-password
SCORE_IMAGE=ghcr.io/fixture-org/score:latest
FLY_REGION=gru
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

@test "the scorer deploys the mirrored image, not the private GHCR ref" {
  # Fly CANNOT pull from a private third-party registry — a real run failed
  # with `Authentication required to access image "ghcr.io/.../score:latest"`
  # and there is no credential flag. So the deploy must reference
  # registry.fly.io, and the GHCR ref must appear only as the mirror SOURCE.
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [[ "$output" == *"--image registry.fly.io/ctf-in-a-box-scorer:latest"* ]]
}

@test "the scorer image is MIRRORED from SCORE_IMAGE, never rebuilt" {
  # Mirroring keeps the leaderboard scorer byte-identical to the one the forks
  # pull to judge. A rebuild would be the same source today and nothing keeps
  # two builds in step.
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [[ "$output" == *"imagetools create --tag registry.fly.io/ctf-in-a-box-scorer:latest ghcr.io/fixture-org/score:latest"* ]]
}

@test "the mirror authenticates docker for fly's registry first" {
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [[ "$output" == *"fly auth docker"* ]]
}

@test "the pull fallback pins linux/amd64" {
  # The forks' runners are amd64. An arm64 pull on an Apple Silicon machine
  # would mirror an image the deployed scorer cannot execute.
  grep -q 'docker pull --platform linux/amd64' "$FLY/deploy.sh"
}

@test "the derived redis:// connection string is redacted — it embeds the password" {
  # Built at deploy time from REDIS_PASSWORD, so the password would otherwise
  # appear twice in the preview: once as REDIS_PASSWORD, once inside the URL.
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [ -z "$(printf '%s' "$output" | grep -F 'fixture-redis-password')" ]
}

@test "deploying without srh credentials fails with the reason, not a stack trace" {
  grep -vE '^(SRH_TOKEN|REDIS_PASSWORD)=' "$BATS_TEST_TMPDIR/env" > "$BATS_TEST_TMPDIR/no-srh"
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
  grep -v '^REDIS_PASSWORD=' "$BATS_TEST_TMPDIR/env" > "$BATS_TEST_TMPDIR/half-srh"
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/half-srh" --config "$BATS_TEST_TMPDIR/event.yaml"
  [[ "$output" == *"REDIS_PASSWORD missing"* && "$output" != *"SRH_TOKEN and"* ]]
}

@test "init needs no fly CLI at all" {
  # The whole Redis-provisioning step is gone: the datastore is our own
  # container, authenticated with the REDIS_PASSWORD the kit already
  # generates. init is now pure env-file preparation, so it must work with
  # `fly` nowhere on PATH.
  printf 'BETTER_AUTH_SECRET=x\n' > "$BATS_TEST_TMPDIR/src"
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" init \
    --from "$BATS_TEST_TMPDIR/src" --env-file "$BATS_TEST_TMPDIR/generated"
  [ "$status" -eq 0 ]
}

@test "both missing still names both" {
  grep -vE '^(SRH_TOKEN|REDIS_PASSWORD)=' "$BATS_TEST_TMPDIR/env" > "$BATS_TEST_TMPDIR/no-srh2"
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/no-srh2" --config "$BATS_TEST_TMPDIR/event.yaml"
  [[ "$output" == *"SRH_TOKEN and REDIS_PASSWORD missing"* ]]
}

# --- the datastore is OUR container, not a managed add-on -------------------

@test "redis is deployed as the same image the compose stack runs" {
  grep -q 'image = "redis:7-alpine"' "$FLY/redis.fly.toml"
}

@test "redis requires a password, exactly as compose does" {
  # An unauthenticated Redis reachable by every app in the organization is the
  # exposure ADR 41 exists to close.
  grep -q -- '--requirepass' "$FLY/redis.fly.toml"
}

@test "redis persists to a volume" {
  # Without it, a machine restart loses every score, team and hint purchase.
  grep -q 'destination = "/data"' "$FLY/redis.fly.toml"
}

@test "redis publishes no public service" {
  [ -z "$(uncommented "$FLY/redis.fly.toml" | grep -F '[http_service]')" ]
}

@test "srh reaches redis over the private network, not a managed endpoint" {
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [[ "$output" == *"redis.fly.toml"* ]]
}

@test "redis deploys BEFORE the services that read it" {
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/env" --config "$BATS_TEST_TMPDIR/event.yaml"
  redis_at="$(printf '%s' "$output" | grep -n '== 1/5 redis' | cut -d: -f1)"
  app_at="$(printf '%s' "$output" | grep -n '== 5/5 app' | cut -d: -f1)"
  [ "$redis_at" -lt "$app_at" ]
}

# --- EVENT_URL host vs the app it is served from ---------------------------
#
# The failure this catches is late and opaque: rename the apps in the toml
# files and forget the env file (or the reverse) and the deploy SUCCEEDS,
# while BETTER_AUTH_URL claims a hostname nothing answers on. The symptom is
# a redirect_uri mismatch at sign-in, with nothing pointing back at the cause.

hostname_run() { # $1 = EVENT_URL
  sed "s#^EVENT_URL=.*#EVENT_URL=$1#" "$BATS_TEST_TMPDIR/env" > "$BATS_TEST_TMPDIR/hn"
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/hn" --config "$BATS_TEST_TMPDIR/event.yaml"
}

@test "a fly.dev host naming a different app warns" {
  hostname_run "https://some-other-name.fly.dev"
  [[ "$output" == *"but the app deploys as 'ctf-in-a-box-app'"* ]]
}

@test "the mismatch warning does NOT block the deploy" {
  # Warn, never fail: renaming the apps to match is a legitimate answer, and
  # failing would make this a gate on a choice that is the organizer's.
  hostname_run "https://some-other-name.fly.dev"
  [ "$status" -eq 0 ]
}

@test "the matching fly.dev host says nothing" {
  # A check that fires on the correct configuration is noise, and noise is
  # what gets ignored when it finally matters.
  hostname_run "https://ctf-in-a-box-app.fly.dev"
  [[ "$output" != *"WARNING"* ]]
}

@test "a custom domain is not treated as a mismatch" {
  # `fly certs add` + EVENT_URL pointing at your own domain is a first-class
  # setup. Warning about it would train organizers to ignore the warning.
  hostname_run "https://ctf.example.org"
  [[ "$output" != *"WARNING"* ]]
}

@test "a custom domain names the certificate command it needs" {
  hostname_run "https://ctf.example.org"
  [[ "$output" == *"fly certs add ctf.example.org --app ctf-in-a-box-app"* ]]
}

# --- the env file must never be committable -------------------------------
#
# `.env.fly` — which init writes, and which holds the OAuth client secret, the
# GitHub App private key and the session signing key — was committed to this
# PUBLIC repo, because .gitignore listed env files individually and a new tool
# invented a new name. Every secret in it had to be rotated.

@test "the env file init writes is git-ignored" {
  # `git` is not present in every runner this suite is executed in (the
  # bats/bats image has none). Skip rather than fail — and rather than pass:
  # the tracked-file check below returned EMPTY without git, so it passed
  # vacuously and would have kept passing with a real secret file committed.
  command -v git >/dev/null || skip "git not available"
  cd "$REPO"
  run git check-ignore -q .env.fly
  [ "$status" -eq 0 ]
}

@test "a future env filename is ignored too, without editing .gitignore" {
  # The specific fix is a glob rather than another entry: the failure mode was
  # a NEW name nobody had listed, so enumerating one more name repeats it.
  command -v git >/dev/null || skip "git not available"
  cd "$REPO"
  run git check-ignore -q .env.some-tool-not-invented-yet
  [ "$status" -eq 0 ]
}

@test ".env.example is still tracked" {
  # The glob must not swallow the committed template organizers copy from.
  command -v git >/dev/null || skip "git not available"
  cd "$REPO"
  [ -n "$(git ls-files .env.example)" ]
}

@test "no env file with real secrets is tracked" {
  command -v git >/dev/null || skip "git not available"
  cd "$REPO"
  [ -z "$(git ls-files | grep -E '^\.env' | grep -v '^\.env\.example$')" ]
# --- what a real `fly deploy` rejected -------------------------------------
#
# The first live run failed validation on every private service:
#
#   Service has no processes set but app has 1 processes defined
#   WARNING: Service must expose at least one port. Add a [[services.ports]]
#   ✘ invalid app configuration
#
# The mistake was believing a `[[services]]` block WITHOUT ports meant
# "internal only". It does not: `[[services]]` IS the public-edge mechanism
# and Fly refuses it portless. Private access over `<app>.internal` needs
# nothing declared at all — so a service block here would be what EXPOSED
# these, not what hid them.

@test "no private app declares a [[services]] block" {
  for f in redis srh scorer sync; do
    [ -z "$(uncommented "$FLY/$f.fly.toml" | grep '^\[\[services\]\]')" ] || return 1
  done
}

@test "the app — the one public service — uses http_service, not a bare service" {
  # http_service is the modern public form and carries its own port.
  grep -q '^\[http_service\]' "$FLY/app.fly.toml"
}

@test "redis binds IPv6, because Fly's private network is IPv6-only" {
  # A process on 0.0.0.0 alone accepts nothing over 6PN, and the symptom is
  # srh timing out against a redis that looks healthy in `fly logs`.
  grep -q -- '-::\*' "$FLY/redis.fly.toml"
}

# --- volumes must not prompt, and must match the app's region --------------

@test "volume creation passes an explicit --region" {
  # `fly volumes create` PROMPTS without one. On a real run that put the
  # volume in gru while primary_region said iad — an interactive prompt in
  # the middle of a scripted deploy, and a region mismatch after it.
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [[ "$output" == *"volumes create ctf_redis_data"*"--region gru"* ]]
}

@test "the volume region is read from the toml, not hardcoded twice" {
  # Change primary_region and the volume must follow, or the two drift.
  sed 's/^primary_region = .*/primary_region = "lhr"/' "$FLY/redis.fly.toml" > "$BATS_TEST_TMPDIR/redis.fly.toml"
  cp "$FLY"/*.fly.toml "$BATS_TEST_TMPDIR/" 2>/dev/null
  sed -i.bak 's/^primary_region = .*/primary_region = "lhr"/' "$BATS_TEST_TMPDIR/redis.fly.toml"
  region="$(sed -n 's/^primary_region *= *"\([^"]*\)".*/\1/p' "$BATS_TEST_TMPDIR/redis.fly.toml" | head -1)"
  [ "$region" = "lhr" ]
}

@test "both volumes get a region" {
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [ "$(printf '%s' "$output" | grep -c 'volumes create.*--region')" -eq 2 ]
}

# --- the region is asked for, not hardcoded --------------------------------
#
# On the first real run `fly volumes create` PROMPTED mid-deploy (it needs an
# explicit --region) and the operator — in Brazil — got a volume in gru against
# apps configured for iad. Volumes are region-pinned, so that is expensive to
# undo.

@test "init takes an explicit --region" {
  printf 'BETTER_AUTH_SECRET=x\n' > "$BATS_TEST_TMPDIR/src"
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" init --region gru \
    --from "$BATS_TEST_TMPDIR/src" --env-file "$BATS_TEST_TMPDIR/reg"
  grep -qx "FLY_REGION=gru" "$BATS_TEST_TMPDIR/reg"
}

@test "init rejects something that is not a region code" {
  # "Sao Paulo" is what someone types when they read the prompt as a place
  # name. Catching it here beats an opaque failure part-way through a deploy.
  printf 'BETTER_AUTH_SECRET=x\n' > "$BATS_TEST_TMPDIR/src"
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" init --region "Sao Paulo" \
    --from "$BATS_TEST_TMPDIR/src" --env-file "$BATS_TEST_TMPDIR/reg"
  [ "$status" -ne 0 ]
}

@test "init does not hang without a tty" {
  # A test or CI run has no terminal; it must take the default rather than
  # block forever on read.
  printf 'BETTER_AUTH_SECRET=x\n' > "$BATS_TEST_TMPDIR/src"
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" init \
    --from "$BATS_TEST_TMPDIR/src" --env-file "$BATS_TEST_TMPDIR/reg"
  [ "$status" -eq 0 ]
}

@test "one region drives every app and both volumes" {
  # Five deploys and two volumes, all in the region from the env file — not
  # the toml default, so a chosen region actually takes effect everywhere.
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [ "$(printf '%s' "$output" | grep -c -- '--primary-region gru')" -eq 5 ]
}

@test "both volumes use the chosen region, not the toml default" {
  run env PATH="/usr/bin:/bin" bash "$FLY/deploy.sh" --dry-run \
    --env-file "$BATS_TEST_TMPDIR/env" --config "$BATS_TEST_TMPDIR/event.yaml"
  [ "$(printf '%s' "$output" | grep -c -- 'volumes create.*--region gru')" -eq 2 ]
}

@test "deploy uses --primary-region, the flag fly actually has" {
  # `fly deploy` has NO --region flag; it is --primary-region. Checked against
  # flyctl's docs rather than assumed, after nearly shipping the wrong one.
  [ -z "$(grep -E 'fly_run deploy .*[^-]--region ' "$FLY/deploy.sh")" ]
}
