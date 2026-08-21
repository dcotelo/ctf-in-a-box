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
  for var in BETTER_AUTH_SECRET SRH_TOKEN SCORER_TOKEN REDIS_PASSWORD; do
    grep -qE "^${var}=.{20,}" .env.test
  done
}

# Its own test, not just another entry in the loop above: docker-compose.yml
# uses `${REDIS_PASSWORD:?...}`, so an .env without this value does not start
# a weaker stack — it does not start at all. A generator that silently stopped
# emitting it would strand every new organizer at the bring-up.
@test "secrets generates a Redis password, without which compose refuses to start" {
  run bash "$SCRIPT" secrets --config event.yaml --out .env.redispw.test
  [ "$status" -eq 0 ]
  grep -qE "^REDIS_PASSWORD=[0-9a-f]{32,}$" .env.redispw.test
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
  v="$(template_version)"
  [[ "$output" == *"render ctf-score.yml v$v (TARGET=dvwa) and PUT to test-event-org/DVWA:.github/workflows/ctf-score.yml on ctf"* ]]
  [[ "$output" == *"render ctf-score.yml v$v (TARGET=vampi) and PUT to test-event-org/VAmPI:.github/workflows/ctf-score.yml on ctf"* ]]
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

@test "org: event.yaml with no modules: block at all fails (mirrors sync's requirement)" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
EOF
  run env SCORE_IMAGE=ghcr.io/myorg/score:v1 bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -ne 0 ]
  printf '%s' "$output" | grep -qF 'modules.secure-development is required'
}

@test "doctor: event.yaml with no modules: block at all fails" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
EOF
  run bash "$SCRIPT" doctor --dry-run --config event.yaml
  [ "$status" -ne 0 ]
  printf '%s' "$output" | grep -qF 'modules.secure-development is required'
}

@test "render: event.yaml with no modules: block at all fails" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
EOF
  run bash "$SCRIPT" render --config event.yaml
  [ "$status" -ne 0 ]
  printf '%s' "$output" | grep -qF 'modules.secure-development is required'
}

@test "org: a present modules: block that only lacks secure-development still succeeds" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
modules:
  quiz: {}
EOF
  run bash "$SCRIPT" org --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  printf '%s' "$output" | grep -qF 'no provisioned content'
}

@test "teardown --dry-run still works with an unknown module key (no stranded organizer)" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
modules:
  forensics:
    targets: [dvwa]
EOF
  run bash "$SCRIPT" teardown --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  # teardown reads only the secure-development: block (yaml_targets is scoped
  # to it), so an unrecognized module elsewhere is inert here — decisive part
  # of this test is that it is NOT rejected by the module-key check at all.
  [ -z "$(printf '%s' "$output" | grep -F 'unknown module')" ]
}

@test "app-manifest --dry-run still works with an unknown module key (no functional dependency on modules)" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
modules:
  forensics: {}
EOF
  run bash "$SCRIPT" app-manifest --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  printf '%s' "$output" | grep -qF 'organizations/test-event-org/settings/apps/new'
}

@test "oauth-app --dry-run still works with an unknown module key (no functional dependency on modules)" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
modules:
  forensics: {}
EOF
  run bash "$SCRIPT" oauth-app --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  printf '%s' "$output" | grep -qF 'organizations/test-event-org/settings/applications/new'
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
  for var in BETTER_AUTH_SECRET SRH_TOKEN SCORER_TOKEN REDIS_PASSWORD; do
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

@test "wizard prints the compose profiles the configured modules actually need" {
  _stub_prereqs
  rm -f .env
  cat > event.yaml <<'YAML'
github:
  org: test-event-org
modules:
  quiz: {}
YAML
  # A quiz-only event has no scorer image to pull and nothing to poll, so the
  # bring-up it prints must NOT ask for the score-ingest profiles — those
  # carry secure-development's sync + scorer (docker-compose.yml, ADR 26).
  run env PATH="$BATS_TEST_TMPDIR/stubbin:$PATH" bash "$SCRIPT" wizard --dry-run
  [ "$status" -eq 0 ]
  [ -z "$(echo "$output" | grep -F -- '--profile poll')" ]
  [ -z "$(echo "$output" | grep -F -- '--profile push')" ]
  echo "$output" | grep -qF 'docker compose --profile app up -d --build'
}

