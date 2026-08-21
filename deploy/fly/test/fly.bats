#!/usr/bin/env bats
#
# Checks on the fly.io module. There is no `terraform validate` equivalent for
# fly.toml, and no account to deploy against in CI, so these assert the
# invariants a broken port would violate — the same posture as
# `deploy/aws-terraform/userdata.tftest.hcl`, which exists because `validate`
# never inspects rendered output.
#
# The render is exercised FOR REAL (it needs `docker compose`, which the CI
# runner has). That matters: this module's job is to turn docker-compose.yml
# into something flyctl can deploy, and every bug it has had so far lived in
# the OUTPUT, not in the source.
#
# Each assertion is the LAST statement in its test on purpose (AGENTS.md): a
# `[[ ... ]]` or a negated pipeline that is not last does not fail the test.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
  FLY="$REPO/deploy/fly"

  # Strip comments before asserting on structure. These files EXPLAIN the
  # blocks they deliberately omit, so a naive grep for "[[services]]" matches
  # the paragraph saying why there isn't one — a test that fails on its own
  # documentation. This has bitten three times; it is not hypothetical.
  uncommented() { grep -v '^[[:space:]]*#' "$1"; }

  # A complete fixture env so --dry-run reaches the deploy steps. An empty file
  # exits early on the required-value checks, which would make the dry-run
  # tests below pass for the wrong reason.
  #
  # Every secret value here is DISTINCTIVE and at least 8 characters, because
  # the leak tests below grep the rendered output for these exact strings. A
  # short or common value (say "secret") would match incidental text and turn
  # a real check into noise.
  cat > "$BATS_TEST_TMPDIR/env" <<'ENV'
EVENT_URL=https://ctf-in-a-box.fly.dev
BETTER_AUTH_SECRET=FIXTUREAUTHSECRETzzzzzzzzzzzz
GITHUB_CLIENT_ID=fixture-client-id
GITHUB_CLIENT_SECRET=FIXTURECLIENTSECRETyyyyyyyy
SCORER_TOKEN=FIXTURESCORERTOKENxxxxxxxx
SRH_TOKEN=FIXTURESRHTOKENwwwwwwwwww
REDIS_PASSWORD=FIXTUREREDISPASSvvvvvvvvv
SCORE_IMAGE=ghcr.io/fixture-org/score:latest
FLY_REGION=gru
GITHUB_APP_ID=1
GITHUB_APP_PRIVATE_KEY=RklYVFVSRVBSSVZBVEVLRVl1dXV1dQ==
GITHUB_APP_INSTALLATION_ID=1
ENV
  printf 'github: { org: fixture-org }\n' > "$BATS_TEST_TMPDIR/event.yaml"

  RENDERED="$BATS_TEST_TMPDIR/compose.fly.yml"
  render() {
    "$FLY/render-compose.sh" --env-file "$BATS_TEST_TMPDIR/env" --out "$RENDERED" \
      --app-image reg/app:t --sync-image reg/sync:t --scorer-image reg/scorer:t
  }
  # The render shells out to `docker compose`. Skipping is honest when docker
  # is absent (a laptop without it running the rest of the suite); CI has it,
  # so these never silently vanish where it counts.
  need_docker() {
    command -v docker >/dev/null || skip "docker not available"
    docker compose version >/dev/null 2>&1 || skip "docker compose not available"
  }
}

# ---------------------------------------------------------------------------
# fly.toml — one app, one machine.
# ---------------------------------------------------------------------------

@test "fly.toml deploys the rendered compose file, not a Dockerfile" {
  uncommented "$FLY/fly.toml" | grep -qF '[build.compose]'
}

@test "the compose file it names is the one render-compose.sh writes" {
  # flyctl resolves THIS path against the WORKING DIRECTORY, not against the
  # config file's directory — the opposite of `--dockerfile`, which resolves
  # against the config. The two rules are inconsistent inside flyctl, and
  # getting it wrong fails late, after images are pushed and IPs provisioned:
  #
  #   failed to provision seed volumes: failed to read compose file:
  #   open compose.fly.yml: no such file or directory
  #
  # deploy.sh always runs from the repo root, so the rendered file goes there
  # and this stays a bare filename.
  uncommented "$FLY/fly.toml" | grep -qE '^ *file *= *"compose\.fly\.yml"'
}

