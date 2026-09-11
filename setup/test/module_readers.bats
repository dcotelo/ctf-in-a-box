#!/usr/bin/env bats
#
# The modules: reader contract, bash half.
#
# event.yaml's `modules:` block is read by THREE independent parsers in three
# languages with no shared code (setup/ctf-setup.sh, sync/src/config.js,
# apps/web/scripts/generate-event-config.mjs). They must agree on which
# MODULE KEYS a file declares that they ACCEPT and which they REJECT, or an
# organizer gets a config one half of the stack provisions and the other half
# refuses — which has now happened twice, most recently when ctf-setup.sh's
# 2-space-only reader returned ZERO keys for the flow style the docs
# themselves print, making org/render/doctor exit 0 having provisioned
# nothing.
#
# setup/test/corpus/ holds the shared corpus that pins module-key accept/
# reject down. Each fixture records its expected verdict in its FILENAME
# (accept-*.yaml / reject-*.yaml). This file runs the corpus through the bash
# reader; apps/web/scripts/__tests__/generate-event-config.test.ts runs the
# SAME files through the app's reader (its own corpus differential suite, with
# a documented KNOWN_DIVERGENCES set for the one remaining, unrelated ADR 24
# edge — a present-but-empty `modules: {}`). There is no longer a sync-side
# differential suite over this corpus (config v2 PR2, #386):
# sync/test/module-readers.differential.test.js was deleted once
# sync/src/config.js stopped reading targets at all (see below) — sync's
# module-KEY accept/reject rules are unchanged and still agree with this
# reader and the app's.
#
# Targets used to be a second axis this file pinned (a leading `# targets:
# a,b` comment on each accepted fixture, extracted via a since-removed
# yaml_targets()). Config v2 PR2 removed target extraction from this reader
# entirely: every event forks all six targets.tsv targets regardless of what
# (if anything) `targets:` says (see all_targets() in ctf-setup.sh), so a
# `targets:` key — absent, empty, a scalar, an unknown id, anything — is now
# tolerated and simply never looked at. `sync/src/config.js` and
# apps/web/scripts/generate-event-config.mjs made the same change (Task 7),
# so the four fixtures this affected were renamed from reject-* to accept-*:
# all three readers agree on them again, with no divergence left to document.
#
# Add a fixture whenever a new event.yaml shape shows up — that is the whole
# point of a corpus over a handful of hand-written cases.

setup() {
  SCRIPT="$BATS_TEST_DIRNAME/../ctf-setup.sh"
  CORPUS="$BATS_TEST_DIRNAME/corpus"
  cd "$BATS_TEST_TMPDIR"
}

# The bash reader's verdict on a config, via the one subcommand that exercises
# the whole contract (check_known_modules -> has_module) with no
# gh/docker/network calls at all: `render`.
bash_verdict() {
  if bash "$SCRIPT" render --config "$1" >/dev/null 2>&1; then echo accept; else echo reject; fi
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

@test "doctor no longer refuses secure-development with no targets: key — it checks all six" {
  # Config v2 PR2 (#386): a targets: key is not read or validated at all any
  # more, so its absence never refuses the run — doctor reaches the per-target
  # matrix and checks all six targets.tsv rows regardless.
  run bash "$SCRIPT" doctor --config "$CORPUS/accept-secure-development-without-targets.yaml"
  [ -z "$(printf '%s' "$output" | grep -F 'no targets under modules.secure-development')" ]
  printf '%s' "$output" | grep -qE '^dvwa '
  printf '%s' "$output" | grep -qE '^juice-shop '
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
# against the committed fixtures (which the app's own corpus differential
# suite then runs through its reader too). The `# targets:` header, where a
# fixture still carries one, is corpus bookkeeping the wizard never writes,
# so it is stripped before the comparison; wiz_event_yaml itself no longer
# takes or emits a targets list at all (config v2 PR2, #386), so the
# secure-development fixtures below carry none any more, in the header or
# the body.
# --------------------------------------------------------------------------

wiz_emit() {
  bash -c 'CMD=__selftest source "$1"; shift; wiz_event_yaml "$@"' _ "$SCRIPT" "$@"
}

WIZ_DATES='  start: 2026-10-01T09:00:00-03:00
  end: 2026-10-01T18:00:00-03:00
'

@test "corpus: the wizard still emits exactly the secure-development-only fixture" {
  wiz_emit "OWASP CTF" "$WIZ_DATES" my-event-org \
    "secure-development" poll "your-github-login" > got.yaml
  sed '/^# targets:/d' "$CORPUS/accept-wizard-secure-development-only.yaml" > want.yaml
  diff -u want.yaml got.yaml
}

@test "corpus: the wizard still emits exactly the quiz-only fixture" {
  wiz_emit "OWASP Chapter Quiz Night" "" my-event-org \
    "quiz" poll "your-github-login" > got.yaml
  sed '/^# targets:/d' "$CORPUS/accept-wizard-quiz-only.yaml" > want.yaml
  diff -u want.yaml got.yaml
}

@test "corpus: the wizard still emits exactly the classic-only fixture" {
  wiz_emit "OWASP Chapter Classic CTF" "" my-event-org \
    "classic" poll "your-github-login" > got.yaml
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
    "ai" poll "your-github-login" > got.yaml
  sed '/^# targets:/d' "$CORPUS/accept-wizard-ai-only.yaml" > want.yaml
  diff -u want.yaml got.yaml
}

@test "corpus: the wizard still emits exactly the both-modules fixture" {
  wiz_emit "OWASP CTF" "$WIZ_DATES" my-event-org \
    "secure-development quiz" push "your-github-login alice" > got.yaml
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
