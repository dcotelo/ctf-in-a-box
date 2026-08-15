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

@test "org --dry-run plans fork, workflow render, image mirror and grant per target" {
  run env SCORE_IMAGE=ghcr.io/myorg/custom-score:v2 bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  [[ "$output" == *"gh repo fork digininja/DVWA --org test-event-org --fork-name DVWA"* ]]
  [[ "$output" == *"gh repo fork erev0s/VAmPI --org test-event-org --fork-name VAmPI"* ]]
  [[ "$output" != *"OWASP-CTF"* ]]
  # Workflow comes from the in-repo template, rendered per target — never
  # fetched from the private upstream repo.
  [[ "$output" == *"in-repo template"* ]]
  [[ "$output" == *"render template (EVENT_ORG=test-event-org TARGET=dvwa APP_URL=http://dvwa:80) -> dist/workflows/dvwa.ctf-score.yml"* ]]
  [[ "$output" == *"render template (EVENT_ORG=test-event-org TARGET=vampi APP_URL=http://vampi:5000) -> dist/workflows/vampi.ctf-score.yml"* ]]
  [[ "$output" == *"commit dist/workflows/dvwa.ctf-score.yml as .github/workflows/ctf-score.yml in test-event-org/DVWA"* ]]
  [[ "$output" != *"OWASP-CTF/dc34"* ]]
  [[ "$output" == *"docker tag ghcr.io/myorg/custom-score:v2 ghcr.io/test-event-org/score:latest"* ]]
  [[ "$output" == *"Manage Actions access"* ]]
  # dry-run must not write anything
  [ ! -e dist ]
}

@test "org fails loudly when SCORE_IMAGE is unset (no upstream image default)" {
  run bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -ne 0 ]
  [[ "$output" == *"SCORE_IMAGE not set"* ]]
  [[ "$output" == *"docs/scorer.md"* ]]
  # Must fail before planning any mutation
  [[ "$output" != *"gh repo fork"* ]]
  [[ "$output" != *"ghcr.io/owasp-ctf/score"* ]]
}

@test "render writes per-target workflows with all placeholders substituted" {
  run bash "$SCRIPT" render --config event.yaml
  [ "$status" -eq 0 ]
  [ -f dist/workflows/dvwa.ctf-score.yml ]
  [ -f dist/workflows/vampi.ctf-score.yml ]
  grep -q "EVENT_ORG: test-event-org" dist/workflows/dvwa.ctf-score.yml
  grep -q "TARGET: dvwa" dist/workflows/dvwa.ctf-score.yml
  grep -q "APP_URL: http://dvwa:80" dist/workflows/dvwa.ctf-score.yml
  grep -q "APP_URL: http://vampi:5000" dist/workflows/vampi.ctf-score.yml
  # No placeholder survives rendering
  ! grep -qE "<EVENT_ORG>|<TARGET>|<APP_URL>" dist/workflows/dvwa.ctf-score.yml
  ! grep -qE "<EVENT_ORG>|<TARGET>|<APP_URL>" dist/workflows/vampi.ctf-score.yml
  # The rendered workflow keeps the re-run cap (modules.md section 6.3)
  grep -q "concurrency:" dist/workflows/dvwa.ctf-score.yml
  grep -q "group: ctf-score-dvwa-" dist/workflows/dvwa.ctf-score.yml
  grep -q "COOLDOWN_MINUTES" dist/workflows/dvwa.ctf-score.yml
}

@test "org --dry-run honors SCORE_IMAGE env var for the mirror source" {
  run env SCORE_IMAGE=ghcr.io/myorg/custom-score:v2 bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  [[ "$output" == *"docker pull ghcr.io/myorg/custom-score:v2"* ]]
  [[ "$output" == *"docker tag ghcr.io/myorg/custom-score:v2 ghcr.io/test-event-org/score:latest"* ]]
  [[ "$output" != *"docker pull ghcr.io/owasp-ctf/score:latest"* ]]
}