@test "deploy.sh renders to the path fly.toml will actually look in" {
  # The pair above and below only agree if deploy.sh writes the file where
  # flyctl reads it. Asserting each half separately is what let them disagree.
  grep -qE '^RENDERED="compose\.fly\.yml"' "$FLY/deploy.sh"
}

@test "the rendered compose file is gitignored" {
  # It is generated on every deploy and derives from .env.fly. Committing it
  # would put a build artefact in review diffs — and .env.fly itself reached
  # this public repo twice already, so nothing downstream of it gets tracked.
  cd "$REPO" && git check-ignore -q compose.fly.yml
}

@test "the rendered filename is not one flyctl auto-detects" {
  # flyctl auto-detects compose.yaml, compose.yml, docker-compose.yaml and
  # docker-compose.yml in the working directory. The rendered file sits at the
  # repo root, right beside the real docker-compose.yml, so its name must not
  # collide with that list — and the repo's own compose file must never be
  # deployed raw, with its ${VAR}s and two build: services intact.
  name="$(grep -E '^ *file *= *"' "$FLY/fly.toml" | head -1 | sed 's/.*"\(.*\)".*/\1/')"
  case "$name" in
    compose.yaml|compose.yml|docker-compose.yaml|docker-compose.yml)
      echo "$name collides with flyctl's auto-detected names"; return 1 ;;
  esac
  [ -n "$name" ]
}

@test "public traffic goes to the app container's port, not srh or scorer" {
  # Only ONE container in a machine receives inbound requests, chosen by
  # matching internal_port. 3000 is the app. If this ever said 80 the public
  # would be talking to srh — the datastore's REST API — directly.
  uncommented "$FLY/fly.toml" | grep -qE '^ *internal_port *= *3000'
}

@test "the machine is never auto-stopped" {
  # This machine holds redis and the sync poller, not just a web server. A
  # stopped machine is a stopped datastore and a poller that is not polling,
  # and no inbound request arrives to wake it while an event is quiet.
  uncommented "$FLY/fly.toml" | grep -qE '^ *auto_stop_machines *= *false'
}

@test "both volumes are declared" {
  # redis's append-only file and sync's cursor. Compose gets these from named
  # volumes, which Fly ignores in a compose file — so they must be [[mounts]]
  # here or the event loses every score on the next deploy.
  count="$(grep -v '^[[:space:]]*#' "$FLY/fly.toml" | grep -c 'source = ')"
  [ "$count" = "2" ]
}

@test "fly.toml names no image of its own" {
  # Every image is named in the rendered compose file. A `[build]` image here
  # would be a second, silent source of truth for what actually runs.
  [ -z "$(uncommented "$FLY/fly.toml" | grep -E '^ *image *=')" ]
}

# ---------------------------------------------------------------------------
# The render — what deploy.sh actually hands to flyctl.
#
# THE HEADLINE INVARIANT: no secret values. `docker compose config`
# interpolates every ${VAR}, so the unfiltered output is a file containing the
# whole event's credentials. These check for the VALUES, not the variable
# names, because a name-keyed strip list is exactly the sort of thing that
# goes stale when a service gains a credential.
# ---------------------------------------------------------------------------

@test "render: no secret value survives into the rendered file" {
  need_docker
  render
  for value in FIXTUREAUTHSECRETzzzzzzzzzzzz FIXTURECLIENTSECRETyyyyyyyy \
               FIXTURESCORERTOKENxxxxxxxx FIXTURESRHTOKENwwwwwwwwww \
               FIXTUREREDISPASSvvvvvvvvv RklYVFVSRVBSSVZBVEVLRVl1dXV1dQ==; do
    if grep -qF -- "$value" "$RENDERED"; then
      echo "LEAKED: $value is in $RENDERED"
      return 1
    fi
  done
  [ -s "$RENDERED" ]
}

@test "render: the redis password is not in any command line" {
  need_docker
  render
  # Not just absent from `environment:` — absent from argv too. A password in
  # a container's command is visible to `docker inspect`, to `ps` inside the
  # stack, and in every machine-config dump Fly produces.
  [ -z "$(grep -F 'requirepass' "$RENDERED" | grep -F 'FIXTUREREDISPASS')" ]
}

@test "render: no compose-only \$\$ escaping survives" {
  need_docker
  render
  # `$$` means "a literal $" TO COMPOSE, and `docker compose config` re-emits
  # it that way. Fly is not compose: it passes the string through, so `sh -c`
  # would expand `$$` as the shell's PID and redis would come up with a
  # password like "12345REDIS_PASSWORD" — healthy, and impossible to
  # authenticate against.
  [ -z "$(grep -F '$$' "$RENDERED")" ]
}

