#!/usr/bin/env bats
#
# Checks on the AWS ECS module's deploy wrapper.
#
# `terraform validate` and `terraform test` cover the stack itself (see
# stack.tftest.hcl, which renders container definitions at plan time because
# validate never inspects rendered output). Neither can say anything about
# deploy.sh, which is where the config bake lives — and the bake is the step
# whose failure mode is silent: an image built without EVENT_CONFIG_B64 ships
# an empty admins list, so /admin 403s for everyone, hours later.
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
  CONFIG="$BATS_TEST_TMPDIR/event.yaml"

  mkdir -p "$STUBS"
  : > "$CALLS"
  for tool in docker aws terraform; do
    printf '#!/bin/sh\necho "%s $*" >> "%s"\nexit 0\n' "$tool" "$CALLS" > "$STUBS/$tool"
    chmod +x "$STUBS/$tool"
  done

  printf 'event:\n  name: Bats Event\nadmins:\n  - someone\n' > "$CONFIG"
  PATH="$STUBS:$PATH"
}

@test "--dry-run makes no docker, aws or terraform call at all" {
  run "$SCRIPT" --dry-run --config "$CONFIG"
  [ "$status" -eq 0 ]
  # The whole point: a preview that shells out is not a preview. An empty log
  # is the assertion, so it has to be the last statement.
  [ ! -s "$CALLS" ]
}

@test "--dry-run redacts the event config it would bake" {
  run "$SCRIPT" --dry-run --config "$CONFIG"
  [ "$status" -eq 0 ]
  # The build arg carries the entire event.yaml, including the admin list. A
  # dry run is made to be pasted into a terminal or a review.
  echo "$output" | grep -q 'EVENT_CONFIG_B64=<redacted>'
}

@test "--dry-run never prints the base64 of the config" {
  run "$SCRIPT" --dry-run --config "$CONFIG"
  [ "$status" -eq 0 ]
  b64="$(base64 < "$CONFIG" | tr -d '\n')"
  [ -z "$(echo "$output" | grep -F "$b64")" ]
}

@test "a missing event.yaml is refused, and the message names the file" {
  run "$SCRIPT" --dry-run --config "$BATS_TEST_TMPDIR/nope.yaml"
  [ "$status" -ne 0 ]
  # A bare failure under set -e would say nothing; the config bake is the one
  # mistake worth spelling out, so the path has to appear.
  echo "$output" | grep -q 'nope.yaml'
}

@test "the image tag changes when event.yaml changes" {
  run "$SCRIPT" --dry-run --config "$CONFIG"
  [ "$status" -eq 0 ]
  first="$(echo "$output" | sed -n 's/.*app_image = "\(.*\)".*/\1/p' | tail -1)"

  printf 'event:\n  name: A Different Event\nadmins:\n  - someone-else\n' > "$CONFIG"
  run "$SCRIPT" --dry-run --config "$CONFIG"
  [ "$status" -eq 0 ]
  second="$(echo "$output" | sed -n 's/.*app_image = "\(.*\)".*/\1/p' | tail -1)"

  # Content addressing is the reason re-pushing an IMMUTABLE tag is safe: two
  # images from one commit differ when the event does, and a tag that ignored
  # that would name the wrong one.
  [ -n "$first" ] && [ -n "$second" ] && [ "$first" != "$second" ]
}

@test "the tag is stable for the same revision and the same config" {
  run "$SCRIPT" --dry-run --config "$CONFIG"
  first="$(echo "$output" | sed -n 's/.*app_image = "\(.*\)".*/\1/p' | tail -1)"
  run "$SCRIPT" --dry-run --config "$CONFIG"
  second="$(echo "$output" | sed -n 's/.*app_image = "\(.*\)".*/\1/p' | tail -1)"
  # Idempotence: the same inputs must produce the same tag, or "ECR already has
  # it, skipping" could never fire and every deploy would rebuild.
  [ -n "$first" ] && [ "$first" = "$second" ]
}

@test "an empty terraform output is refused rather than used" {
  # `terraform output` can exit 0 and hand back nothing. Taken as valid it
  # builds a tag like ":abc123" and pushes it nowhere in particular — the
  # failure then surfaces as a confusing docker error instead of the missing
  # stack it actually is. The stubs above exit 0 with empty stdout, which is
  # exactly that case.
  run "$SCRIPT" --config "$CONFIG"
  [ "$status" -ne 0 ]
  echo "$output" | grep -q 'ecr_app_repository_url'
}

@test "the dry-run registry placeholder cannot be mistaken for a real one" {
  run "$SCRIPT" --dry-run --config "$CONFIG"
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

@test "the build passes the /health build args, not just the config" {
  run "$SCRIPT" --dry-run --config "$CONFIG"
  [ "$status" -eq 0 ]
  # Without these the deployed box reports revision "unknown" from /health and
  # "did my fix reach it?" has no answer — the gap #327 and #328 closed for the
  # Fly path. Assert both, since passing one and dropping the other still
  # leaves the endpoint half-blind.
  echo "$output" | grep -q 'APP_BUILD_REV=' && echo "$output" | grep -q 'APP_BUILT_AT='
}
