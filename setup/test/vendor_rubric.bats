#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

@test "vendor-rubric.sh refuses an unknown target" {
  run "$REPO_ROOT/scripts/vendor-rubric.sh" --target nope --dry-run
  [ "$status" -ne 0 ]
  [[ "$output" == *"unknown target: nope"* ]]
}

@test "vendor-rubric.sh has no push path to the read-only upstream" {
  run grep -nE '\b(git[[:space:]]+push|gh[[:space:]]+pr[[:space:]]+create)\b' "$REPO_ROOT/scripts/vendor-rubric.sh"
  [ "$status" -ne 0 ]
}

@test "vendored vampi rubric carries a catalogue and its test files" {
  cat="$REPO_ROOT/scorer/rubric.owasp/vampi/tests/challenges/catalogue.vampi.json"
  [ -f "$cat" ]
  [ -f "$REPO_ROOT/scorer/rubric.owasp/vampi/tests/helpers.js" ]
  run node -e "
    const fs=require('fs'),path=require('path');
    const dir=path.dirname('$cat');
    const c=JSON.parse(fs.readFileSync('$cat','utf8'));
    if(c.length!==9) { console.error('expected 9 challenges, got '+c.length); process.exit(1); }
    for(const e of c) if(!fs.existsSync(path.join(dir,e.file))) { console.error('missing '+e.file); process.exit(1); }
  "
  [ "$status" -eq 0 ]
}

@test "PROVENANCE.md pins the upstream commit" {
  # The backticks are NOT escaped: single quotes already pass them through
  # literally, and a backslash-backtick reaching grep is the GNU ERE
  # start-of-buffer anchor (`\``), which can never match here — GNU grep failed
  # this test while BSD grep, which reads the same bytes as a literal backtick,
  # passed it. POSIX ERE has no escape for a backtick; don't add one back.
  run grep -qE '^- Upstream commit: `[0-9a-f]{40}`$' "$REPO_ROOT/scorer/rubric.owasp/PROVENANCE.md"
  [ "$status" -eq 0 ]
}