@test "render: redis still reads its password from the environment" {
  need_docker
  render
  # The counterpart to the two tests above: stripping and unescaping must not
  # have removed the expansion itself.
  grep -qF 'requirepass "$REDIS_PASSWORD"' "$RENDERED"
}

@test "render: every service resolves to loopback, not a service name" {
  need_docker
  render
  # Containers in one machine share a network namespace. There is no DNS
  # between them: `http://srh:80` resolves nowhere. This is also the whole
  # reason the deployment is one machine — srh's Redis client is IPv4-only and
  # Fly's private network is IPv6-only.
  [ -z "$(grep -E '://(srh|scorer|redis|app|sync):' "$RENDERED")" ]
}

@test "render: the REST and scorer URLs are present and point at localhost" {
  need_docker
  render
  # The negative test above passes trivially if the URLs vanished altogether.
  grep -qF 'UPSTASH_REDIS_REST_URL: http://localhost:80' "$RENDERED"
  grep -qF 'SCORER_URL: http://localhost:4000' "$RENDERED"
}

@test "render: caddy is not deployed" {
  need_docker
  render
  # Fly terminates TLS and issues certificates, so caddy has no job there —
  # and it would collide with srh, which also binds port 80 in the shared
  # namespace. Excluded by naming services explicitly in the render, NOT by
  # giving caddy a compose profile: profiling it would make the edge opt-in
  # for every LOCAL bring-up, so one forgotten flag would mean no ingress.
  [ -z "$(grep -E '^  caddy:' "$RENDERED")" ]
}

@test "render: every deployed service names an image" {
  need_docker
  render
  # flyctl requires `image` or `build` per service, and this module builds
  # nothing on Fly. A service that lost its image line fails the deploy with a
  # message that names the file, not the cause.
  services="$(grep -cE '^  [a-z-]+:' "$RENDERED")"
  images="$(grep -cE '^    image: ' "$RENDERED")"
  [ "$services" = "$images" ]
}

@test "render: all five services are present" {
  need_docker
  render
  for svc in app scorer sync srh redis; do
    if ! grep -qE "^  $svc:" "$RENDERED"; then
      echo "missing service: $svc"
      return 1
    fi
  done
  [ "$(grep -cE '^  [a-z-]+:' "$RENDERED")" = "5" ]
}

@test "render: no build, networks, volumes or profiles keys survive" {
  need_docker
  render
  # build:    flyctl rejects more than one, and cannot pass build args.
  # volumes:  named volumes are ignored by Fly; bind mounts name host paths
  #           that do not exist on a Fly machine.
  # networks: one machine, one namespace.
  # profiles: flyctl does not implement them, so leaving them would imply a
  #           filter Fly honours when it does not.
  [ -z "$(grep -E '^    (build|networks|volumes|profiles):' "$RENDERED")" ]
}

@test "render: no service is left with an empty environment key" {
  need_docker
  render
  # redis's entire environment is secrets, so stripping them leaves a bare
  # `environment:` — which is YAML null, not an empty mapping. Docker tolerates
  # it; a hand-rolled unmarshal into a map type need not.
  # An `environment:` key is empty exactly when the next line is not indented
  # deeper than it — including when it is the last line of the file.
  empty="$(awk '
    prev == 1 { match($0, /^ */); if (RLENGTH <= 4) print "EMPTY"; prev = 0 }
    /^    environment:[ \t]*$/ { prev = 1; next }
    END { if (prev == 1) print "EMPTY" }
  ' "$RENDERED")"
  [ -z "$empty" ]
}

@test "render: the output is valid compose" {
  need_docker
  render
  # Structural checks above are line-oriented; this one asks Docker whether the
  # document actually parses.
  docker compose -f "$RENDERED" config -q 2>/dev/null
}

@test "render: refuses to run without an image for every service" {
  # Fly builds nothing here, so a missing image is a deploy that fails late
  # with a message about the compose file rather than the flag that was
  # forgotten.
  run "$FLY/render-compose.sh" --env-file "$BATS_TEST_TMPDIR/env" \
    --out "$BATS_TEST_TMPDIR/x.yml" --app-image a --sync-image b
  [ "$status" -ne 0 ]
  echo "$output" | grep -qF -- '--scorer-image is required'
}

