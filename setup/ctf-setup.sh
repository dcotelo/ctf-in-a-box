#!/usr/bin/env bash
# ctf-setup — provision a disposable GitHub org for a self-hosted OWASP CTF event.
#
# Subcommands:
#   check     verify local prerequisites (gh auth, docker, compose)
#   secrets   generate .env secret values
#   org       fork targets, install scoring workflow, mirror scorer image, print grant steps
#   teardown  archive event repos after the event
#
# Global flags: --dry-run (print mutating commands), --config <path> (default event.yaml)
set -euo pipefail

DRY_RUN=0
CONFIG=event.yaml
CMD="${1:-}"; shift || true

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --config) CONFIG="$2"; shift ;;
    --out) OUT="$2"; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

# target key -> upstream repo name
repo_for() {
  case "$1" in
    juice-shop) echo juice-shop ;;
    dvwa) echo DVWA ;;
    webgoat) echo WebGoat ;;
    securityshepherd) echo SecurityShepherd ;;
    vulnerableapp) echo VulnerableApp ;;
    vampi) echo VAmPI ;;
    *) echo "unknown target: $1" >&2; return 1 ;;
  esac
}

# Minimal YAML extraction — grep/sed on two known lines (org, and the
# flow-style targets list under modules.secure-development at any indent);
# the sync service re-validates the same file with a real parser at runtime.
yaml_org() { sed -n 's/^[[:space:]]*org:[[:space:]]*//p' "$CONFIG" | head -1; }
yaml_targets() {
  sed -n 's/^[[:space:]]*targets:[[:space:]]*\[\(.*\)\].*/\1/p' "$CONFIG" | head -1 | tr -d ' ' | tr ',' '\n'
}

run() {
  if [ "$DRY_RUN" -eq 1 ]; then echo "DRY-RUN: $*"; else "$@"; fi
}

cmd_check() {
  command -v gh >/dev/null || { echo "gh CLI missing: https://cli.github.com"; exit 1; }
  command -v docker >/dev/null || { echo "docker missing"; exit 1; }
  docker compose version >/dev/null || { echo "docker compose v2 missing"; exit 1; }
  gh auth status || { echo "run: gh auth login"; exit 1; }
  echo "OK: prerequisites present"
}

cmd_secrets() {
  local out="${OUT:-.env}"
  [ -f "$out" ] && { echo "$out exists; refusing to overwrite" >&2; exit 1; }
  {
    echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32 | tr -d '\n')"
    echo "SRH_TOKEN=$(openssl rand -hex 24)"
    echo "SCORER_TOKEN=$(openssl rand -hex 24)"
    echo "GITHUB_CLIENT_ID="
    echo "GITHUB_CLIENT_SECRET="
    echo "GITHUB_PAT="
    echo "EVENT_URL=http://localhost"
    echo "SCORE_INGEST=poll"
    echo "SCORE_IMAGE=ghcr.io/owasp-ctf/score:latest"
  } > "$out"
  echo "wrote $out — fill in GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_PAT"
}

cmd_org() {
  local org; org="$(yaml_org)"
  [ -n "$org" ] || { echo "event.yaml: github.org missing" >&2; exit 1; }
  local repos=()
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    repos+=("$(repo_for "$t")")
  done < <(yaml_targets)
  [ ${#repos[@]} -gt 0 ] || { echo "event.yaml: no targets" >&2; exit 1; }

  echo "== forking targets into $org"
  for r in "${repos[@]}"; do
    run gh repo fork "OWASP-CTF/$r" --org "$org" --clone=false
  done

  echo "== installing scoring workflow (fetched from dc34 consumer docs)"
  for i in "${!repos[@]}"; do
    local t r
    t="$(yaml_targets | sed -n "$((i + 1))p")"; r="${repos[$i]}"
    run gh api "repos/OWASP-CTF/dc34-owasp-secure-development-ctf/contents/docs/${t}-consumer/pull_request_target.yml" \
      --jq .content
    echo "   -> decode + commit as .github/workflows/ctf-score.yml in $org/$r (disable inherited workflows in repo Settings > Actions)"
  done

  echo "== mirroring scorer image into $org (needs read access to ghcr.io/owasp-ctf/score)"
  run docker pull ghcr.io/owasp-ctf/score:latest
  run docker tag ghcr.io/owasp-ctf/score:latest "ghcr.io/$org/score:latest"
  run docker push "ghcr.io/$org/score:latest"

  cat <<EOF
== manual steps (GitHub UI, no API):
   1. Keep package ghcr.io/$org/score PRIVATE.
   2. Package settings -> Manage Actions access -> add each target repo with Read.
   3. If push mode: org Settings -> Actions secrets -> LEADERBOARD_URL + LEADERBOARD_TOKEN.
EOF
}

cmd_teardown() {
  local org; org="$(yaml_org)"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    run gh repo archive "$org/$(repo_for "$t")" --yes
  done < <(yaml_targets)
  echo "== revoke the organizer PAT and delete org secrets manually"
}

case "$CMD" in
  check) cmd_check ;;
  secrets) cmd_secrets ;;
  org) cmd_org ;;
  teardown) cmd_teardown ;;
  *) echo "usage: ctf-setup.sh {check|secrets|org|teardown} [--dry-run] [--config event.yaml] [--out .env]" >&2; exit 2 ;;
esac
