#!/usr/bin/env bats
#
# Checks on the AWS ECS module's deploy wrapper.
#
# `terraform validate` and `terraform test` cover the stack itself (see
# stack.tftest.hcl, which renders container definitions at plan time because
# validate never inspects rendered output). Neither can say anything about
# deploy.sh.
#
# Config v2 (#386) removed the app's build-time config entirely: GITHUB_ORG
# and ADMIN_LOGINS are runtime environment reads now (ecs.tf), so deploy.sh
# has no file to require and no config to bake into the image. What used to be
# the config-bake tests below now assert the ABSENCE of that machinery —
# no --config flag, no EVENT_CONFIG_B64 build arg — with a named failure, so a
# regression that reintroduced the bake would fail loudly rather than pass by
# omission.
#
# Nothing here touches AWS. `docker`, `aws` and `terraform` are replaced with
# stubs that record their arguments, which is also how the --dry-run tests
# prove a real call was never made rather than merely assuming it.
#
# Every test ends with its decisive assertion, in single brackets or a
# `grep -q`: AGENTS.md records that a `[[ ]]` or a negated pipeline in the
# middle of a @test does not fail it.

setup() {
  ROOT="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
  SCRIPT="$ROOT/deploy/aws-terraform/deploy.sh"
  STUBS="$BATS_TEST_TMPDIR/stubs"
  CALLS="$BATS_TEST_TMPDIR/calls.log"

  mkdir -p "$STUBS"
  : > "$CALLS"
  for tool in docker aws terraform; do
    printf '#!/bin/sh\necho "%s $*" >> "%s"\nexit 0\n' "$tool" "$CALLS" > "$STUBS/$tool"
    chmod +x "$STUBS/$tool"
  done

  PATH="$STUBS:$PATH"
}

@test "--dry-run makes no docker, aws or terraform call at all" {
  run "$SCRIPT" --dry-run
  [ "$status" -eq 0 ]
  # The whole point: a preview that shells out is not a preview. An empty log
  # is the assertion, so it has to be the last statement.
  [ ! -s "$CALLS" ]
}

@test "no config file is required — deploy.sh runs with none present" {
  # The old behavior refused to run without event.yaml. Config v2 removed
  # that file from the repo entirely, so the script must not look for one.
  [ ! -f "$ROOT/event.yaml" ]
  run "$SCRIPT" --dry-run
  [ "$status" -eq 0 ]
}

@test "--config is no longer accepted" {
  run "$SCRIPT" --dry-run --config /nonexistent/event.yaml
  [ "$status" -ne 0 ]
  echo "$output" | grep -q 'unknown argument'
}

@test "the docker build passes no EVENT_CONFIG_B64 build arg" {
  run "$SCRIPT" --dry-run
  [ "$status" -eq 0 ]
  # A regression here is silent otherwise: an image built with a stray
  # EVENT_CONFIG_B64 would just be an image with an ignored build arg, not an
  # obvious failure. Assert its absence by name.
  [ -z "$(echo "$output" | grep -F 'EVENT_CONFIG_B64')" ]
}

@test "the tag no longer depends on any config, only the revision" {
  run "$SCRIPT" --dry-run
  [ "$status" -eq 0 ]
  first="$(echo "$output" | sed -n 's/.*app_image = "\(.*\)".*/\1/p' | tail -1)"
  run "$SCRIPT" --dry-run
  [ "$status" -eq 0 ]
  second="$(echo "$output" | sed -n 's/.*app_image = "\(.*\)".*/\1/p' | tail -1)"
  # Idempotence: the same inputs (there is only the revision now) must produce
  # the same tag, or "ECR already has it, skipping" could never fire and every
  # deploy would rebuild.
  [ -n "$first" ] && [ "$first" = "$second" ]
}

@test "an empty terraform output is refused rather than used" {
  # `terraform output` can exit 0 and hand back nothing. Taken as valid it
  # builds a tag like ":abc123" and pushes it nowhere in particular — the
  # failure then surfaces as a confusing docker error instead of the missing
  # stack it actually is. The stubs above exit 0 with empty stdout, which is
  # exactly that case.
  run "$SCRIPT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -q 'ecr_app_repository_url'
}

@test "the dry-run registry placeholder cannot be mistaken for a real one" {
  run "$SCRIPT" --dry-run
  [ "$status" -eq 0 ]
  # A preview that printed a plausible account id would be worse than one that
  # obviously did not consult the stack.
  echo "$output" | grep -q '<account>\.dkr\.ecr\.<region>\.amazonaws\.com'
}

@test "an unknown argument is refused instead of ignored" {
  run "$SCRIPT" --destroy-everything
  [ "$status" -eq 2 ]
  echo "$output" | grep -q 'unknown argument'
}

@test "the build passes the /health build args" {
  run "$SCRIPT" --dry-run
  [ "$status" -eq 0 ]
  # Without these the deployed box reports revision "unknown" from /health and
  # "did my fix reach it?" has no answer — the gap #327 and #328 closed for the
  # Fly path. Assert both, since passing one and dropping the other still
  # leaves the endpoint half-blind.
  echo "$output" | grep -q 'APP_BUILD_REV=' && echo "$output" | grep -q 'APP_BUILT_AT='
}
