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

@test "org strips trailing comments from org field (HIGH fix #1)" {
  cat > event.yaml <<'EOF'
github:
  org: my-event-org                # disposable per-event org
modules:
  secure-development:
    targets: [dvwa, vampi]
EOF
  run bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  # Must use exact org name without comment suffix
  [[ "$output" == *"gh repo fork OWASP-CTF/DVWA --org my-event-org"* ]]
  [[ "$output" == *"docker tag ghcr.io/owasp-ctf/score:latest ghcr.io/my-event-org/score:latest"* ]]
  # Ensure comment is not included
  [[ "$output" != *"disposable per-event org"* ]]
}

@test "teardown with unknown target exits non-zero and does not emit partial archive command (HIGH fix #2)" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
modules:
  secure-development:
    targets: [dvwa, nope]
EOF
  run bash "$SCRIPT" teardown --dry-run --config event.yaml
  [ "$status" -ne 0 ]
  [[ "$output" == *"unknown target: nope"* ]]
  # Must NOT emit archive command with empty repo name
  [[ "$output" != *"gh repo archive test-event-org/ --yes"* ]]
}

@test "teardown fails with missing org (MEDIUM fix #3)" {
  cat > event.yaml <<'EOF'
modules:
  secure-development:
    targets: [dvwa]
EOF
  run bash "$SCRIPT" teardown --dry-run --config event.yaml
  [ "$status" -ne 0 ]
  [[ "$output" == *"github.org missing"* ]]
}

@test "org handles flow-style github config (MEDIUM fix #3)" {
  cat > event.yaml <<'EOF'
github: { org: flow-event-org }
modules:
  secure-development:
    targets: [dvwa, vampi]
EOF
  run bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  [[ "$output" == *"gh repo fork OWASP-CTF/DVWA --org flow-event-org"* ]]
  [[ "$output" == *"gh repo fork OWASP-CTF/VAmPI --org flow-event-org"* ]]
}

@test "org pairs dvwa/vampi correctly with blank in targets list (MEDIUM fix #4)" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
modules:
  secure-development:
    targets: [dvwa,,vampi]
EOF
  run bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  # Must pair correctly: dvwa with DVWA consumer, vampi with VAmPI consumer
  output_lines=("${lines[@]}")
  # Check that the workflow fetch lines are paired correctly
  dvwa_found=0
  vampi_found=0
  for line in "${output_lines[@]}"; do
    if [[ "$line" == *"dvwa-consumer"* ]]; then
      dvwa_found=1
    fi
    if [[ "$line" == *"vampi-consumer"* ]]; then
      vampi_found=1
    fi
  done
  [ "$dvwa_found" -eq 1 ]
  [ "$vampi_found" -eq 1 ]
}

@test "org ignores decoy targets line outside modules.secure-development (MEDIUM fix #5)" {
  cat > event.yaml <<'EOF'
notes:
  targets: [webgoat]
github:
  org: test-event-org
modules:
  secure-development:
    targets: [dvwa, vampi]
EOF
  run bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  # Must use the correct targets (dvwa, vampi), not the decoy (webgoat)
  [[ "$output" == *"gh repo fork OWASP-CTF/DVWA --org test-event-org"* ]]
  [[ "$output" == *"gh repo fork OWASP-CTF/VAmPI --org test-event-org"* ]]
  # Must not fork webgoat
  [[ "$output" != *"gh repo fork OWASP-CTF/WebGoat"* ]]
}

@test "missing config file gives clean error" {
  run bash "$SCRIPT" org --dry-run --config nonexistent.yaml
  [ "$status" -ne 0 ]
  [[ "$output" == *"config not found: nonexistent.yaml"* ]]
}
