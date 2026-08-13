#!/usr/bin/env bash
# ctf-setup — provision a disposable GitHub org for a self-hosted OWASP CTF event.
#
# Subcommands:
#   check     verify local prerequisites (gh auth, docker, compose)
#   secrets   generate .env secret values
#   org       fork targets, fetch scoring workflow + print install steps, mirror scorer image
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

# Verify config file exists (only for subcommands that need it)
require_config() {
  [ -f "$CONFIG" ] || { echo "config not found: $CONFIG" >&2; exit 1; }
}

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

# YAML extraction with comment stripping and flow-style support.
# org: extracts from both block-style (org: value) and flow-style (github: { org: value })
# targets: extracts flow-style list scoped to modules.secure-development block
yaml_org() {
  # Try block-style: org: value [# comment]
  local org
  org=$(sed -n 's/^[[:space:]]*org:[[:space:]]*\([^#]*\).*/\1/p' "$CONFIG" | head -1 | sed 's/[[:space:]]*$//')
  [ -n "$org" ] && { echo "$org"; return; }
  # Try flow-style: { org: value [, ...] }
  org=$(sed -n 's/.*{[^}]*org:[[:space:]]*\([^},]*\).*/\1/p' "$CONFIG" | head -1 | sed 's/[[:space:]]*$//')
  echo "$org"
}

yaml_targets() {
  # Extract targets from modules.secure-development block only (awk range from
  # secure-development: to next line at equal-or-lower indent), then parse flow-style list.
  awk '/^[[:space:]]*secure-development:/{flag=1; next} flag && /^[[:space:]]{0,2}[^[:space:]]/{flag=0} flag' "$CONFIG" | \
    sed -n 's/^[[:space:]]*targets:[[:space:]]*\[\(.*\)\].*/\1/p' | head -1 | tr -d ' ' | tr ',' '\n'
}

run() {
  if [ "$DRY_RUN" -eq 1 ]; then echo "DRY-RUN: $*"; else "$@"; fi
}

cmd_check() {
  command -v gh >/dev/null || { echo "gh CLI missing: https://cli.github.com"; exit 1; }
  command -v docker >/dev/null || { echo "docker missing"; exit 1; }
  command -v openssl >/dev/null || { echo "openssl missing"; exit 1; }
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
  require_config
  local org; org="$(yaml_org)"
  [ -n "$org" ] || { echo "event.yaml: github.org missing" >&2; exit 1; }
  local targets_arr=() repos=()
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    targets_arr+=("$t")
    repos+=("$(repo_for "$t")")
  done < <(yaml_targets)
  [ ${#repos[@]} -gt 0 ] || { echo "event.yaml: no targets" >&2; exit 1; }

  echo "== forking targets into $org"
  for r in "${repos[@]}"; do
    run gh repo fork "OWASP-CTF/$r" --org "$org" --clone=false
  done

  echo "== installing scoring workflow (fetched from upstream consumer docs)"
  for i in "${!repos[@]}"; do
    local t="${targets_arr[$i]}" r="${repos[$i]}"
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
  require_config
  local org; org="$(yaml_org)"
  [ -n "$org" ] || { echo "event.yaml: github.org missing" >&2; exit 1; }
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    local r; r="$(repo_for "$t")" || exit 1
    run gh repo archive "$org/$r" --yes
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
