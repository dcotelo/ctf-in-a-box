#!/usr/bin/env bash
# ctf-setup — provision a disposable GitHub org for a self-hosted OWASP CTF event.
#
# Subcommands:
#   check     verify local prerequisites (gh auth, docker, compose)
#   secrets   generate .env secret values
#   org       fork targets, render scoring workflows from the in-repo template
#             + print install steps, mirror scorer image
#   render    (re)render just the per-target scoring workflows into dist/workflows/
#   teardown  archive event repos after the event
#
# Global flags: --dry-run (print mutating commands), --config <path> (default event.yaml)
set -euo pipefail

# Resolve repo-relative paths from the script's own location, not the cwd.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOW_TEMPLATE="$SCRIPT_DIR/../scorer/consumer-workflow.example.yml"

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

# target key -> default APP_URL for the rendered workflow. Targets self-boot as
# sibling containers on the ctf network, reachable by target name; the ports
# are the targets' STOCK ports — verify each one against your rubric's boot
# strategy (docs/scorer.md, "Booting hard targets") before the event.
#
# scripts/acceptance-target.sh carries its own per-target scheme + URL-suffix
# table (an APP_SCHEME / APP_URL_SUFFIX case) for the same reason — the two are
# intentionally separate (no derivation, no sourcing this script from the gate)
# — a new target's URL needs an entry in BOTH.
app_url_for() {
  case "$1" in
    juice-shop) echo "http://juice-shop:3000" ;;
    dvwa) echo "http://dvwa:80" ;;
    webgoat) echo "http://webgoat:8080/WebGoat" ;;
    # The only HTTPS target: its bring-up builds Security Shepherd from pinned
    # upstream source and Tomcat's TLS connector listens on 8443. The certificate
    # is self-signed and expired in 2019 — deliberately not re-issued (the rubric's
    # helpers disable verification and several tests assert on TLS behaviour), so
    # the bring-up exports NODE_TLS_REJECT_UNAUTHORIZED=0 instead. Verified against
    # a real boot by `scripts/acceptance-target.sh securityshepherd none`.
    securityshepherd) echo "https://securityshepherd:8443" ;;
    vulnerableapp) echo "http://vulnerableapp:9090/VulnerableApp" ;;
    vampi) echo "http://vampi:5000" ;;
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

# Substitute the three placeholders documented at the top of the workflow
# template. Rendered locally from this repo's own template — no upstream fetch.
render_workflow() {
  local org="$1" target="$2" app_url="$3"
  sed -e "s|<EVENT_ORG>|${org}|g" \
      -e "s|<TARGET>|${target}|g" \
      -e "s|<APP_URL>|${app_url}|g" \
    "$WORKFLOW_TEMPLATE"
}

# Render one workflow per target into dist/workflows/ (gitignored). Under
# --dry-run nothing is written; the plan is printed instead.
render_workflows() {
  local org="$1"; shift
  [ -f "$WORKFLOW_TEMPLATE" ] || { echo "workflow template missing: $WORKFLOW_TEMPLATE" >&2; exit 1; }
  local wfdir="dist/workflows" t app_url dest
  for t in "$@"; do
    app_url="$(app_url_for "$t")" || exit 1
    dest="$wfdir/$t.ctf-score.yml"
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "DRY-RUN: render template (EVENT_ORG=$org TARGET=$t APP_URL=$app_url) -> $dest"
    else
      mkdir -p "$wfdir"
      render_workflow "$org" "$t" "$app_url" > "$dest"
      echo "   wrote $dest"
    fi
  done
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
    echo "# SCORE_IMAGE: your own scorer image, built from scorer/ (docs/scorer.md),"
    echo "# e.g. ghcr.io/<your-event-org>/score:latest. No default — the upstream"
    echo "# image is private and the kit does not assume access to it."
    echo "SCORE_IMAGE="
  } > "$out"
  echo "wrote $out — fill in GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_PAT, SCORE_IMAGE"
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

  # Scorer source image: SCORE_IMAGE env var, else .env. Deliberately NO
  # upstream default — the kit assumes zero upstream access: build your own
  # image from scorer/ (docs/scorer.md) and point SCORE_IMAGE at it. Resolved
  # up front so a missing image fails before any forks are created.
  local src="${SCORE_IMAGE:-}"
  if [ -z "$src" ] && [ -f .env ]; then
    src="$(sed -n 's/^SCORE_IMAGE=//p' .env | tail -1)"
  fi
  [ -n "$src" ] || {
    echo "SCORE_IMAGE not set: build your own scorer image (see docs/scorer.md) and set SCORE_IMAGE in .env or the environment" >&2
    exit 1
  }

  echo "== forking targets into $org"
  for r in "${repos[@]}"; do
    run gh repo fork "OWASP-CTF/$r" --org "$org" --clone=false
  done

  echo "== rendering scoring workflows from the in-repo template (scorer/consumer-workflow.example.yml — no upstream access)"
  render_workflows "$org" "${targets_arr[@]}"
  for i in "${!repos[@]}"; do
    echo "   -> commit dist/workflows/${targets_arr[$i]}.ctf-score.yml as .github/workflows/ctf-score.yml in $org/${repos[$i]} (disable inherited workflows in repo Settings > Actions)"
  done

  echo "== mirroring scorer image $src into $org (needs pull access to it)"
  run docker pull "$src"
  run docker tag "$src" "ghcr.io/$org/score:latest"
  run docker push "ghcr.io/$org/score:latest"

  cat <<EOF
== manual steps (GitHub UI, no API):
   1. Keep package ghcr.io/$org/score PRIVATE.
   2. Package settings -> Manage Actions access -> add each target repo with Read.
   3. If push mode: org Settings -> Actions secrets -> LEADERBOARD_URL + LEADERBOARD_TOKEN.
EOF
}

# Just the workflow-render step of cmd_org — for re-rendering after an
# event.yaml edit without re-running forks or the image mirror.
cmd_render() {
  require_config
  local org; org="$(yaml_org)"
  [ -n "$org" ] || { echo "event.yaml: github.org missing" >&2; exit 1; }
  local targets_arr=()
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    targets_arr+=("$t")
  done < <(yaml_targets)
  [ ${#targets_arr[@]} -gt 0 ] || { echo "event.yaml: no targets" >&2; exit 1; }
  render_workflows "$org" "${targets_arr[@]}"
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
  render) cmd_render ;;
  teardown) cmd_teardown ;;
  *) echo "usage: ctf-setup.sh {check|secrets|org|render|teardown} [--dry-run] [--config event.yaml] [--out .env]" >&2; exit 2 ;;
esac
