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
# BASH_SOURCE (not $0) so this also resolves correctly when the script is
# sourced for its helpers (e.g. `CMD=__selftest source ctf-setup.sh`), where
# $0 is the sourcing shell's own name rather than this file's path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
WORKFLOW_TEMPLATE="$SCRIPT_DIR/../scorer/consumer-workflow.example.yml"

PROVENANCE_TSV="$SCRIPT_DIR/targets.tsv"

# target -> provenance column. col: 2=upstream_repo, 3=ref, 4=stock_image.
prov_field() {
  local t="$1" col="$2" line
  line=$(grep -v '^[[:space:]]*#' "$PROVENANCE_TSV" | awk -F'\t' -v t="$t" '$1==t {print; exit}')
  [ -n "$line" ] || { echo "unknown target: $t" >&2; return 1; }
  printf '%s\n' "$line" | cut -f"$col"
}

# The fork's repo name = basename of the upstream repo (owner/Name -> Name).
prov_repo_name() {
  local repo; repo="$(prov_field "$1" 2)" || return 1
  echo "${repo##*/}"
}

# gh api read as a boolean (no output, no failure propagation).
gh_ok() { gh api "$@" >/dev/null 2>&1; }

# A just-created fork isn't instantly queryable — poll briefly.
wait_for_repo() {
  local slug="$1"
  for _ in 1 2 3 4 5; do gh_ok "repos/$slug" && return 0; sleep 2; done
  return 1
}

# Create/update a file on the fork's ctf branch. $1=org/name $2=repo-path
# $3=local-content-file. Idempotent: fetches the existing sha to update in place.
put_contents_ctf() {
  local slug="$1" path="$2" src="$3" b64 sha msg
  b64="$(base64 < "$src" | tr -d '\n')"
  sha="$(gh api "repos/$slug/contents/$path?ref=ctf" --jq '.sha' 2>/dev/null || true)"
  msg="ctf-setup: add $path"
  if [ -n "$sha" ]; then
    gh api -X PUT "repos/$slug/contents/$path" -f "message=$msg" -f "content=$b64" -f "branch=ctf" -f "sha=$sha" >/dev/null
  else
    gh api -X PUT "repos/$slug/contents/$path" -f "message=$msg" -f "content=$b64" -f "branch=ctf" >/dev/null
  fi
}

STEPS="fork ctf-branch drop-old protect workflow disable-inherited pr-template vapp-dockerfile"

plan_step() {
  local id="$1" t="$2" org="$3" name; name="$(prov_repo_name "$t")"
  case "$id" in
    fork) echo "DRY-RUN: gh repo fork $(prov_field "$t" 2) --org $org --fork-name $name --clone=false" ;;
    ctf-branch) echo "DRY-RUN: create refs/heads/ctf on $org/$name from $(prov_field "$t" 2)@$(prov_field "$t" 3); set default_branch=ctf" ;;
    drop-old) echo "DRY-RUN: delete master/main on $org/$name if present and != ctf" ;;
    protect) echo "DRY-RUN: PUT branch protection on $org/$name:ctf (1 approving review, no force-push/deletion)" ;;
    workflow) echo "DRY-RUN: render ctf-score.yml (TARGET=$t) and PUT to $org/$name:.github/workflows/ctf-score.yml on ctf" ;;
    disable-inherited) echo "DRY-RUN: disable every workflow on $org/$name except .github/workflows/ctf-score.yml" ;;
    pr-template) echo "DRY-RUN: PUT setup/PULL_REQUEST_TEMPLATE.md to $org/$name:.github/PULL_REQUEST_TEMPLATE.md on ctf" ;;
    vapp-dockerfile) [ "$t" = vulnerableapp ] && echo "DRY-RUN: PUT setup/vulnerableapp.Dockerfile to $org/$name:Dockerfile on ctf" || true ;;
  esac
}