@test "wizard prints the poll profiles for a secure-development event" {
  _stub_prereqs
  rm -f .env
  cat > event.yaml <<'YAML'
github:
  org: test-event-org
modules:
  secure-development:
    targets: [dvwa]
YAML
  run env PATH="$BATS_TEST_TMPDIR/stubbin:$PATH" bash "$SCRIPT" wizard --dry-run
  [ "$status" -eq 0 ]
  echo "$output" | grep -qF 'docker compose --profile poll --profile app up -d --build'
}

# --------------------------------------------------------------------------
# Module-aware wizard: which questions get asked is a function of which
# modules the organizer enables. The failure this guards against is an
# organizer being made to pick vulnerable-app targets for an event that runs
# only a quiz — and then getting an event.yaml with a secure-development block
# they never asked for, which turns on nav, a challenge browser and
# leaderboard columns for forks that do not exist.
# --------------------------------------------------------------------------

@test "wizard asks which modules to enable, offering the known module keys" {
  _stub_prereqs
  rm -f .env event.yaml
  run env PATH="$BATS_TEST_TMPDIR/stubbin:$PATH" bash "$SCRIPT" wizard --dry-run
  [ "$status" -eq 0 ]
  echo "$output" | grep -qF 'Modules to enable — subset of: secure-development quiz'
}

@test "wizard: a quiz-only event is NEVER asked for targets or score ingest" {
  _stub_prereqs
  rm -f .env
  # A half-finished quiz-only config (no org yet): the modules question
  # defaults to what the file already declares, so re-running must not switch
  # the organizer back to secure-development — nor ask them to pick targets
  # for a module they deliberately did not enable.
  cat > event.yaml <<'YAML'
modules:
  quiz: {}
YAML
  run env PATH="$BATS_TEST_TMPDIR/stubbin:$PATH" bash "$SCRIPT" wizard --dry-run
  [ "$status" -eq 0 ]
  echo "$output" | grep -qF 'Modules to enable — subset of: secure-development quiz classic [quiz]'
  [ -z "$(echo "$output" | grep -F 'Targets — subset of')" ]
  [ -z "$(echo "$output" | grep -F 'Score ingest')" ]
}

@test "wizard: a secure-development event IS asked for targets, from targets.tsv" {
  _stub_prereqs
  rm -f .env event.yaml
  run env PATH="$BATS_TEST_TMPDIR/stubbin:$PATH" bash "$SCRIPT" wizard --dry-run
  [ "$status" -eq 0 ]
  echo "$output" | grep -qF 'Score ingest (poll | push)'
  # Every target the provisioner knows must be on offer — the prompt is
  # generated from targets.tsv, not a second hand-maintained list.
  local t fails=""
  for t in $(grep -v '^[[:space:]]*#' "$BATS_TEST_DIRNAME/../targets.tsv" | cut -f1); do
    if [ -z "$(echo "$output" | grep -F 'Targets — subset of' | grep -F "$t")" ]; then fails="$fails $t"; fi
  done
  echo "missing from the targets prompt:$fails"
  [ -z "$fails" ]
}

@test "wizard: the modules answer defaults to what an existing config declares" {
  _stub_prereqs
  rm -f .env
  cat > event.yaml <<'YAML'
modules:
  secure-development:
    targets: [dvwa]
  quiz: {}
YAML
  run env PATH="$BATS_TEST_TMPDIR/stubbin:$PATH" bash "$SCRIPT" wizard --dry-run
  [ "$status" -eq 0 ]
  echo "$output" | grep -qF 'Modules to enable — subset of: secure-development quiz classic [secure-development quiz]'
}

