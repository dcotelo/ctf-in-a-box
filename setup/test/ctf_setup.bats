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

@test "org --dry-run plans the full idempotent sequence per target" {
  run env SCORE_IMAGE=ghcr.io/myorg/custom-score:v2 bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  echo "$output" | grep -qF "gh repo fork digininja/DVWA --org test-event-org --fork-name DVWA"
  echo "$output" | grep -qF "create refs/heads/ctf on test-event-org/DVWA from digininja/DVWA@d45ba3c"
  echo "$output" | grep -qF "branch protection on test-event-org/DVWA:ctf"
  echo "$output" | grep -qF ".github/workflows/ctf-score.yml on ctf"
  echo "$output" | grep -qF "disable every workflow on test-event-org/DVWA"
  echo "$output" | grep -qF "docker push ghcr.io/test-event-org/score:latest"
  echo "$output" | grep -qF "docker image inspect --format '{{.Architecture}}' ghcr.io/myorg/custom-score:v2"
  [ -z "$(echo "$output" | grep -F "OWASP-CTF/")" ]
  [ ! -e dist ]  # dry-run writes nothing
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
  [ -z "$(grep -E "<EVENT_ORG>|<TARGET>|<APP_URL>" dist/workflows/dvwa.ctf-score.yml)" ]
  [ -z "$(grep -E "<EVENT_ORG>|<TARGET>|<APP_URL>" dist/workflows/vampi.ctf-score.yml)" ]
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
  run env SCORE_IMAGE=ghcr.io/myorg/score:v1 bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -ne 0 ]
  [[ "$output" == *"unknown target: nope"* ]]
}

@test "org with empty targets list fails loudly instead of silently no-op'ing" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
modules:
  secure-development:
    targets: []
EOF
  run env SCORE_IMAGE=ghcr.io/myorg/score:v1 bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -ne 0 ]
  echo "$output" | grep -qF "event.yaml: no targets"
  # Must fail before doing anything, including the image mirror plan.
  [ -z "$(echo "$output" | grep -F "gh repo fork")" ]
  [ -z "$(echo "$output" | grep -F "mirroring scorer image")" ]
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
  [[ "$output" == *"render ctf-score.yml (TARGET=dvwa) and PUT to test-event-org/DVWA:.github/workflows/ctf-score.yml on ctf"* ]]
  [[ "$output" == *"render ctf-score.yml (TARGET=vampi) and PUT to test-event-org/VAmPI:.github/workflows/ctf-score.yml on ctf"* ]]
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

@test "org: quiz-only config provisions nothing and succeeds" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
modules:
  quiz: {}
EOF
  run bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  [ -z "$(printf '%s' "$output" | grep -F 'gh repo fork')" ]
}

@test "render: quiz-only config writes nothing and succeeds" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
modules:
  quiz: {}
EOF
  run bash "$SCRIPT" render --config event.yaml
  [ "$status" -eq 0 ]
  [ ! -d dist ]
}

@test "doctor: quiz-only config reports no provisioned content" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
modules:
  quiz: {}
EOF
  run bash "$SCRIPT" doctor --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  printf '%s' "$output" | grep -qi 'no .*content'
}

@test "unknown module key in event.yaml fails loudly (bash mirrors sync/src/config.js)" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
modules:
  forensics:
    targets: [dvwa]
EOF
  run env SCORE_IMAGE=ghcr.io/myorg/score:v1 bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -ne 0 ]
  printf '%s' "$output" | grep -qF 'unknown module: forensics'
}

@test "quiz alongside secure-development is a known combination, not rejected" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
modules:
  secure-development:
    targets: [dvwa]
  quiz: {}
EOF
  run env SCORE_IMAGE=ghcr.io/myorg/score:v1 bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  printf '%s' "$output" | grep -qF 'gh repo fork digininja/DVWA'
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
  echo "$output" | grep -qF "gh repo fork digininja/DVWA --org test-event-org --fork-name DVWA"
  echo "$output" | grep -qF "gh repo fork erev0s/VAmPI --org test-event-org --fork-name VAmPI"
  ! echo "$output" | grep -qF "OWASP-CTF/"
}

@test "ctf-branch + drop-old plan lines render" {
  # Exercise plan_step directly via a sourced self-test.
  run bash -c 'DRY_RUN=1; CMD=__selftest source "'"$SCRIPT"'"; plan_step ctf-branch dvwa test-event-org; plan_step drop-old dvwa test-event-org'
  echo "$output" | grep -qF "create refs/heads/ctf on test-event-org/DVWA from digininja/DVWA@d45ba3c"
  echo "$output" | grep -qF "delete master/main on test-event-org/DVWA"
}

