#!/usr/bin/env bats

# The push score-ingest mode is deprecated (issue #377) and removed in v0.7.
# Until then `--profile push` keeps working, and bringing it up has to SAY so:
# `docker-compose.yml` carries a one-shot `push-deprecated` service that
# prints the notice, profiled `push` alone so a poll (or app-only) line-up
# gets nothing extra.
#
# Asserted against the REAL compose file through `docker compose config`, the
# same way deploy/fly/test/fly.bats reads the rendered one: nothing is
# started, no daemon work happens, and the CI runner that runs this suite
# already has the compose plugin (the `shell` job's file filter includes
# docker-compose.yml for exactly this reason).

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

# Every variable compose interpolates at parse time, so `config` renders
# instead of refusing: REDIS_PASSWORD is `:?` (required — an unset value is a
# hard failure, not a default). stderr is deliberately NOT discarded: a
# swallowed interpolation error is how an empty service list turns into a
# vacuously passing comparison (scripts/acceptance-quiz-only.sh's lesson).
compose_config() {  # $@ = profile flags, then the `config` arguments
  env REDIS_PASSWORD=bats SRH_TOKEN=bats SCORER_TOKEN=bats \
    BETTER_AUTH_SECRET=bats GITHUB_CLIENT_ID=bats GITHUB_CLIENT_SECRET=bats \
    SCORE_IMAGE=example.invalid/score:bats \
    docker compose -f "$REPO_ROOT/docker-compose.yml" "$@"
}

@test "the push line-up carries the deprecation notice service" {
  run compose_config --profile push --profile app config --services
  [ "$status" -eq 0 ]
  echo "$output" | grep -qx 'push-deprecated'
}

@test "the notice names the issue, the release that removes it, and the move to poll" {
  run compose_config --profile push config
  [ "$status" -eq 0 ]
  echo "$output" | grep -qF 'issue #377'
  echo "$output" | grep -qF 'REMOVED in v0.7'
  # `-e`, because the pattern starts with a dash and grep would read it as
  # options otherwise.
  echo "$output" | grep -qF -e '--profile secdev --profile app'
}

@test "a poll line-up shows nothing extra: no notice service, no notice text" {
  run compose_config --profile secdev --profile app config --services
  [ "$status" -eq 0 ]
  # Not a vacuous absence: the poll services are all still here.
  echo "$output" | grep -qx 'sync'
  [ -z "$(echo "$output" | grep -F 'push-deprecated')" ]
  run compose_config --profile secdev --profile app config
  [ "$status" -eq 0 ]
  echo "$output" | grep -qF 'Caddyfile'
  # The text too, not just the service: a deprecation notice rendered into
  # every event's bring-up would be noise on the events that did nothing wrong.
  [ -z "$(echo "$output" | grep -F 'DEPRECATED')" ]
}

@test "an app-only line-up shows nothing extra either" {
  run compose_config --profile app config --services
  [ "$status" -eq 0 ]
  echo "$output" | grep -qx 'app'
  [ -z "$(echo "$output" | grep -F 'push-deprecated')" ]
}

@test "the notice reuses SCORE_IMAGE, carries the push profile alone, and names its network" {
  # Three properties of one service, read from the rendered config:
  #  - its image is the scorer's, so there is no second digest for Dependabot
  #    to keep honest (ADR 51) and no pull a poll event would ever pay for;
  #  - its profile list is exactly ["push"], so no other bring-up starts it;
  #  - it names a network, because a service with no `networks:` key joins a
  #    third, isolated `default` one nothing else can resolve (AGENTS.md).
  compose_config --profile push config --format json > "$BATS_TEST_TMPDIR/config.json"
  run node -e '
    const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const notice = c.services["push-deprecated"];
    if (!notice) { console.error("no push-deprecated service in the push line-up"); process.exit(1); }
    if (notice.image !== c.services.scorer.image) {
      console.error(`image ${notice.image} is not the scorer'"'"'s ${c.services.scorer.image}`);
      process.exit(1);
    }
    const p = notice.profiles || [];
    if (p.length !== 1 || p[0] !== "push") {
      console.error(`profiles are ${JSON.stringify(p)}, expected exactly ["push"]`);
      process.exit(1);
    }
    if (Object.keys(notice.networks || {}).length === 0) {
      console.error("push-deprecated declares no network");
      process.exit(1);
    }
  ' "$BATS_TEST_TMPDIR/config.json"
  echo "$output"
  [ "$status" -eq 0 ]
}