@test "wizard: a quiz-only event skips the scorer image and poll App steps" {
  _stub_prereqs
  rm -f .env
  cat > event.yaml <<'YAML'
github:
  org: test-event-org
modules:
  quiz: {}
YAML
  run env PATH="$BATS_TEST_TMPDIR/stubbin:$PATH" bash "$SCRIPT" wizard --dry-run
  [ "$status" -eq 0 ]
  [ -z "$(echo "$output" | grep -F 'Build the scorer image')" ]
  [ -z "$(echo "$output" | grep -F 'App-creation form')" ]
  echo "$output" | grep -qF 'no secure-development module (nothing to poll)'
}

@test "wizard: a complete quiz-only config is not re-asked (no targets to demand)" {
  _stub_prereqs
  rm -f .env
  cat > event.yaml <<'YAML'
github:
  org: test-event-org
modules:
  quiz: {}
YAML
  run env PATH="$BATS_TEST_TMPDIR/stubbin:$PATH" bash "$SCRIPT" wizard --dry-run
  [ "$status" -eq 0 ]
  [ -z "$(echo "$output" | grep -F 'Answer a few questions to write')" ]
  echo "$output" | grep -qF "✅ event.yaml (org: test-event-org)"
}

@test "wizard: an enabled secure-development with no targets IS re-asked" {
  _stub_prereqs
  rm -f .env
  cat > event.yaml <<'YAML'
github:
  org: test-event-org
modules:
  secure-development: {}
YAML
  run env PATH="$BATS_TEST_TMPDIR/stubbin:$PATH" bash "$SCRIPT" wizard --dry-run
  [ "$status" -eq 0 ]
  echo "$output" | grep -qF 'Answer a few questions to write'
}

@test "wiz_modules rejects an unknown module and an empty selection" {
  run bash -c 'CMD=__selftest source "$1"; wiz_modules "quiz nonsense"' _ "$SCRIPT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qF 'unknown module: nonsense'
  run bash -c 'CMD=__selftest source "$1"; wiz_modules "  "' _ "$SCRIPT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qF 'at least one module must be enabled'
}

@test "wiz_modules normalizes to KNOWN_MODULES order, deduped, commas allowed" {
  run bash -c 'CMD=__selftest source "$1"; wiz_modules "quiz, secure-development, quiz"' _ "$SCRIPT"
  [ "$status" -eq 0 ]
  echo "$output" | grep -qx 'secure-development quiz'
}

@test "wiz_event_yaml refuses to write a modules: block with nothing under it" {
  # All three readers reject a keyless modules: block, so emitting one would
  # hand the organizer a config that provisions nothing and crash-loops sync.
  run bash -c 'CMD=__selftest source "$1"; wiz_event_yaml n "" org "" "" poll admin' _ "$SCRIPT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qF 'at least one module must be enabled'
}

@test "wiz_event_yaml refuses secure-development with no targets" {
  run bash -c 'CMD=__selftest source "$1"; wiz_event_yaml n "" org secure-development "" poll admin' _ "$SCRIPT"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qF 'secure-development needs at least one target'
}

@test "wiz_event_yaml emits no hints or teams key, because nothing reads either" {
  # Neither key has ever been read — generate-event-config.mjs mentions neither
  # word — so whatever value they carried misled the organizer. `hints:
  # { enabled: false }` still served hints (ADR 31: /admin is the only hint
  # switch); `teams: { max_size: 6 }` still capped teams at 4
  # (TEAM_MAX_MEMBERS in team-store.ts). Both are gone rather than corrected,
  # because a key that cannot change the answer misleads at any value.
  run bash -c 'CMD=__selftest source "$1"; wiz_event_yaml n "" org quiz "" poll admin' _ "$SCRIPT"
  [ "$status" -eq 0 ]
  [ -z "$(echo "$output" | grep -E 'hints|teams')" ]
}