@test "render: refuses a missing env file" {
  run "$FLY/render-compose.sh" --env-file "$BATS_TEST_TMPDIR/nope" \
    --out "$BATS_TEST_TMPDIR/x.yml" --app-image a --sync-image b --scorer-image c
  [ "$status" -ne 0 ]
  echo "$output" | grep -qF 'FAIL: no'
}

# ---------------------------------------------------------------------------
# deploy.sh — the dry run is the command people run first, casually.
# ---------------------------------------------------------------------------

@test "dry-run makes no fly calls at all" {
  need_docker
  cd "$REPO"
  run ./deploy/fly/deploy.sh --dry-run --env-file "$BATS_TEST_TMPDIR/env" \
    --config "$BATS_TEST_TMPDIR/event.yaml"
  [ "$status" -eq 0 ]
  # Every fly invocation goes through fly_run, which prints instead of running.
  # A line that would call fly without that prefix is a real call in a dry run.
  [ -z "$(echo "$output" | grep -E '^fly ')" ]
}

@test "dry-run redacts every secret value it would set" {
  need_docker
  cd "$REPO"
  run ./deploy/fly/deploy.sh --dry-run --env-file "$BATS_TEST_TMPDIR/env" \
    --config "$BATS_TEST_TMPDIR/event.yaml"
  # This regressed once for real: an organizer previewed a deploy and watched
  # their GitHub App private key, OAuth client secret and BETTER_AUTH_SECRET
  # scroll past into a terminal, a scrollback buffer, and whatever was
  # capturing the screen.
  for value in FIXTUREAUTHSECRETzzzzzzzzzzzz FIXTURECLIENTSECRETyyyyyyyy \
               FIXTURESCORERTOKENxxxxxxxx FIXTURESRHTOKENwwwwwwwwww \
               FIXTUREREDISPASSvvvvvvvvv RklYVFVSRVBSSVZBVEVLRVl1dXV1dQ==; do
    if echo "$output" | grep -qF -- "$value"; then
      echo "LEAKED in dry-run output: $value"
      return 1
    fi
  done
  echo "$output" | grep -qF 'BETTER_AUTH_SECRET=<redacted>'
}

@test "dry-run still shows WHICH variables get set" {
  need_docker
  cd "$REPO"
  run ./deploy/fly/deploy.sh --dry-run --env-file "$BATS_TEST_TMPDIR/env" \
    --config "$BATS_TEST_TMPDIR/event.yaml"
  # Redaction that hides the variable NAMES too would defeat the point of
  # previewing: the reason to run this is to check what is configured where.
  echo "$output" | grep -qF 'UPSTASH_REDIS_REST_TOKEN=<redacted>'
}

@test "the srh connection string points at loopback" {
  need_docker
  cd "$REPO"
  run ./deploy/fly/deploy.sh --dry-run --env-file "$BATS_TEST_TMPDIR/env" \
    --config "$BATS_TEST_TMPDIR/event.yaml"
  # It is redacted in the output (it embeds the password), so this asserts on
  # the rendered file's sibling: the variable is set at all.
  echo "$output" | grep -qF 'SRH_CONNECTION_STRING=<redacted>'
}

@test "a non-https EVENT_URL is refused" {
  cd "$REPO"
  sed 's|^EVENT_URL=.*|EVENT_URL=http://localhost|' "$BATS_TEST_TMPDIR/env" > "$BATS_TEST_TMPDIR/env.http"
  run ./deploy/fly/deploy.sh --dry-run --env-file "$BATS_TEST_TMPDIR/env.http" \
    --config "$BATS_TEST_TMPDIR/event.yaml"
  [ "$status" -ne 0 ]
  # ADR 39: the app refuses to serve a production event over plain HTTP, so
  # this would deploy an app that answers 500 to everything.
  echo "$output" | grep -qF 'must be your app'
}

@test "an unfilled placeholder EVENT_URL is refused" {
  cd "$REPO"
  sed 's|^EVENT_URL=.*|EVENT_URL=https://<your-app>.fly.dev|' "$BATS_TEST_TMPDIR/env" > "$BATS_TEST_TMPDIR/env.ph"
  run ./deploy/fly/deploy.sh --dry-run --env-file "$BATS_TEST_TMPDIR/env.ph" \
    --config "$BATS_TEST_TMPDIR/event.yaml"
  [ "$status" -ne 0 ]
  # It passes the https:// test, so without this it deploys and fails much
  # later as a redirect_uri mismatch nobody can resolve.
  echo "$output" | grep -qF 'placeholder'
}

