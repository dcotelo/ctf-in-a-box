#!/usr/bin/env bats

setup() {
  cd "$BATS_TEST_TMPDIR"
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
modules:
  secure-development:
    targets: [dvwa, vampi]
EOF
  SCRIPT="$BATS_TEST_DIRNAME/../ctf-setup.sh"
}

@test "org --dry-run plans fork, workflow, image mirror and grant per target" {
  run bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  [[ "$output" == *"gh repo fork OWASP-CTF/DVWA --org test-event-org"* ]]
  [[ "$output" == *"gh repo fork OWASP-CTF/VAmPI --org test-event-org"* ]]
  [[ "$output" == *"ctf-score.yml"* ]]
  [[ "$output" == *"docker tag ghcr.io/owasp-ctf/score:latest ghcr.io/test-event-org/score:latest"* ]]
  [[ "$output" == *"Manage Actions access"* ]]
}

@test "secrets generates all required values" {
  run bash "$SCRIPT" secrets --config event.yaml --out .env.test
  [ "$status" -eq 0 ]
  for var in BETTER_AUTH_SECRET SRH_TOKEN SCORER_TOKEN; do
    grep -qE "^${var}=.{20,}" .env.test
  done
}

@test "teardown --dry-run plans archive per target repo" {
  run bash "$SCRIPT" teardown --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  [[ "$output" == *"gh repo archive test-event-org/DVWA --yes"* ]]
  [[ "$output" == *"gh repo archive test-event-org/VAmPI --yes"* ]]
}

@test "unknown target in event.yaml fails loudly" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
modules:
  secure-development:
    targets: [dvwa, nope]
EOF
  run bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -ne 0 ]
  [[ "$output" == *"unknown target: nope"* ]]
}