@test "protect plan + check use the ctf branch protection endpoint" {
  run bash -c 'DRY_RUN=1; CMD=__selftest source "'"$SCRIPT"'"; plan_step protect webgoat test-event-org'
  [[ "$output" == *"branch protection on test-event-org/WebGoat:ctf"* ]]
}

@test "workflow + disable-inherited plan lines render" {
  run bash -c 'DRY_RUN=1; CMD=__selftest source "'"$SCRIPT"'"; plan_step workflow dvwa test-event-org; plan_step disable-inherited dvwa test-event-org'
  echo "$output" | grep -qF ".github/workflows/ctf-score.yml on ctf"
  echo "$output" | grep -qF "disable every workflow"
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

@test "check_step drop-old fails closed when the branch list call errors" {
  mkdir -p stubs
  cat > stubs/gh <<'EOF2'
#!/usr/bin/env bash
[ "$1" = api ] && exit 1
exit 0
EOF2
  chmod +x stubs/gh
  # Same rationale as the disable-inherited test above: exercise via `if
  # check_step …` so the `|| return 1` (not set -e) decides the outcome.
  PATH="$(pwd)/stubs:$PATH" run bash -c 'CMD=__selftest source "'"$SCRIPT"'"; if check_step drop-old dvwa test-event-org; then echo SATISFIED; else echo NOTSATISFIED; fi'
  [ "$status" -eq 0 ]
  echo "$output" | grep -qx NOTSATISFIED
}

@test "doctor table: fork column flips missing->done via stubbed gh" {
  # doctor renders a matrix (row per target, column per step). The fork cell is
  # the first status column, so awk column 2 of the target's row is its fork
  # state. missing gh => ❌ + nonzero exit; found gh => ✅.
  make_gh_stub missing
  PATH="$(pwd)/stubs:$PATH" run bash "$SCRIPT" doctor --config event.yaml
  [ "$status" -ne 0 ]
  [ "$(echo "$output" | awk '/^dvwa/{print $2}')" = "❌" ]
  make_gh_stub found
  PATH="$(pwd)/stubs:$PATH" run bash "$SCRIPT" doctor --config event.yaml
  [ "$(echo "$output" | awk '/^dvwa/{print $2}')" = "✅" ]
}

@test "pr-template plan + check use the ctf branch contents endpoint" {
  run bash -c 'DRY_RUN=1; CMD=__selftest source "'"$SCRIPT"'"; plan_step pr-template dvwa test-event-org'
  echo "$output" | grep -q "PUT setup/PULL_REQUEST_TEMPLATE.md to test-event-org/DVWA:.github/PULL_REQUEST_TEMPLATE.md on ctf"
}

@test "vapp-dockerfile only plans for vulnerableapp" {
  run bash -c 'DRY_RUN=1; CMD=__selftest source "'"$SCRIPT"'"; plan_step vapp-dockerfile dvwa test-event-org; echo "---"; plan_step vapp-dockerfile vulnerableapp test-event-org'
  echo "$output" | grep -qF -- "---"
  before="${output%%---*}"
  # vulnerableapp must actually get the PUT line (rules out a stub that never emits).
  echo "$output" | grep -q "PUT setup/vulnerableapp.Dockerfile to test-event-org/VulnerableApp:Dockerfile"
  # dvwa: nothing before the separator — this is the decisive, gating check.
  [ -z "$(echo "$before" | grep -o Dockerfile)" ]
}

@test "check_step vapp-dockerfile is satisfied (n/a) for non-vulnerableapp targets" {
  run bash -c 'CMD=__selftest source "'"$SCRIPT"'"; check_step vapp-dockerfile dvwa test-event-org'
  [ "$status" -eq 0 ]
}

@test "app-manifest --dry-run targets the event org's App-creation URL" {
  run bash "$SCRIPT" app-manifest --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  [[ "$output" == *"organizations/test-event-org/settings/apps/new"* ]]
  # redirect_url is REQUIRED by the create-from-manifest flow
  [[ "$output" == *"redirect_url="* ]]
  # dry-run must not open a browser or write an HTML form
  [ -z "$(echo "$output" | grep -F "STUB-OPEN")" ]
}

@test "app-config writes the App id + base64 key into .env" {
  printf 'GITHUB_APP_ID=\nGITHUB_APP_PRIVATE_KEY=\nGITHUB_APP_INSTALLATION_ID=\nEVENT_URL=x\n' > .env
  openssl genrsa -out app.pem 2048 2>/dev/null
  run bash "$SCRIPT" app-config --app-id 4242 --pem app.pem --installation-id 7
  [ "$status" -eq 0 ]
  grep -q '^GITHUB_APP_ID=4242$' .env
  grep -q '^GITHUB_APP_INSTALLATION_ID=7$' .env
  # base64 key landed and is non-empty, single-line
  key="$(grep '^GITHUB_APP_PRIVATE_KEY=' .env | cut -d= -f2-)"
  [ -n "$key" ]
  [ "$(grep -c '^GITHUB_APP_ID=' .env)" -eq 1 ]  # no duplicate key line
}

@test "app-config rejects a file that is not a PEM private key" {
  printf 'GITHUB_APP_ID=\nGITHUB_APP_PRIVATE_KEY=\n' > .env
  echo "not a key" > bad.txt
  run bash "$SCRIPT" app-config --app-id 1 --pem bad.txt
  [ "$status" -ne 0 ]
  [[ "$output" == *"not a PEM private key"* ]]
}

@test "app-config requires --app-id and --pem" {
  printf 'GITHUB_APP_ID=\n' > .env
  run bash "$SCRIPT" app-config --pem /dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"--app-id is required"* ]]
}