@test "org --dry-run reads SCORE_IMAGE from .env when env var unset" {
  echo "SCORE_IMAGE=ghcr.io/other/score:pinned" > .env
  run bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  [[ "$output" == *"docker pull ghcr.io/other/score:pinned"* ]]
  [[ "$output" == *"docker tag ghcr.io/other/score:pinned ghcr.io/test-event-org/score:latest"* ]]
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
  run env SCORE_IMAGE=ghcr.io/myorg/score:v1 bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  # Must use exact org name without comment suffix
  [[ "$output" == *"gh repo fork digininja/DVWA --org my-event-org --fork-name DVWA"* ]]
  [[ "$output" == *"docker tag ghcr.io/myorg/score:v1 ghcr.io/my-event-org/score:latest"* ]]
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
  run env SCORE_IMAGE=ghcr.io/myorg/score:v1 bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  [[ "$output" == *"gh repo fork digininja/DVWA --org flow-event-org --fork-name DVWA"* ]]
  [[ "$output" == *"gh repo fork erev0s/VAmPI --org flow-event-org --fork-name VAmPI"* ]]
}

@test "org pairs dvwa/vampi correctly with blank in targets list (MEDIUM fix #4)" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
modules:
  secure-development:
    targets: [dvwa,,vampi]
EOF
  run env SCORE_IMAGE=ghcr.io/myorg/score:v1 bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  # Must pair correctly: dvwa's workflow into DVWA, vampi's into VAmPI
  [[ "$output" == *"TARGET=dvwa APP_URL=http://dvwa:80"* ]]
  [[ "$output" == *"TARGET=vampi APP_URL=http://vampi:5000"* ]]
  [[ "$output" == *"dist/workflows/dvwa.ctf-score.yml as .github/workflows/ctf-score.yml in test-event-org/DVWA"* ]]
  [[ "$output" == *"dist/workflows/vampi.ctf-score.yml as .github/workflows/ctf-score.yml in test-event-org/VAmPI"* ]]
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
  run env SCORE_IMAGE=ghcr.io/myorg/score:v1 bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  # Must use the correct targets (dvwa, vampi), not the decoy (webgoat)
  [[ "$output" == *"gh repo fork digininja/DVWA --org test-event-org --fork-name DVWA"* ]]
  [[ "$output" == *"gh repo fork erev0s/VAmPI --org test-event-org --fork-name VAmPI"* ]]
  # Must not fork webgoat
  [[ "$output" != *"gh repo fork "*"WebGoat"* ]]
}

@test "missing config file gives clean error" {
  run bash "$SCRIPT" org --dry-run --config nonexistent.yaml
  [ "$status" -ne 0 ]
  [[ "$output" == *"config not found: nonexistent.yaml"* ]]
}

@test "check succeeds without event.yaml (regression fix)" {
  # Create a directory with no event.yaml; stub tools so check passes
  mkdir -p stubs
  cat > stubs/gh <<'EOF'
#!/bin/bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "logged in"
  exit 0
fi
exit 1
EOF
  cat > stubs/docker <<'EOF'
#!/bin/bash
if [[ "$1" == "compose" && "$2" == "version" ]]; then
  echo "Docker Compose version v2.0"
  exit 0
fi
exit 1
EOF
  cat > stubs/openssl <<'EOF'
#!/bin/bash
exit 0
EOF
  chmod +x stubs/gh stubs/docker stubs/openssl

  # Run check with stubs in PATH (no event.yaml in directory)
  PATH="$(pwd)/stubs:$PATH" run bash "$SCRIPT" check
  [ "$status" -eq 0 ]
  # Must NOT fail with "config not found"
  [[ "$output" != *"config not found"* ]]
  [[ "$output" == *"OK: prerequisites present"* ]]
}

@test "targets.tsv drives prov_field/prov_repo_name" {
  run bash -c 'source "'"$SCRIPT"'" __selftest 2>/dev/null; prov_field juice-shop 2'
  [ "$status" -eq 0 ]
  [ "$output" = "juice-shop/juice-shop" ]
}

@test "prov_repo_name returns fork name; unknown target fails" {
  run bash -c 'CMD=__selftest source "'"$SCRIPT"'"; prov_repo_name vulnerableapp'
  [ "$status" -eq 0 ]; [ "$output" = "VulnerableApp" ]
  run bash -c 'CMD=__selftest source "'"$SCRIPT"'"; prov_field nope 2'
  [ "$status" -ne 0 ]; [[ "$output" == *"unknown target: nope"* ]]
}

@test "secrets succeeds without event.yaml (regression fix)" {
  # secrets does not need event.yaml; should succeed even without it
  run bash "$SCRIPT" secrets --out .env.secrets.test
  [ "$status" -eq 0 ]
  # Verify file was created with required variables
  for var in BETTER_AUTH_SECRET SRH_TOKEN SCORER_TOKEN; do
    grep -qE "^${var}=.{20,}" .env.secrets.test
  done
}