@test "a missing REDIS_PASSWORD names REDIS_PASSWORD and nothing else" {
  cd "$REPO"
  grep -v '^REDIS_PASSWORD=' "$BATS_TEST_TMPDIR/env" > "$BATS_TEST_TMPDIR/env.nored"
  run ./deploy/fly/deploy.sh --dry-run --env-file "$BATS_TEST_TMPDIR/env.nored" \
    --config "$BATS_TEST_TMPDIR/event.yaml"
  [ "$status" -ne 0 ]
  # Naming several variables when one is absent sends the reader to check the
  # ones they already set.
  [ -z "$(echo "$output" | grep -F 'SRH_TOKEN and')" ]
}

@test "--skip-build warns that event.yaml will not be picked up" {
  need_docker
  cd "$REPO"
  run ./deploy/fly/deploy.sh --dry-run --skip-build --env-file "$BATS_TEST_TMPDIR/env" \
    --config "$BATS_TEST_TMPDIR/event.yaml"
  # The app bakes event.yaml at BUILD time, so "skip the build" and "pick up
  # the new config" are contradictory. Silently deploying a stale config that
  # looks deployed is the failure this prevents.
  echo "$output" | grep -qF 'baked'
}

@test "init needs no fly CLI and touches nothing on Fly" {
  cd "$REPO"
  cp "$BATS_TEST_TMPDIR/env" "$BATS_TEST_TMPDIR/env.init"
  run ./deploy/fly/deploy.sh init --dry-run --env-file "$BATS_TEST_TMPDIR/env.init"
  [ "$status" -eq 0 ]
  [ -z "$(echo "$output" | grep -E '^fly ')" ]
}

@test "init rejects a region that is not a Fly region code" {
  cd "$REPO"
  grep -v '^FLY_REGION=' "$BATS_TEST_TMPDIR/env" > "$BATS_TEST_TMPDIR/env.noregion"
  run ./deploy/fly/deploy.sh init --env-file "$BATS_TEST_TMPDIR/env.noregion" --region GRU1
  [ "$status" -ne 0 ]
  echo "$output" | grep -qF 'not a Fly region code'
}

# ---------------------------------------------------------------------------
# Cross-file agreement.
# ---------------------------------------------------------------------------

@test "deploy.sh and fly.toml agree on the app name" {
  # deploy.sh reads the name out of fly.toml rather than repeating it, so this
  # guards the reader, not a duplicated constant.
  cd "$REPO"
  run ./deploy/fly/deploy.sh --dry-run --env-file "$BATS_TEST_TMPDIR/env" \
    --config "$BATS_TEST_TMPDIR/event.yaml"
  name="$(grep -E '^app *= *"' "$FLY/fly.toml" | head -1 | sed 's/.*"\(.*\)".*/\1/')"
  echo "$output" | grep -qF "== app: $name"
}

@test "sync can take its config from EVENT_CONFIG_B64" {
  # The single-machine deployment has no repo checkout to bind-mount
  # ./event.yaml from, so sync must accept the config the same way the app
  # does. Without this the poller reads a file that is not there.
  grep -qF 'EVENT_CONFIG_B64' "$REPO/sync/src/config.js"
}

@test "docker-compose.yml passes EVENT_CONFIG_B64 through to sync" {
  # The render carries whatever compose declares; if the variable is not wired
  # in the source file it cannot reach the deployed poller.
  grep -qF 'EVENT_CONFIG_B64: ${EVENT_CONFIG_B64:-}' "$REPO/docker-compose.yml"
}

@test "the deploy passes a prebuilt image so flyctl does not try to build one" {
  need_docker
  cd "$REPO"
  run ./deploy/fly/deploy.sh --dry-run --env-file "$BATS_TEST_TMPDIR/env" \
    --config "$BATS_TEST_TMPDIR/event.yaml"
  # Without this the first real deploy died after every image was already
  # built and pushed: flyctl resolves a machine image before it reads the
  # compose file, and with no [build] section it has nothing to resolve —
  # "app does not have a Dockerfile or buildpacks configured". Zero buildable
  # services is fine to the compose parser; it is `fly deploy` that objects.
  echo "$output" | grep -qE 'fly deploy .*--image registry\.fly\.io/[^ ]+:app'
}