@test "wiz_event_yaml still emits the admins list it dropped those keys beside" {
  # The three keys were emitted by one printf. Guard against the removal having
  # taken admins with it — an empty admins list means /admin 403s for everyone,
  # which is silent until an organizer tries to open the panel.
  run bash -c 'CMD=__selftest source "$1"; wiz_event_yaml n "" org quiz "" poll dcotelo' _ "$SCRIPT"
  [ "$status" -eq 0 ]
  echo "$output" | grep -qx 'admins: \[dcotelo\]'
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

# Regression: `app-manifest` and `oauth-app` open GitHub pages in a browser.
# The --dry-run guards at each call site cover the documented rehearsal path,
# but a REAL invocation from any automated context — a test harness, CI, an
# agent driving the script against a fixture config — used to open actual tabs
# on whoever's machine ran it. That happened, against this very fixture org.
#
# Stub every external tool (including the openers) so nothing can escape the
# test, then assert the no-TTY branch was taken: bats runs with no controlling
# terminal, so `open` must never be reached.
@test "oauth-app does not launch a browser when no terminal is attached" {
  mkdir -p stubs
  printf '#!/bin/sh\necho "STUB-OPEN $*"\n' > stubs/open
  printf '#!/bin/sh\necho "STUB-XDG $*"\n' > stubs/xdg-open
  printf '#!/bin/sh\nexit 0\n' > stubs/gh
  chmod +x stubs/open stubs/xdg-open stubs/gh
  PATH="$(pwd)/stubs:$PATH" run bash "$SCRIPT" oauth-app --config event.yaml
  [ -z "$(printf '%s' "$output" | grep -F 'STUB-OPEN')" ]
  printf '%s' "$output" | grep -qF 'open this manually:'
}

@test "CTF_NO_BROWSER suppresses the launch outright" {
  mkdir -p stubs
  printf '#!/bin/sh\necho "STUB-OPEN $*"\n' > stubs/open
  printf '#!/bin/sh\nexit 0\n' > stubs/gh
  chmod +x stubs/open stubs/gh
  PATH="$(pwd)/stubs:$PATH" CTF_NO_BROWSER=1 run bash "$SCRIPT" oauth-app --config event.yaml
  printf '%s' "$output" | grep -qF 'open this manually:'
}

# --- doctor: per-fork package Read grant, verified by observation -----------
#
# The grant has no API to read back, but it has an observable consequence: the
# fork's own scoring workflow either pulled the scorer image or was refused.
# These stub `gh` to replay that history. Assertions target the grant block
# only — the provisioning matrix above it has its own tests.

# Writes a `gh` stub that answers the two endpoints `pull_grant_status` reads
# and shrugs at everything else. $1 = the run-step conclusion to report for
# DVWA; VAmPI is always left with no runs at all, so every case below also
# pins the "never ran" arm alongside the one it is really about.
write_gh_grant_stub() {
  mkdir -p stubs
  cat > stubs/gh <<EOF
#!/usr/bin/env bash
case "\$*" in
  *"DVWA/actions/workflows/ctf-score.yml/runs"*) echo 101 ;;
  *"VAmPI/actions/workflows/ctf-score.yml/runs"*) ;;
  *"DVWA/actions/runs/101/jobs"*) echo "$1" ;;
  *"packages/container/score"*) echo private ;;
  *) exit 1 ;;
esac
EOF
  chmod +x stubs/gh
}

@test "doctor reports a package grant as granted when a run pulled the image" {
  write_gh_grant_stub success
  run env PATH="$BATS_TEST_TMPDIR/stubs:$PATH" NO_COLOR=1 bash "$SCRIPT" doctor --config event.yaml
  [[ "$output" == *"per-fork package Read grant"* ]]
  printf '%s' "$output" | grep -qE '^  dvwa +✅ granted'
}

# The failure this whole feature exists for: without it, a missing grant
# surfaces as "Scoring did not complete" on a contestant's PR.
@test "doctor reports a package grant as MISSING when a run was refused the image" {
  write_gh_grant_stub failure
  run env PATH="$BATS_TEST_TMPDIR/stubs:$PATH" NO_COLOR=1 bash "$SCRIPT" doctor --config event.yaml
  printf '%s' "$output" | grep -qE '^  dvwa +❌ MISSING'
  [ "$status" -ne 0 ]
}

# Fails closed: a fork with no scoring run yet has NOT been verified, and must
# never be reported as granted. VAmPI is in this state in every case above too.
@test "doctor reports an unrun fork as unverified, never as granted" {
  write_gh_grant_stub success
  run env PATH="$BATS_TEST_TMPDIR/stubs:$PATH" NO_COLOR=1 bash "$SCRIPT" doctor --config event.yaml
  printf '%s' "$output" | grep -qE '^  vampi +⚠️  unverified'
  [ -z "$(printf '%s' "$output" | grep -E '^  vampi +✅')" ]
}