check_step() {
  local id="$1" t="$2" org="$3" name; name="$(prov_repo_name "$t")"
  case "$id" in
    fork) gh_ok "repos/$org/$name" ;;
    ctf-branch) [ "$(gh api "repos/$org/$name" --jq '.default_branch' 2>/dev/null)" = "ctf" ] ;;
    drop-old) ! gh_ok "repos/$org/$name/branches/master" && ! gh_ok "repos/$org/$name/branches/main" ;;
    protect)
      local n
      n="$(gh api "repos/$org/$name/branches/ctf/protection" \
        --jq '.required_pull_request_reviews.required_approving_review_count // 0' 2>/dev/null)" || n=0
      [ "${n:-0}" -ge 1 ]
      ;;
    workflow) gh_ok "repos/$org/$name/contents/.github/workflows/ctf-score.yml?ref=ctf" ;;
    disable-inherited)
      local others
      others="$(gh api "repos/$org/$name/actions/workflows" \
        --jq '.workflows[] | select(.path != ".github/workflows/ctf-score.yml") | select(.state=="active") | .id' 2>/dev/null)" || return 1
      [ -z "$others" ]
      ;;
    pr-template) gh_ok "repos/$org/$name/contents/.github/PULL_REQUEST_TEMPLATE.md?ref=ctf" ;;
    vapp-dockerfile)
      [ "$t" = vulnerableapp ] || return 0
      gh_ok "repos/$org/$name/contents/Dockerfile?ref=ctf"
      ;;
    *) return 1 ;;
  esac
}

apply_step() {
  local id="$1" t="$2" org="$3" name; name="$(prov_repo_name "$t")"
  case "$id" in
    fork)
      gh repo fork "$(prov_field "$t" 2)" --org "$org" --fork-name "$name" --clone=false
      wait_for_repo "$org/$name" || { echo "fork not queryable yet: $org/$name" >&2; return 1; }
      ;;
    ctf-branch)
      local sha; sha="$(gh api "repos/$(prov_field "$t" 2)/commits/$(prov_field "$t" 3)" --jq '.sha')" \
        || { echo "cannot resolve $(prov_field "$t" 2)@$(prov_field "$t" 3)" >&2; return 1; }
      gh api -X POST "repos/$org/$name/git/refs" -f "ref=refs/heads/ctf" -f "sha=$sha" >/dev/null 2>&1 || true
      gh api -X PATCH "repos/$org/$name" -f "default_branch=ctf" >/dev/null
      ;;
    drop-old)
      local b
      for b in master main; do
        gh_ok "repos/$org/$name/branches/$b" && gh api -X DELETE "repos/$org/$name/git/refs/heads/$b" >/dev/null 2>&1 || true
      done
      ;;
    protect)
      gh api -X PUT "repos/$org/$name/branches/ctf/protection" --input - >/dev/null <<'JSON'
{ "required_status_checks": null, "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "restrictions": null, "allow_force_pushes": false, "allow_deletions": false }
JSON
      ;;
    workflow)
      local base_url lb_url="" tmp
      base_url="$(yaml_url)"; base_url="${base_url%/}"
      case "$base_url" in http://*|https://*) lb_url="$base_url/leaderboard" ;; esac
      tmp="$(mktemp)"
      render_workflow "$org" "$t" "$(app_url_for "$t")" "$lb_url" > "$tmp"
      put_contents_ctf "$org/$name" ".github/workflows/ctf-score.yml" "$tmp" || { rm -f "$tmp"; return 1; }
      rm -f "$tmp"
      ;;
    disable-inherited)
      local id
      for id in $(gh api "repos/$org/$name/actions/workflows" \
        --jq '.workflows[] | select(.path != ".github/workflows/ctf-score.yml") | select(.state=="active") | .id' 2>/dev/null); do
        gh api -X PUT "repos/$org/$name/actions/workflows/$id/disable" >/dev/null 2>&1 || true
      done
      ;;
    pr-template)
      put_contents_ctf "$org/$name" ".github/PULL_REQUEST_TEMPLATE.md" "$SCRIPT_DIR/PULL_REQUEST_TEMPLATE.md"
      ;;
    vapp-dockerfile)
      [ "$t" = vulnerableapp ] || return 0
      put_contents_ctf "$org/$name" "Dockerfile" "$SCRIPT_DIR/vulnerableapp.Dockerfile"
      ;;
  esac
}

