#!/usr/bin/env bats
#
# The modules: reader contract, bash half.
#
# event.yaml's `modules:` block is read by THREE independent parsers in three
# languages with no shared code (setup/ctf-setup.sh, sync/src/config.js,
# apps/web/scripts/generate-event-config.mjs). They must agree on which files
# they ACCEPT and which they REJECT, or an organizer gets a config one half of
# the stack provisions and the other half refuses — which has now happened
# twice, most recently when ctf-setup.sh's 2-space-only reader returned ZERO
# keys for the flow style the docs themselves print, making org/render/doctor
# exit 0 having provisioned nothing.
#
# setup/test/corpus/ holds the shared corpus that pins it down. Each fixture
# records its expected verdict in its FILENAME (accept-*.yaml / reject-*.yaml)
# and, for the accepted ones, the targets both readers must extract in a
# leading `# targets: a,b` comment (empty for a quiz-only event). This file
# runs the corpus through the bash reader; sync/test/module-readers.differential.test.js
# runs the SAME files through sync's. Both assert against the same recorded
# verdicts, so agreeing with the corpus is agreeing with each other.
#
# Add a fixture whenever a new event.yaml shape shows up — that is the whole
# point of a corpus over a handful of hand-written cases.

setup() {
  SCRIPT="$BATS_TEST_DIRNAME/../ctf-setup.sh"
  CORPUS="$BATS_TEST_DIRNAME/corpus"
  cd "$BATS_TEST_TMPDIR"
}

# The bash reader's verdict on a config, via the one subcommand that exercises
# the whole contract (check_known_modules -> has_module -> yaml_targets) with
# no gh/docker/network calls at all: `render`.
bash_verdict() {
  if bash "$SCRIPT" render --config "$1" >/dev/null 2>&1; then echo accept; else echo reject; fi
}

# The `# targets: a,b` header a fixture records (empty when there are none).
want_targets() {
  sed -n 's/^# targets:[[:space:]]*//p' "$1" | head -1 | tr -d '\r' | tr -d ' '
}

got_targets() {
  bash -c 'CMD=__selftest source "$1"; CONFIG="$2"; yaml_targets' _ "$SCRIPT" "$1" 2>/dev/null | tr -d '\r' | paste -sd, - | sed 's/,$//'
}

@test "corpus: is big enough and covers both verdicts" {
  local n a r
  n=$(find "$CORPUS" -name '*.yaml' | wc -l | tr -d ' ')
  a=$(find "$CORPUS" -name 'accept-*.yaml' | wc -l | tr -d ' ')
  r=$(find "$CORPUS" -name 'reject-*.yaml' | wc -l | tr -d ' ')
  echo "corpus: $n fixtures ($a accept, $r reject)"
  [ "$n" -ge 30 ] && [ "$a" -ge 12 ] && [ "$r" -ge 12 ]
}