# A step that was skipped or cancelled proves nothing about the grant, so it
# must read as unverified rather than as either verdict.
@test "doctor treats a skipped pull step as unverified, not as a verdict" {
  write_gh_grant_stub skipped
  run env PATH="$BATS_TEST_TMPDIR/stubs:$PATH" NO_COLOR=1 bash "$SCRIPT" doctor --config event.yaml
  printf '%s' "$output" | grep -qE '^  dvwa +⚠️  unverified'
}

# An unreachable API is not evidence of a grant. This is the same fail-closed
# rule every check_step follows.
@test "doctor reports unverified when the runs API itself fails" {
  mkdir -p stubs
  cat > stubs/gh <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"packages/container/score"*) echo private ;;
  *) exit 1 ;;
esac
EOF
  chmod +x stubs/gh
  run env PATH="$BATS_TEST_TMPDIR/stubs:$PATH" NO_COLOR=1 bash "$SCRIPT" doctor --config event.yaml
  printf '%s' "$output" | grep -qE '^  dvwa +⚠️  unverified'
  [ -z "$(printf '%s' "$output" | grep -F '✅ granted')" ]
}

# The doctor check and the workflow are coupled by one string: doctor reads
# back the grant by looking for a step named "Pull scorer image" in each
# fork's scoring runs. Renaming the step in the template would silently turn
# every fork's status to "unverified" — a check that quietly stops checking,
# which is worse than no check. Pin the name from both sides.
@test "the rendered workflow's pull step is named exactly what doctor looks for" {
  run bash "$SCRIPT" render --config event.yaml
  [ "$status" -eq 0 ]
  grep -qF -e '- name: Pull scorer image' dist/workflows/dvwa.ctf-score.yml
  grep -qF 'name == "Pull scorer image"' "$BATS_TEST_DIRNAME/../ctf-setup.sh"
}

# The whole point of the separate step: a missing grant must fail in a step
# named for it, not implicitly inside `docker run` where it reads as a
# scoring failure on the contestant's patch.
@test "the rendered workflow pulls the scorer image before running it" {
  run bash "$SCRIPT" render --config event.yaml
  [ "$status" -eq 0 ]
  pull_line="$(grep -n 'docker pull' dist/workflows/dvwa.ctf-score.yml | head -1 | cut -d: -f1)"
  run_line="$(grep -n 'name: Run scorer' dist/workflows/dvwa.ctf-score.yml | head -1 | cut -d: -f1)"
  [ -n "$pull_line" ]
  [ "$pull_line" -lt "$run_line" ]
}

# --- scoring-workflow versioning (issue #43) --------------------------------
#
# The stamp is what makes a fix to ctf-score.yml reachable on an event that is
# already provisioned. Before it, `org` skipped the workflow step as soon as
# the file existed — at any version — so a security fix could only be
# delivered by hand, one fork at a time.

# The template's current version, read from the template rather than pinned
# here. These tests are about the version MECHANISM — a fork matching the
# template reads current, one behind reads stale — not about which number the
# template happens to be on. Hardcoding it turned every security bump of the
# workflow into a test edit.
template_version() {
  sed -n 's/^# ctf-workflow-version: *\([0-9][0-9]*\).*/\1/p' \
    "$BATS_TEST_DIRNAME/../../scorer/consumer-workflow.example.yml" | head -1
}

@test "the template carries a version stamp and rendering preserves it" {
  grep -qE '^# ctf-workflow-version: [0-9]+$' "$BATS_TEST_DIRNAME/../../scorer/consumer-workflow.example.yml"
  run bash "$SCRIPT" render --config event.yaml
  [ "$status" -eq 0 ]
  grep -qE '^# ctf-workflow-version: [0-9]+$' dist/workflows/dvwa.ctf-score.yml
}