do_step() {
  local id="$1" t="$2" org="$3"
  if [ "$DRY_RUN" -eq 1 ]; then plan_step "$id" "$t" "$org"; return; fi
  if check_step "$id" "$t" "$org"; then echo "  ✓ $id ($t): already done"; return; fi
  echo "  → $id ($t)"; apply_step "$id" "$t" "$org"
}

# Read-only per-step status. Non-manual missing steps make it exit non-zero so
# CI / the future admin wizard can gate on a clean provision.
cmd_doctor() {
  require_config
  local org; org="$(yaml_org)"
  [ -n "$org" ] || { echo "event.yaml: github.org missing" >&2; exit 1; }
  local rc=0 t id
  # Guide-only org-level check.
  if gh_ok "orgs/$org"; then echo "✅ org $org exists"; else echo "⚠️  org $org — create it: https://github.com/account/organizations/new"; fi
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    echo "== $t ($org/$(prov_repo_name "$t"))"
    for id in $STEPS; do
      if check_step "$id" "$t" "$org"; then
        echo "  ✅ $id"
      else
        echo "  ❌ $id"; rc=1
      fi
    done
    echo "  ⚠️  fork-network detach — verify: https://github.com/$org/$(prov_repo_name "$t")/settings"
  done < <(yaml_targets)
  echo "  ⚠️  package visibility / Read grant — verify: https://github.com/orgs/$org/packages"
  return $rc
}

DRY_RUN=0
CONFIG=event.yaml
# CMD is read from the env first so `CMD=__selftest source ctf-setup.sh` can
# define the helpers above (and below) without parsing flags or dispatching a
# subcommand — the env var wins so sourcing works regardless of $1, while
# `bash ctf-setup.sh <cmd>` (no CMD env var set) still uses positional $1.
CMD="${CMD:-${1:-}}"

if [ "$CMD" != "__selftest" ]; then
  shift || true

  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) DRY_RUN=1 ;;
      --config) CONFIG="$2"; shift ;;
      --out) OUT="$2"; shift ;;
      *) echo "unknown flag: $1" >&2; exit 2 ;;
    esac
    shift
  done
fi