@test "static artifacts exist with the right shape" {
  [ -f "$BATS_TEST_DIRNAME/../PULL_REQUEST_TEMPLATE.md" ]
  grep -q "SCORED, not merged" "$BATS_TEST_DIRNAME/../PULL_REQUEST_TEMPLATE.md"
  [ -f "$BATS_TEST_DIRNAME/../vulnerableapp.Dockerfile" ]
  grep -q "EXPOSE 9090" "$BATS_TEST_DIRNAME/../vulnerableapp.Dockerfile"
}

make_gh_stub() {  # $1 = "found" | "missing"
  mkdir -p stubs
  cat > stubs/gh <<EOF
#!/usr/bin/env bash
# canned gh for tests. "$1"=found makes api reads succeed.
if [ "\$1" = api ]; then [ "$1" = found ] && exit 0 || exit 1; fi
# 'gh repo fork ...' and others: succeed.
exit 0
EOF
  chmod +x stubs/gh
}

@test "org --dry-run forks from upstream (not OWASP-CTF)" {
  run env SCORE_IMAGE=ghcr.io/myorg/s:v1 bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  [[ "$output" == *"gh repo fork digininja/DVWA --org test-event-org --fork-name DVWA"* ]]
  [[ "$output" == *"gh repo fork erev0s/VAmPI --org test-event-org --fork-name VAmPI"* ]]
  [[ "$output" != *"OWASP-CTF/"* ]]
}

@test "ctf-branch + drop-old plan lines render" {
  # Exercise plan_step directly via a sourced self-test.
  run bash -c 'DRY_RUN=1; CMD=__selftest source "'"$SCRIPT"'"; plan_step ctf-branch dvwa test-event-org; plan_step drop-old dvwa test-event-org'
  [[ "$output" == *"create refs/heads/ctf on test-event-org/DVWA from digininja/DVWA@d45ba3c"* ]]
  [[ "$output" == *"delete master/main on test-event-org/DVWA"* ]]
}

@test "protect plan + check use the ctf branch protection endpoint" {
  run bash -c 'DRY_RUN=1; CMD=__selftest source "'"$SCRIPT"'"; plan_step protect webgoat test-event-org'
  [[ "$output" == *"branch protection on test-event-org/WebGoat:ctf"* ]]
}

@test "workflow + disable-inherited plan lines render" {
  run bash -c 'DRY_RUN=1; CMD=__selftest source "'"$SCRIPT"'"; plan_step workflow dvwa test-event-org; plan_step disable-inherited dvwa test-event-org'
  [[ "$output" == *".github/workflows/ctf-score.yml on ctf"* ]]
  [[ "$output" == *"disable every workflow"* ]]
}

@test "check_step disable-inherited fails closed when gh api errors" {
  mkdir -p stubs
  cat > stubs/gh <<'EOF2'
#!/usr/bin/env bash
[ "$1" = api ] && exit 1
exit 0
EOF2
  chmod +x stubs/gh
  # Exercise the real call context (`if check_step …`), where set -e is
  # suppressed and the `|| return 1` in check_step is what forces
  # "not satisfied" — a bare top-level call would abort the subprocess on the
  # stub's failure and pass vacuously regardless of the fix.
  PATH="$(pwd)/stubs:$PATH" run bash -c 'CMD=__selftest source "'"$SCRIPT"'"; if check_step disable-inherited dvwa test-event-org; then echo SATISFIED; else echo NOTSATISFIED; fi'
  [ "$status" -eq 0 ]
  echo "$output" | grep -qx NOTSATISFIED
}

@test "doctor reports missing then done via stubbed gh" {
  make_gh_stub missing
  PATH="$(pwd)/stubs:$PATH" run bash "$SCRIPT" doctor --config event.yaml
  [ "$status" -ne 0 ]
  [[ "$output" == *"❌ fork"* ]]
  make_gh_stub found
  # Overall status stays non-zero here: only fork (+ the vapp-dockerfile n/a
  # guard) is implemented this task, so the other STEPS ids still report
  # ❌ regardless of gh — later tasks flip them to ✅ as each check_step arm
  # lands. What this asserts is that fork itself now resolves ✅.
  PATH="$(pwd)/stubs:$PATH" run bash "$SCRIPT" doctor --config event.yaml
  [[ "$output" == *"✅ fork"* ]]
}