@test "oauth-app --dry-run prints the org OAuth-app URL + callback" {
  run bash "$SCRIPT" oauth-app --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  [[ "$output" == *"organizations/test-event-org/settings/applications/new"* ]]
  [[ "$output" == *"/api/auth/callback/github"* ]]
}

@test "oauth-config writes client id + secret (secret from stdin, not argv)" {
  printf 'GITHUB_CLIENT_ID=\nGITHUB_CLIENT_SECRET=\nEVENT_URL=http://localhost\n' > .env
  run bash -c 'echo "sup3rs3cret" | bash "'"$SCRIPT"'" oauth-config --client-id Iv1.test'
  [ "$status" -eq 0 ]
  grep -q '^GITHUB_CLIENT_ID=Iv1.test$' .env
  grep -q '^GITHUB_CLIENT_SECRET=sup3rs3cret$' .env
  [ "$(grep -c '^GITHUB_CLIENT_SECRET=' .env)" -eq 1 ]
}

@test "oauth-config requires --client-id" {
  printf 'GITHUB_CLIENT_ID=\n' > .env
  run bash "$SCRIPT" oauth-config
  [ "$status" -ne 0 ]
  [[ "$output" == *"--client-id is required"* ]]
}

@test "bare invocation runs the wizard (the default), not a usage error" {
  run bash "$SCRIPT"
  echo "$output" | grep -q "CTF-in-a-box setup wizard"
  [ -z "$(echo "$output" | grep -F 'usage: ctf-setup.sh')" ]
}

# Stub gh/docker/openssl on PATH so the wizard's prerequisite step (cmd_check)
# passes deterministically — CI runners have no `gh auth`, which would otherwise
# make the wizard bail at step 1 before reaching the step under test.
_stub_prereqs() {
  mkdir -p "$BATS_TEST_TMPDIR/stubbin"
  for c in gh docker openssl; do
    printf '#!/bin/sh\nexit 0\n' > "$BATS_TEST_TMPDIR/stubbin/$c"
    chmod +x "$BATS_TEST_TMPDIR/stubbin/$c"
  done
}

@test "wizard prompts for event config inline when github.org is unset, without dead-ending" {
  _stub_prereqs
  rm -f .env
  cat > event.yaml <<'YAML'
modules:
  secure-development:
    targets: [vampi]
YAML
  # No org -> the wizard must PROMPT inline (not halt): narrate the questions
  # under --dry-run and continue past step 3 to step 4 (proves no early exit).
  run env PATH="$BATS_TEST_TMPDIR/stubbin:$PATH" bash "$SCRIPT" wizard --dry-run
  echo "$output" | grep -q "Answer a few questions to write"
  echo "$output" | grep -q "GitHub org (disposable per-event org)"
  echo "$output" | grep -q "4/8  Scorer image"
}

@test "wizard --dry-run walks every step to bring-up without blocking" {
  _stub_prereqs
  rm -f .env event.yaml
  # No .env, no event.yaml: every step must narrate and flow through to step 8
  # instead of exiting early to make the operator edit a file and re-run.
  run env PATH="$BATS_TEST_TMPDIR/stubbin:$PATH" bash "$SCRIPT" wizard --dry-run
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "2/8  Secrets"
  echo "$output" | grep -q "3/8  Event config"
  echo "$output" | grep -q "8/8  Bring the containers up"
}

@test "wizard --dry-run does not build or push the scorer image" {
  _stub_prereqs
  rm -f .env event.yaml
  run env PATH="$BATS_TEST_TMPDIR/stubbin:$PATH" bash "$SCRIPT" wizard --dry-run
  # Step 4 offers to build but must skip it under --dry-run (ask_yn answers no).
  echo "$output" | grep -q "Build the scorer image"
  [ -z "$(echo "$output" | grep -F 'Successfully built')" ]
}