# Verify config file exists (only for subcommands that need it)
require_config() {
  [ -f "$CONFIG" ] || { echo "config not found: $CONFIG" >&2; exit 1; }
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
    # helpers disable verification and several tests assert on TLS behaviour), so the
    # bring-up sets NODE_TLS_REJECT_UNAUTHORIZED=0 on its own readiness probes only
    # (never exported, or it would reach the judge's authenticated leaderboard POST).
    # Verified against a real boot by `scripts/acceptance-target.sh securityshepherd none`.
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

yaml_url() {
  # event.url — the box URL contestants reach. The only `url:` key in event.yaml.
  sed -n 's/^[[:space:]]*url:[[:space:]]*\([^#]*\).*/\1/p' "$CONFIG" | head -1 | sed 's/[[:space:]]*$//'
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
  local org="$1" target="$2" app_url="$3" leaderboard_url="$4"
  sed -e "s|<EVENT_ORG>|${org}|g" \
      -e "s|<TARGET>|${target}|g" \
      -e "s|<APP_URL>|${app_url}|g" \
      -e "s|<LEADERBOARD_LINK>|${leaderboard_url}|g" \
    "$WORKFLOW_TEMPLATE"
}

# Render one workflow per target into dist/workflows/ (gitignored). Under
# --dry-run nothing is written; the plan is printed instead.
render_workflows() {
  local org="$1"; shift
  [ -f "$WORKFLOW_TEMPLATE" ] || { echo "workflow template missing: $WORKFLOW_TEMPLATE" >&2; exit 1; }
  # Leaderboard URL for the score-comment footer, derived once from event.url
  # (trailing slash stripped). Empty when event.url is unset — the workflow
  # only renders the footer link when the value is a real http(s) URL.
  local base_url lb_url=""
  base_url="$(yaml_url)"
  base_url="${base_url%/}"
  case "$base_url" in http://*|https://*) lb_url="$base_url/leaderboard" ;; esac
  local wfdir="dist/workflows" t app_url dest
  for t in "$@"; do
    app_url="$(app_url_for "$t")" || exit 1
    dest="$wfdir/$t.ctf-score.yml"
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "DRY-RUN: render template (EVENT_ORG=$org TARGET=$t APP_URL=$app_url LEADERBOARD_LINK=${lb_url:-<none>}) -> $dest"
    else
      mkdir -p "$wfdir"
      render_workflow "$org" "$t" "$app_url" "$lb_url" > "$dest"
      echo "   wrote $dest"
    fi
  done
}

# Mirror SCORE_IMAGE into the event org's GHCR, then REFUSE a non-amd64 image
# (GitHub runners are amd64; an arm64-only image fails scoring at run time).
mirror_image() {
  local org="$1" src="$2"
  echo "== mirroring scorer image $src -> ghcr.io/$org/score:latest"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN: docker pull $src && docker tag $src ghcr.io/$org/score:latest && docker push ghcr.io/$org/score:latest"
    echo "DRY-RUN: docker image inspect --format '{{.Architecture}}' $src  # must be amd64"
    return
  fi
  docker pull "$src"
  # Check the pulled image's own config (always has .Architecture, no
  # manifest-list wrapping to unpack) rather than the registry manifest: a
  # plain `docker build` (the documented path in docs/scorer.md) pushes a
  # single-manifest image with no top-level "architecture" field at all —
  # that only appears inside a multi-manifest index's platform entries.
  local arch
  arch="$(docker image inspect --format '{{.Architecture}}' "$src" 2>/dev/null || true)"
  if [ "$arch" != "amd64" ]; then
    echo "ERROR: $src is $arch, not amd64 — GitHub runners need linux/amd64." >&2
    echo "Rebuild + push amd64:  docker buildx build --platform linux/amd64 -t ghcr.io/$org/score:latest --push scorer/" >&2
    return 1
  fi
  docker tag "$src" "ghcr.io/$org/score:latest"
  docker push "ghcr.io/$org/score:latest"
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

  yaml_targets | grep -q . || { echo "event.yaml: no targets under modules.secure-development" >&2; exit 1; }

  echo "== provisioning $org (idempotent — re-run safe)"
  local t
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    echo "== $t -> $org/$(prov_repo_name "$t")"
    local id
    for id in $STEPS; do do_step "$id" "$t" "$org"; done
  done < <(yaml_targets)

  mirror_image "$org" "$src"

  cat <<EOF
== manual steps (GitHub UI, no API) — run 'ctf-setup doctor' to re-check:
   1. Detach each fork from its fork network (repo Settings -> Leave fork network).
   2. Keep package ghcr.io/$org/score PRIVATE; grant each fork Read under
      the package's "Manage Actions access".
   3. Push mode only: org Actions secrets LEADERBOARD_URL + LEADERBOARD_TOKEN.
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
    local r; r="$(prov_repo_name "$t")" || exit 1
    run gh repo archive "$org/$r" --yes
  done < <(yaml_targets)
  echo "== revoke the organizer PAT and delete org secrets manually"
}

if [ "$CMD" != "__selftest" ]; then
  case "$CMD" in
    check) cmd_check ;;
    secrets) cmd_secrets ;;
    org) cmd_org ;;
    render) cmd_render ;;
    teardown) cmd_teardown ;;
    doctor) cmd_doctor ;;
    *) echo "usage: ctf-setup.sh {check|secrets|org|render|teardown|doctor} [--dry-run] [--config event.yaml] [--out .env]" >&2; exit 2 ;;
  esac
fi