@test "upgrade --dry-run plans only the workflow step, never forks or the mirror" {
  v="$(template_version)"
  run bash "$SCRIPT" upgrade --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  [[ "$output" == *"render ctf-score.yml v$v (TARGET=dvwa)"* ]]
  [[ "$output" == *"render ctf-score.yml v$v (TARGET=vampi)"* ]]
  # The whole reason this is its own subcommand rather than "re-run org".
  [ -z "$(printf '%s' "$output" | grep -F 'gh repo fork')" ]
  [ -z "$(printf '%s' "$output" | grep -F 'docker push')" ]
  [ -z "$(printf '%s' "$output" | grep -F 'branch protection')" ]
}

@test "upgrade on a quiz-only event is a no-op, not an error" {
  cat > event.yaml <<'EOF'
github:
  org: test-event-org
modules:
  quiz: {}
EOF
  run bash "$SCRIPT" upgrade --dry-run --config event.yaml
  [ "$status" -eq 0 ]
  [[ "$output" == *"no secure-development module"* ]]
}

# Writes a `gh` stub serving a committed ctf-score.yml whose version marker is
# $1 (or, for the literal string "none", no file at all).
write_gh_workflow_stub() {
  mkdir -p stubs
  cat > stubs/gh <<EOF
#!/usr/bin/env bash
case "\$*" in
  *"contents/.github/workflows/ctf-score.yml"*)
    [ "$1" = none ] && exit 1
    echo "# CTF scoring workflow"
    [ "$1" = unstamped ] || echo "# ctf-workflow-version: $1"
    echo "name: CTF Patch Score"
    ;;
  *"packages/container/score"*) echo private ;;
  *) exit 1 ;;
esac
EOF
  chmod +x stubs/gh
}

@test "doctor reports a fork on the template's version as current" {
  v="$(template_version)"
  write_gh_workflow_stub "$v"
  run env PATH="$BATS_TEST_TMPDIR/stubs:$PATH" NO_COLOR=1 bash "$SCRIPT" doctor --config event.yaml
  [[ "$output" == *"scoring workflow version (template is v$v)"* ]]
  printf '%s' "$output" | grep -qE "^  dvwa +✅ v$v"
}

# The state this whole feature exists for: a live event still running an old
# workflow, with no way to find out.
@test "doctor reports an older fork as stale and names the fix" {
  write_gh_workflow_stub 0
  run env PATH="$BATS_TEST_TMPDIR/stubs:$PATH" NO_COLOR=1 bash "$SCRIPT" doctor --config event.yaml
  printf '%s' "$output" | grep -qE '^  dvwa +❌ pre-versioning'
  [[ "$output" == *"ctf-setup.sh upgrade"* ]]
  [ "$status" -ne 0 ]
}

# Every fork provisioned before this change is in exactly this state: the file
# is there and correct-looking, with no marker at all.
@test "doctor treats a workflow with no marker as stale, not as current" {
  write_gh_workflow_stub unstamped
  run env PATH="$BATS_TEST_TMPDIR/stubs:$PATH" NO_COLOR=1 bash "$SCRIPT" doctor --config event.yaml
  printf '%s' "$output" | grep -qE '^  dvwa +❌ pre-versioning'
  [ -z "$(printf '%s' "$output" | grep -F '✅ v')" ]
}

@test "doctor distinguishes an absent workflow from a stale one" {
  write_gh_workflow_stub none
  run env PATH="$BATS_TEST_TMPDIR/stubs:$PATH" NO_COLOR=1 bash "$SCRIPT" doctor --config event.yaml
  printf '%s' "$output" | grep -qE '^  dvwa +❌ absent'
  [[ "$output" == *"ctf-setup.sh org"* ]]
}

# A fork ahead of this checkout means the kit is behind, not the fork. Never
# clobber it backwards — that would silently REVERT a fix on a live event.
@test "doctor flags a fork ahead of the template without calling it stale" {
  write_gh_workflow_stub 99
  run env PATH="$BATS_TEST_TMPDIR/stubs:$PATH" NO_COLOR=1 bash "$SCRIPT" doctor --config event.yaml
  printf '%s' "$output" | grep -qE '^  dvwa +⚠️  v99'
  [[ "$output" == *"AHEAD"* ]]
  [ -z "$(printf '%s' "$output" | grep -F 'stale')" ]
}