@test "corpus: every fixture's filename records only a verdict this file understands" {
  local f bad=""
  for f in "$CORPUS"/*.yaml; do
    case "$(basename "$f")" in
      accept-*|reject-*) ;;
      *) bad="$bad $(basename "$f")" ;;
    esac
  done
  echo "unclassified:$bad"
  [ -z "$bad" ]
}

@test "corpus: the bash reader's verdict matches every fixture's recorded verdict" {
  local f want got fails=""
  for f in "$CORPUS"/*.yaml; do
    case "$(basename "$f")" in accept-*) want=accept ;; *) want=reject ;; esac
    got="$(bash_verdict "$f")"
    if [ "$got" != "$want" ]; then fails="$fails
  $(basename "$f"): want $want, got $got"; fi
  done
  echo "mismatches:$fails"
  [ -z "$fails" ]
}

@test "corpus: the bash reader extracts each accepted fixture's recorded targets" {
  local f want got fails=""
  for f in "$CORPUS"/accept-*.yaml; do
    want="$(want_targets "$f")"
    got="$(got_targets "$f")"
    if [ "$got" != "$want" ]; then fails="$fails
  $(basename "$f"): want [$want], got [$got]"; fi
  done
  echo "mismatches:$fails"
  [ -z "$fails" ]
}

# --------------------------------------------------------------------------
# The specific regressions the corpus exists to prevent — asserted on the
# organizer-visible behaviour, not just on the parser's output.
# --------------------------------------------------------------------------

@test "flow-style modules: really provisions (not a silent 'nothing to do')" {
  run env SCORE_IMAGE=ghcr.io/myorg/score:v1 bash "$SCRIPT" org --dry-run \
    --config "$CORPUS/accept-flow-one-line.yaml"
  [ "$status" -eq 0 ]
  [ -z "$(printf '%s' "$output" | grep -F 'nothing to do')" ]
  printf '%s' "$output" | grep -qF 'gh repo fork digininja/DVWA --org test-event-org'
}

@test "flow-style modules: renders the scoring workflow it used to skip" {
  run bash "$SCRIPT" render --config "$CORPUS/accept-flow-one-line.yaml"
  [ "$status" -eq 0 ]
  [ -f dist/workflows/dvwa.ctf-score.yml ]
  grep -q "TARGET: dvwa" dist/workflows/dvwa.ctf-score.yml
}

@test "4-space block indentation provisions the same as 2-space" {
  run env SCORE_IMAGE=ghcr.io/myorg/score:v1 bash "$SCRIPT" org --dry-run \
    --config "$CORPUS/accept-block-4-space.yaml"
  [ "$status" -eq 0 ]
  printf '%s' "$output" | grep -qF 'gh repo fork digininja/DVWA --org test-event-org'
}

@test "an unparseable modules: block fails CLOSED in org (never 'nothing to do')" {
  run env SCORE_IMAGE=ghcr.io/myorg/score:v1 bash "$SCRIPT" org --dry-run \
    --config "$CORPUS/reject-tab-indentation.yaml"
  [ "$status" -ne 0 ]
  [ -z "$(printf '%s' "$output" | grep -F 'nothing to do')" ]
  printf '%s' "$output" | grep -qF 'tab indentation'
}

@test "an unparseable modules: block fails CLOSED in doctor (never 'nothing to check')" {
  run bash "$SCRIPT" doctor --config "$CORPUS/reject-tab-indentation.yaml"
  [ "$status" -ne 0 ]
  [ -z "$(printf '%s' "$output" | grep -F 'no provisioned content')" ]
  printf '%s' "$output" | grep -qF 'tab indentation'
}

@test "doctor fails when secure-development is enabled but has no readable targets" {
  run bash "$SCRIPT" doctor --config "$CORPUS/reject-secure-development-without-targets.yaml"
  [ "$status" -ne 0 ]
  printf '%s' "$output" | grep -qF 'no targets under modules.secure-development'
}

@test "a bare modules: key is rejected, not read as a quiz-only event" {
  run bash "$SCRIPT" render --config "$CORPUS/reject-bare-modules-key.yaml"
  [ "$status" -ne 0 ]
  [ -z "$(printf '%s' "$output" | grep -F 'nothing to render')" ]
  printf '%s' "$output" | grep -qF 'no module keys'
}

@test "a duplicate module key fails CLOSED in org (the JS readers throw on it)" {
  run env SCORE_IMAGE=ghcr.io/myorg/score:v1 bash "$SCRIPT" org --dry-run \
    --config "$CORPUS/reject-duplicate-module-key-with-targets.yaml"
  [ "$status" -ne 0 ]
  [ -z "$(printf '%s' "$output" | grep -F 'nothing to do')" ]
  [ -z "$(printf '%s' "$output" | grep -F 'gh repo fork')" ]
  printf '%s' "$output" | grep -qF 'duplicate key: secure-development'
}

@test "a second top-level modules: block is rejected, not read as the end of the first" {
  run bash "$SCRIPT" render --config "$CORPUS/reject-duplicate-modules-block.yaml"
  [ "$status" -ne 0 ]
  [ -z "$(printf '%s' "$output" | grep -F 'nothing to render')" ]
  printf '%s' "$output" | grep -qF 'more than one top-level modules: key'
}

# --------------------------------------------------------------------------
# The wizard emits event.yaml for people who never open one. Whatever it can
# write therefore has to satisfy the same three readers as a hand-written file
# — so its output IS corpus, kept honest by regenerating it here and diffing
# against the committed fixtures (which both differential tests then run
# through both readers). The `# targets:` header is corpus bookkeeping, not
# something the wizard writes, so it is stripped before the comparison.
# --------------------------------------------------------------------------

wiz_emit() {
  bash -c 'CMD=__selftest source "$1"; shift; wiz_event_yaml "$@"' _ "$SCRIPT" "$@"
}

WIZ_DATES='  start: 2026-10-01T09:00:00-03:00
  end: 2026-10-01T18:00:00-03:00
'

@test "corpus: the wizard still emits exactly the secure-development-only fixture" {
  wiz_emit "OWASP Chapter CTF" "$WIZ_DATES" my-event-org \
    "secure-development" "juice-shop dvwa" poll "your-github-login" > got.yaml
  sed '/^# targets:/d' "$CORPUS/accept-wizard-secure-development-only.yaml" > want.yaml
  diff -u want.yaml got.yaml
}

@test "corpus: the wizard still emits exactly the quiz-only fixture" {
  wiz_emit "OWASP Chapter Quiz Night" "" my-event-org \
    "quiz" "" poll "your-github-login" > got.yaml
  sed '/^# targets:/d' "$CORPUS/accept-wizard-quiz-only.yaml" > want.yaml
  diff -u want.yaml got.yaml
}

@test "corpus: the wizard still emits exactly the classic-only fixture" {
  wiz_emit "OWASP Chapter Classic CTF" "" my-event-org \
    "classic" "" poll "your-github-login" > got.yaml
  sed '/^# targets:/d' "$CORPUS/accept-wizard-classic-only.yaml" > want.yaml
  diff -u want.yaml got.yaml
}

@test "corpus: the wizard still emits exactly the ai-only fixture" {
  # An id in KNOWN_MODULES is OFFERED by the wizard and accepted by
  # wiz_modules, but it is wiz_event_yaml that has to be able to WRITE it. The
  # three tests above cover the other modules and every other wizard test runs
  # --dry-run, which returns before the emitter — so `ai` was offered and then
  # hard-failed at the write step with the organizer's answers already given.
  # This is the test that closes that gap for good.
  wiz_emit "OWASP Chapter AI Night" "" my-event-org \
    "ai" "" poll "your-github-login" > got.yaml
  sed '/^# targets:/d' "$CORPUS/accept-wizard-ai-only.yaml" > want.yaml
  diff -u want.yaml got.yaml
}

@test "corpus: the wizard still emits exactly the both-modules fixture" {
  wiz_emit "OWASP Chapter CTF" "$WIZ_DATES" my-event-org \
    "secure-development quiz" "juice-shop, dvwa" push "your-github-login alice" > got.yaml
  sed '/^# targets:/d' "$CORPUS/accept-wizard-both-modules.yaml" > want.yaml
  diff -u want.yaml got.yaml
}

@test "corpus: a quiz-only wizard config carries no secure-development block at all" {
  # Not just "no targets": the module's key must be absent, because presence
  # IS enablement — a `secure-development: {}` left behind would turn its nav,
  # challenge browser and leaderboard columns back on for an event with no
  # forks to score.
  [ -z "$(grep -F secure-development "$CORPUS/accept-wizard-quiz-only.yaml")" ]
}

@test "the shipped event.yaml.example is accepted by the bash reader" {
  run bash "$SCRIPT" render --config "$BATS_TEST_DIRNAME/../../event.yaml.example"
  [ "$status" -eq 0 ]
  [ -f dist/workflows/juice-shop.ctf-score.yml ]
  [ -f dist/workflows/dvwa.ctf-score.yml ]
}