@test "wizard builds the scorer image for linux/amd64 (runners are amd64)" {
  # The build MUST pin --platform linux/amd64 or an arm64 image (Apple Silicon
  # default) fails the fork's scoring Action with 'no matching manifest'.
  run grep -F 'docker build --platform linux/amd64 -t "$img"' "$SCRIPT"
  [ "$status" -eq 0 ]
}

@test "expand_tilde resolves a leading ~ but leaves absolute paths alone" {
  run bash -c 'CMD=__selftest source "'"$SCRIPT"'"; expand_tilde "~/Downloads/k.pem"'
  [ "$output" = "$HOME/Downloads/k.pem" ]
  run bash -c 'CMD=__selftest source "'"$SCRIPT"'"; expand_tilde "~"'
  [ "$output" = "$HOME" ]
  run bash -c 'CMD=__selftest source "'"$SCRIPT"'"; expand_tilde "/abs/k.pem"'
  [ "$output" = "/abs/k.pem" ]
}

@test "ask_yn honours the default on an empty reply (Y=yes, N=no)" {
  # Output carries the prompt prefix, so match the decision token as a word.
  run bash -c 'CMD=__selftest source "'"$SCRIPT"'"; DRY_RUN=0; printf "\n" | { if ask_yn q Y; then echo DECIDE-YES; else echo DECIDE-NO; fi; }'
  echo "$output" | grep -qw DECIDE-YES
  run bash -c 'CMD=__selftest source "'"$SCRIPT"'"; DRY_RUN=0; printf "\n" | { if ask_yn q; then echo DECIDE-YES; else echo DECIDE-NO; fi; }'
  echo "$output" | grep -qw DECIDE-NO
}

@test "fork_detached / package_private confirm the UI-only steps by API" {
  mkdir -p "$BATS_TEST_TMPDIR/stubs"
  # Stub gh so `.fork` and `.visibility` are read from the flag we pass in.
  cat > "$BATS_TEST_TMPDIR/stubs/gh" <<'EOF2'
#!/usr/bin/env bash
# emit $FORK for a repos/... query, $VIS for a packages/... query
for a in "$@"; do case "$a" in repos/*) echo "${FORK:-}"; exit 0;; orgs/*packages*) echo "${VIS:-}"; exit 0;; esac; done
exit 0
EOF2
  chmod +x "$BATS_TEST_TMPDIR/stubs/gh"
  run env FORK=false PATH="$BATS_TEST_TMPDIR/stubs:$PATH" bash -c 'CMD=__selftest source "'"$SCRIPT"'"; if fork_detached o/r; then echo DETACHED; else echo STILLFORK; fi'
  echo "$output" | grep -qw DETACHED
  run env FORK=true PATH="$BATS_TEST_TMPDIR/stubs:$PATH" bash -c 'CMD=__selftest source "'"$SCRIPT"'"; if fork_detached o/r; then echo DETACHED; else echo STILLFORK; fi'
  echo "$output" | grep -qw STILLFORK
  run env VIS=private PATH="$BATS_TEST_TMPDIR/stubs:$PATH" bash -c 'CMD=__selftest source "'"$SCRIPT"'"; if package_private o; then echo PRIV; else echo NOTPRIV; fi'
  echo "$output" | grep -qw PRIV
  run env VIS=public PATH="$BATS_TEST_TMPDIR/stubs:$PATH" bash -c 'CMD=__selftest source "'"$SCRIPT"'"; if package_private o; then echo PRIV; else echo NOTPRIV; fi'
  echo "$output" | grep -qw NOTPRIV
}

@test "wait_workflows_settled aborts fast (no sleep-loop) when the workflows API errors" {
  # Must NOT sleep-loop on a failing API (that is what keeps the fail-closed
  # disable-inherited check fast); it returns 0 and lets the caller decide.
  # A single sleep cycle is 5s, so anything under that proves it did not loop.
  mkdir -p "$BATS_TEST_TMPDIR/stubs"
  printf '#!/usr/bin/env bash\n[ "$1" = api ] && exit 1\nexit 0\n' > "$BATS_TEST_TMPDIR/stubs/gh"
  chmod +x "$BATS_TEST_TMPDIR/stubs/gh"
  run env PATH="$BATS_TEST_TMPDIR/stubs:$PATH" bash -c 'CMD=__selftest source "'"$SCRIPT"'"; SECONDS=0; wait_workflows_settled o/r; echo "ELAPSED:$SECONDS"'
  local secs; secs="$(echo "$output" | sed -n 's/^ELAPSED://p')"
  [ "${secs:-99}" -lt 5 ]
}