# Fails closed: an unreadable reply must never read as "up to date", or a
# security fix silently skips that fork.
@test "doctor treats an unreadable workflow read as absent, never as current" {
  mkdir -p stubs
  printf '#!/usr/bin/env bash\nexit 1\n' > stubs/gh
  chmod +x stubs/gh
  run env PATH="$BATS_TEST_TMPDIR/stubs:$PATH" NO_COLOR=1 bash "$SCRIPT" doctor --config event.yaml
  printf '%s' "$output" | grep -qE '^  dvwa +❌ absent'
  [ -z "$(printf '%s' "$output" | grep -F '✅ v')" ]
}

# The event URL moved from event.yaml's `event.url` to EVENT_URL in .env
# (ADR 43). ctf-setup renders it into every fork's score-comment footer, so an
# organizer who moved the file but not the value would otherwise lose that link
# on every scored PR with nothing to explain it.

@test "render warns when EVENT_URL is missing rather than dropping the link silently" {
  run bash "$SCRIPT" render --config event.yaml
  [ "$status" -eq 0 ]
  echo "$output" | grep -qF 'EVENT_URL is not set'
}

@test "render puts the leaderboard link in the workflow when EVENT_URL is set" {
  # The counterpart: the warning above must not be the only outcome, or it
  # would pass just as well against a reader that never works.
  printf 'EVENT_URL=https://ctf.example.org\n' > .env
  run bash "$SCRIPT" render --config event.yaml
  [ "$status" -eq 0 ]
  [ -z "$(echo "$output" | grep -F 'EVENT_URL is not set')" ]
  grep -qF 'https://ctf.example.org/leaderboard' dist/workflows/dvwa.ctf-score.yml
}

# The re-run cooldown became an admin setting (issue #46, ADR 46). The Action
# runs inside a contestant's fork and cannot read the event's Redis, so it
# fetches the live value over plain HTTPS and falls back to the baked one.
# These pin the fallback chain: a scoring run must never fail because a config
# lookup did.

@test "the workflow fetches the live cooldown from the event" {
  grep -qF '/api/public/scoring' "$BATS_TEST_DIRNAME/../../scorer/consumer-workflow.example.yml"
}

@test "the workflow still carries a baked cooldown to fall back to" {
  grep -qE '^      COOLDOWN_MINUTES: "[0-9]+"$' "$BATS_TEST_DIRNAME/../../scorer/consumer-workflow.example.yml"
}

@test "the cooldown fetch is wrapped so a failure cannot fail the run" {
  # try/catch AND a timeout: an event that is down or slow must not hold a
  # scoring run open or abort it.
  wf="$BATS_TEST_DIRNAME/../../scorer/consumer-workflow.example.yml"
  grep -qF 'AbortSignal.timeout' "$wf"
  grep -qF 'using the baked default' "$wf"
}

@test "the cooldown fetch derives its host from LEADERBOARD_LINK, not a new placeholder" {
  # One rendered value cannot drift from itself; a second placeholder could be
  # rendered inconsistently with the first.
  grep -qF "process.env.LEADERBOARD_LINK || ''" "$BATS_TEST_DIRNAME/../../scorer/consumer-workflow.example.yml"
}

@test "a non-numeric or negative reply is ignored in favour of the default" {
  grep -qF 'Number.isFinite(live) && live >= 0' "$BATS_TEST_DIRNAME/../../scorer/consumer-workflow.example.yml"
}

@test "the workflow version was bumped for the live-cooldown change" {
  # `ctf-setup upgrade` re-renders a fork only when the stamp is newer than
  # what the fork carries. Changing the template without bumping it means
  # existing forks silently keep the old workflow — here, keeping a cooldown
  # the organizer can no longer change.
  v="$(sed -n 's/^# ctf-workflow-version: *\([0-9][0-9]*\).*/\1/p' \
      "$BATS_TEST_DIRNAME/../../scorer/consumer-workflow.example.yml" | head -1)"
  [ "$v" -ge 3 ]
}
