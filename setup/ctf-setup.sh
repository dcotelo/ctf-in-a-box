#!/usr/bin/env bash
# ctf-setup — provision a disposable GitHub org for a self-hosted OWASP CTF event.
#
# Subcommands (run with NO subcommand, or `wizard`, for the guided setup):
#   wizard    DEFAULT — step-by-step zero-to-scored: inspects state and only
#             prompts for what's missing. Asks for each value inline (EVENT_URL,
#             event.yaml fields, App/OAuth credentials) with instructions + URLs,
#             writing them as you go — no editing files by hand between steps.
#             Guides + verifies each UI-only step. Resumable (safe to re-run).
#             Orchestrates the subcommands below.
#   check     verify local prerequisites (gh auth, docker, compose)
#   secrets   generate .env secret values
#   org       fork targets, render scoring workflows from the in-repo template
#             + print install steps, mirror scorer image
#             (idempotent/re-runnable: every step is skipped once its
#             target state is already satisfied, so re-running `org` after
#             a partial run or failure just resumes where it left off)
#   render    (re)render just the per-target scoring workflows into dist/workflows/
#   teardown  archive event repos after the event
#   doctor    read-only status check: verify a previously-provisioned org
#             matches targets.tsv (no mutation, no --dry-run needed)
#   app-manifest  open a self-submitting form to create the sync GitHub App
#                 from sync/app-manifest.json against the event org (removes
#                 the manual JSON copy-paste; you still click Create/Install)
#   app-config    ingest a downloaded App private key (.pem) + App ID into
#                 .env (--app-id N --pem path [--installation-id N])
#   oauth-app     open GitHub's new-OAuth-App page for the event org and print
#                 the exact field values (signin auth; UI-only, no auto-fill)
#   oauth-config  write the OAuth client id + secret into .env (--client-id ID;
#                 the secret is read from a hidden prompt, never on argv)
#
# Global flags: --dry-run (print mutating commands), --config <path> (default event.yaml)
set -euo pipefail

# Resolve repo-relative paths from the script's own location, not the cwd.
# BASH_SOURCE (not $0) so this also resolves correctly when the script is
# sourced for its helpers (e.g. `CMD=__selftest source ctf-setup.sh`), where
# $0 is the sourcing shell's own name rather than this file's path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
WORKFLOW_TEMPLATE="$SCRIPT_DIR/../scorer/consumer-workflow.example.yml"

# ANSI colors — only when stdout is a TTY and NO_COLOR is unset (respect the
# NO_COLOR convention + non-interactive/piped output stays plain for logs/CI).
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
  C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
else
  C_RESET=; C_BOLD=; C_CYAN=; C_GREEN=; C_YELLOW=
fi

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

# GitHub indexes a fresh fork's Actions workflows ASYNCHRONOUSLY, so a read
# right after forking can return a partial (or empty) list — which made
# disable-inherited vacuously report "already done" while inherited workflows
# (ci/lock/stale/pr-compliance — the ones that auto-close contestant PRs) were
# still landing, active. Wait until the workflow count is stable across two
# reads. Best-effort + bounded; aborts immediately if the API errors (the
# caller's own `|| return 1` then decides), so it never sleeps in that case.
wait_workflows_settled() {
  local slug="$1" prev="" cur _
  for _ in 1 2 3 4 5 6; do
    cur="$(gh api "repos/$slug/actions/workflows" --jq '.total_count' 2>/dev/null)" || return 0
    if [ "$cur" = "$prev" ]; then return 0; fi
    prev="$cur"; sleep 5
  done
  return 0
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

# Read-only verifiers for the two UI-only steps. GitHub exposes no API to
# PERFORM them (leaving a fork network / setting package visibility are
# UI-only), but their RESULT is queryable — so doctor confirms instead of
# blindly reminding. (The third UI-only step, the per-fork package Read grant,
# genuinely has no read endpoint — that one stays a reminder.)
fork_detached() { [ "$(gh api "repos/$1" --jq '.fork' 2>/dev/null)" = "false" ]; }
package_private() { [ "$(gh api "orgs/$1/packages/container/score" --jq '.visibility' 2>/dev/null)" = "private" ]; }

# jq selecting the IDs of a fork's inherited (to-be-disabled) workflows: real
# .github/workflows/ files only, minus our own ctf-score.yml, that are active.
# The startswith() guard skips GitHub-managed DYNAMIC workflows (e.g.
# dynamic/dependabot/update-graph, dynamic/pages/...) which cannot be disabled
# via the API and never run on / close contestant PRs — counting them would
# make disable-inherited never settle (doctor stuck red, provisioning looping).
INHERITED_JQ='.workflows[] | select(.path | startswith(".github/workflows/")) | select(.path != ".github/workflows/ctf-score.yml") | select(.state=="active") | .id'

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
    vapp-dockerfile)
      if [ "$t" = vulnerableapp ]; then
        echo "DRY-RUN: PUT setup/vulnerableapp.Dockerfile to $org/$name:Dockerfile on ctf"
      fi
      ;;
  esac
}

check_step() {
  local id="$1" t="$2" org="$3" name; name="$(prov_repo_name "$t")"
  case "$id" in
    fork) gh_ok "repos/$org/$name" ;;
    ctf-branch) [ "$(gh api "repos/$org/$name" --jq '.default_branch' 2>/dev/null)" = "ctf" ] ;;
    drop-old)
      local branches
      branches="$(gh api "repos/$org/$name/branches" --jq '.[].name' 2>/dev/null)" || return 1
      ! printf '%s\n' "$branches" | grep -qxE 'master|main'
      ;;
    protect)
      local n
      n="$(gh api "repos/$org/$name/branches/ctf/protection" \
        --jq '.required_pull_request_reviews.required_approving_review_count // 0' 2>/dev/null)" || n=0
      [ "${n:-0}" -ge 1 ]
      ;;
    workflow) gh_ok "repos/$org/$name/contents/.github/workflows/ctf-score.yml?ref=ctf" ;;
    disable-inherited)
      local others
      # Let GitHub finish indexing the fork's workflows before judging, or a
      # fresh fork reads empty and false-passes (the vacuous-zero trap).
      wait_workflows_settled "$org/$name"
      others="$(gh api "repos/$org/$name/actions/workflows" \
        --jq "$INHERITED_JQ" 2>/dev/null)" || return 1
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
        if gh_ok "repos/$org/$name/branches/$b"; then
          gh api -X DELETE "repos/$org/$name/git/refs/heads/$b" >/dev/null 2>&1 || true
        fi
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
        --jq "$INHERITED_JQ" 2>/dev/null); do
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
  local rc=0 t id cell name

  if gh_ok "orgs/$org"; then
    printf '%s✅ org %s%s\n\n' "$C_GREEN" "$org" "$C_RESET"
  else
    printf '%s⚠️  org %s — create it: https://github.com/account/organizations/new%s\n\n' "$C_YELLOW" "$org" "$C_RESET"
  fi

  # One row per target, one column per provisioning step (+ fork-detach). Each
  # cell: ✅ done · ❌ missing (automatable — fails the exit code) · ⚠️ manual
  # step not yet done (advisory) · – not applicable to this target.
  printf '%s%-18s %-5s %-5s %-5s %-5s %-5s %-5s %-5s %-5s %-5s%s\n' "$C_BOLD" \
    "target" fork ctf old prot wkfl disI pr vapp detch "$C_RESET"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    name="$(prov_repo_name "$t")"
    printf '%-18s ' "$t"
    for id in $STEPS; do
      if [ "$id" = vapp-dockerfile ] && [ "$t" != vulnerableapp ]; then
        cell="–"
      elif check_step "$id" "$t" "$org"; then
        cell="✅"
      else
        cell="❌"; rc=1
      fi
      # ✅/❌ render ~2 cols, the n/a dash ~1 — pad it one extra to keep columns.
      if [ "$cell" = "–" ]; then printf '%s     ' "$cell"; else printf '%s    ' "$cell"; fi
    done
    if fork_detached "$org/$name"; then cell="✅"; else cell="⚠️"; fi
    printf '%s\n' "$cell"
  done < <(yaml_targets)

  echo
  echo "legend: fork=forked ctf=ctf-branch old=drop-old prot=protected wkfl=workflow"
  echo "        disI=disable-inherited pr=pr-template vapp=vapp-dockerfile detch=fork-detached (–=n/a)"
  echo "❌ = automatable step missing (fails exit); ⚠️ = UI-only step to finish by hand"

  # Org-level (not per-target): scorer package.
  echo
  if package_private "$org"; then
    printf '%s✅ scorer package private%s\n' "$C_GREEN" "$C_RESET"
  else
    printf '%s⚠️  scorer package NOT private (or missing) — keep it private: https://github.com/orgs/%s/packages%s\n' "$C_YELLOW" "$org" "$C_RESET"
  fi
  # No API exposes the per-fork "Manage Actions access" grants — reminder only.
  printf '%s⚠️  per-fork package Read grant — no API to verify; confirm each fork under "Manage Actions access": https://github.com/orgs/%s/packages%s\n' "$C_YELLOW" "$org" "$C_RESET"
  return $rc
}

DRY_RUN=0
CONFIG=event.yaml
APP_ID=""
PEM=""
INSTALLATION_ID=""
CLIENT_ID=""
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
      --app-id) APP_ID="$2"; shift ;;
      --pem) PEM="$2"; shift ;;
      --installation-id) INSTALLATION_ID="$2"; shift ;;
      --client-id) CLIENT_ID="$2"; shift ;;
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
  local org="$1" src="$2" dest="ghcr.io/$1/score:latest"
  echo "== mirroring scorer image $src -> $dest"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN: docker pull $src && docker tag $src $dest && docker push $dest"
    echo "DRY-RUN: docker image inspect --format '{{.Architecture}}' $src  # must be amd64"
    return
  fi
  # If the source is already the dest tag and present locally (the wizard just
  # built it), don't pull — the tag isn't in the registry yet, which is the
  # whole reason we're about to push it. Otherwise pull the named source.
  if [ "$src" = "$dest" ] && docker image inspect "$src" >/dev/null 2>&1; then
    echo "== using locally-built $src (skipping pull)"
  else
    docker pull "$src"
  fi
  # Check the pulled image's own config (always has .Architecture, no
  # manifest-list wrapping to unpack) rather than the registry manifest: a
  # plain `docker build` (the documented path in docs/scorer.md) pushes a
  # single-manifest image with no top-level "architecture" field at all —
  # that only appears inside a multi-manifest index's platform entries.
  local arch
  arch="$(docker image inspect --format '{{.Architecture}}' "$src" 2>/dev/null || true)"
  if [ "$arch" != "amd64" ]; then
    echo "ERROR: $src is $arch, not amd64 — GitHub runners need linux/amd64." >&2
    echo "Rebuild + push amd64:  docker buildx build --platform linux/amd64 -t $dest --push scorer/" >&2
    return 1
  fi
  docker tag "$src" "$dest"
  if ! docker push "$dest"; then
    echo "ERROR: push to $dest failed — is docker logged in to ghcr.io with write:packages?" >&2
    echo "  docker login ghcr.io   (token needs write:packages; e.g. gh auth token after 'gh auth refresh -s write:packages,read:packages')" >&2
    return 1
  fi
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
    echo "GITHUB_APP_ID="
    echo "GITHUB_APP_PRIVATE_KEY="
    echo "GITHUB_APP_INSTALLATION_ID="
    echo "EVENT_URL=http://localhost"
    echo "SCORE_INGEST=poll"
    echo "# SCORE_IMAGE: your own scorer image, built from scorer/ (docs/scorer.md),"
    echo "# e.g. ghcr.io/<your-event-org>/score:latest. No default — the upstream"
    echo "# image is private and the kit does not assume access to it."
    echo "SCORE_IMAGE="
  } > "$out"
  echo "wrote $out — fill in GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY, SCORE_IMAGE"
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
  echo "== uninstall the GitHub App and delete org secrets manually"
}

# Open a URL/file in the default browser, degrading to a printed path.
open_url() {
  local target="$1"
  if command -v open >/dev/null 2>&1; then
    open "$target"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$target"
  else
    echo "open this manually: $target"
  fi
}

# Set (or replace) KEY=value in an env file. base64 values contain / + =, so
# we drop-and-append rather than sed the value in place.
set_env_var() {
  local file="$1" key="$2" val="$3" tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" "$file" > "$tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  mv "$tmp" "$file"
}

# app-manifest: render a self-submitting HTML form carrying app-manifest.json
# and open it against the event org's App-creation page. Removes the manual
# JSON copy-paste; the organizer still clicks Create/Install in GitHub's UI.
cmd_app_manifest() {
  require_config
  local org; org="$(yaml_org)"
  [ -n "$org" ] || { echo "event.yaml: github.org missing" >&2; exit 1; }
  local manifest="$SCRIPT_DIR/../sync/app-manifest.json"
  [ -f "$manifest" ] || { echo "manifest not found: $manifest" >&2; exit 1; }

  local action="https://github.com/organizations/${org}/settings/apps/new?state=ctf-in-a-box"
  # The create-from-manifest flow REQUIRES redirect_url. We don't run a callback
  # server (creds are fetched manually from the app page), so point it at the
  # org's Apps settings — after Create, GitHub lands there (with a ?code it
  # ignores) instead of erroring. Injected at render time so the static
  # manifest stays a clean permissions reference.
  local redirect="https://github.com/organizations/${org}/settings/apps"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN: render manifest form (redirect_url=$redirect) -> POST $manifest to $action"
    return 0
  fi

  local manifest_json; manifest_json="$(cat "$manifest")"
  # Insert redirect_url as the first field, right after the opening brace.
  manifest_json="{
  \"redirect_url\": \"${redirect}\",${manifest_json#\{}"

  local html; html="$(mktemp -t ctf-app-manifest).html"
  {
    echo '<!doctype html><meta charset="utf-8"><title>Create the CTF-in-a-box GitHub App</title>'
    echo "<form action=\"${action}\" method=\"post\">"
    printf '<input type="hidden" name="manifest" value='"'"'%s'"'"'>' "$(printf '%s' "$manifest_json" | sed "s/'/\&#39;/g")"
    echo '</form><p>Submitting to GitHub…</p><script>document.forms[0].submit()</script>'
  } > "$html"

  echo "== opening GitHub App creation for org '$org' in your browser"
  open_url "$html"
  cat <<EOF
== the form is PRE-FILLED from the manifest. If it opened BLANK (auto-submit
   blocked), enter these values by hand — they are the whole manifest:
     GitHub App name:   CTF-in-a-box sync   (rename if the name is taken)
     Homepage URL:      https://github.com/dcotelo/ctf-in-a-box
     Webhook:           UNCHECK "Active"  (no webhook — else GitHub demands a URL)
     Repository permissions:  Issues → Read-only
                              Pull requests → Read-only
                              (Metadata → Read-only is added automatically)
     Subscribe to events:     none
     Where can this be installed:  Only on this account (@$org)
== then, in GitHub's UI:
   1. Click "Create GitHub App".
   2. On the app page: "Generate a private key" (downloads a .pem), and note the App ID.
   3. "Install App" -> install it on the '$org' org.
   4. The wizard will prompt for the App ID + .pem path next (or, standalone:
        ctf-setup.sh app-config --app-id <id> --pem <path-to-downloaded.pem>
      add --installation-id <n> to pin it; otherwise sync auto-discovers it).
EOF
}

# app-config: ingest a downloaded App private key + App ID into .env
# (base64-encodes the PEM). Optional --installation-id pins the install;
# without it, sync discovers the installation at runtime.
cmd_app_config() {
  local out="${OUT:-.env}"
  [ -n "$APP_ID" ] || { echo "app-config: --app-id is required" >&2; exit 1; }
  [ -n "$PEM" ] || { echo "app-config: --pem <path> is required" >&2; exit 1; }
  [ -f "$PEM" ] || { echo "app-config: pem not found: $PEM" >&2; exit 1; }
  if ! grep -q 'PRIVATE KEY' "$PEM"; then
    echo "app-config: $PEM is not a PEM private key" >&2; exit 1
  fi
  [ -f "$out" ] || { echo "app-config: $out not found — run 'ctf-setup.sh secrets' first" >&2; exit 1; }

  local key_b64; key_b64="$(base64 < "$PEM" | tr -d '\n')"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN: set GITHUB_APP_ID=$APP_ID, GITHUB_APP_PRIVATE_KEY=<base64 pem> in $out"
    if [ -n "$INSTALLATION_ID" ]; then
      echo "DRY-RUN: set GITHUB_APP_INSTALLATION_ID=$INSTALLATION_ID in $out"
    fi
    return 0
  fi

  set_env_var "$out" GITHUB_APP_ID "$APP_ID"
  set_env_var "$out" GITHUB_APP_PRIVATE_KEY "$key_b64"
  if [ -n "$INSTALLATION_ID" ]; then
    set_env_var "$out" GITHUB_APP_INSTALLATION_ID "$INSTALLATION_ID"
  fi
  echo "wrote GitHub App credentials to $out (App ID $APP_ID, private key base64-encoded)"
}

# The OAuth callback the app registers with GitHub: <EVENT_URL>/api/auth/callback/github.
# EVENT_URL comes from .env (secrets writes it); default to localhost for a local box.
event_url() {
  local u; u="$(sed -n 's/^EVENT_URL=//p' "${OUT:-.env}" 2>/dev/null | tail -1)"
  [ -n "$u" ] || u="http://localhost"
  printf '%s' "$u"
}

# oauth-app: open GitHub's new-OAuth-App page for the event org and print the
# exact field values. OAuth Apps have no manifest/create API (UI-only), so
# unlike the GitHub App flow this only opens + guides — it cannot auto-fill.
cmd_oauth_app() {
  require_config
  local org; org="$(yaml_org)"
  [ -n "$org" ] || { echo "event.yaml: github.org missing" >&2; exit 1; }
  local url callback
  url="https://github.com/organizations/${org}/settings/applications/new"
  callback="$(event_url)/api/auth/callback/github"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN: open $url (callback $callback)"
    return 0
  fi
  echo "== opening GitHub's new-OAuth-App page for org '$org' in your browser"
  open_url "$url"
  cat <<EOF
== fill these fields (OAuth App creation is UI-only — copy/paste):
   Application name:            CTF-in-a-box ($org)
   Homepage URL:                $(event_url)
   Authorization callback URL:  $callback
   Then: "Register application" -> copy the Client ID -> "Generate a new
   client secret" -> copy it. Then wire them into .env:
        ctf-setup.sh oauth-config --client-id <client id>
   (You may create the OAuth App on your personal account instead of the org.)
EOF
}

# oauth-config: write the OAuth client id + secret into .env. The secret is
# read from a hidden prompt (never on argv / in shell history).
cmd_oauth_config() {
  local out="${OUT:-.env}"
  [ -n "$CLIENT_ID" ] || { echo "oauth-config: --client-id is required" >&2; exit 1; }
  [ -f "$out" ] || { echo "oauth-config: $out not found — run 'ctf-setup.sh secrets' first" >&2; exit 1; }
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN: set GITHUB_CLIENT_ID=$CLIENT_ID + GITHUB_CLIENT_SECRET=<prompted> in $out"
    return 0
  fi
  local secret
  printf 'GitHub OAuth client secret (input hidden): ' >&2
  read -rs secret; echo >&2
  [ -n "$secret" ] || { echo "oauth-config: empty client secret" >&2; exit 1; }
  set_env_var "$out" GITHUB_CLIENT_ID "$CLIENT_ID"
  set_env_var "$out" GITHUB_CLIENT_SECRET "$secret"
  echo "wrote GitHub OAuth credentials to $out (client id $CLIENT_ID)"
}

# --- wizard -----------------------------------------------------------------
# Read a single value out of the .env (empty if the file or key is absent).
env_val() {
  local out="${OUT:-.env}"
  [ -f "$out" ] || return 0
  sed -n "s/^$1=//p" "$out" | tail -1
}

wiz_step() { echo; printf '%s── %s%s\n' "$C_BOLD$C_CYAN" "$1" "$C_RESET"; }

# ASCII banner shown at the top of the wizard.
wiz_banner() {
  printf '%s' "$C_CYAN"
  cat <<'BANNER'
  ____ _____ _____   _                 _
 / ___|_   _|  ___| (_)_ __     __ _  | |__   _____  __
| |     | | | |_    | | '_ \   / _` | | '_ \ / _ \ \/ /
| |___  | | |  _|   | | | | | | (_| | | |_) | (_) >  <
 \____| |_| |_|     |_|_| |_|  \__,_| |_.__/ \___/_/\_\
BANNER
  printf '%s' "$C_RESET"
}

# Yes/No prompt. Returns 0 for yes. $2 is the default when the user just hits
# Enter — "Y" for the happy-path "do it now?" actions, "N" (default) for
# exceptional ones like retries. Under --dry-run it never blocks or mutates: it
# prints the question and answers "no" so the wizard just narrates.
ask_yn() {
  local reply def="${2:-N}" hint
  case "$def" in Y | y) hint="${C_GREEN}[Y/n]${C_RESET}" ;; *) hint="[y/N]" ;; esac
  if [ "$DRY_RUN" -eq 1 ]; then echo "$1 [dry-run: skipped]"; return 1; fi
  printf '%s %s ' "$1" "$hint"
  read -r reply || reply=""
  [ -n "$reply" ] || reply="$def"
  case "$reply" in y | Y | yes | YES) return 0 ;; *) return 1 ;; esac
}

# Expand a leading ~ / ~/ in a path to $HOME (read -r does not do it — tilde
# expansion is a shell parse-time step, not applied to variable values).
expand_tilde() {
  # The "~" patterns are literal string matches (quoted), not tilde expansions
  # we expect the shell to perform — that is the whole point of this helper.
  # shellcheck disable=SC2088
  case "$1" in
    "~") printf '%s' "$HOME" ;;
    "~/"*) printf '%s/%s' "$HOME" "${1:2}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# Wait for the operator to finish a GitHub-UI step. No-op under --dry-run.
pause_confirm() {
  [ "$DRY_RUN" -eq 1 ] && { echo "$1 [dry-run: skipped]"; return 0; }
  printf '%s ' "$1"
  read -r _ || true
}

# Prompt for a value into the named variable, falling back to a default on an
# empty reply. Under --dry-run it never blocks or reads: it narrates the prompt
# and assigns the default, so the wizard stays non-interactive and side-effect
# free. Uses `printf -v` (bash 3.2 safe) for the indirect assignment.
wiz_ask() {
  local __var="$1" __prompt="$2" __def="${3:-}" __reply
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '  %s [%s] (dry-run: default)\n' "$__prompt" "$__def"
    printf -v "$__var" '%s' "$__def"
    return 0
  fi
  if [ -n "$__def" ]; then
    printf '  %s [%s]: ' "$__prompt" "$__def"
  else
    printf '  %s: ' "$__prompt"
  fi
  read -r __reply || __reply=""
  [ -n "$__reply" ] || __reply="$__def"
  printf -v "$__var" '%s' "$__reply"
}

# Join a whitespace-separated list into a "a, b, c" string for a YAML flow list.
csv_of() {
  local out="" x
  for x in $1; do
    if [ -n "$out" ]; then out="$out, $x"; else out="$x"; fi
  done
  printf '%s' "$out"
}

# The default front door: walk a brand-new organizer from zero to a running,
# scored event, doing every automatable step and guiding + verifying each
# UI-only one. Resumable — it inspects state (check/doctor/.env/event.yaml) and
# only prompts for what's missing, so re-running picks up where you left off.
# The discrete subcommands remain for scripting/CI; the wizard just orchestrates
# them. Stops with instructions whenever it needs you to do something off-box
# (edit a file, click Create in GitHub's UI); complete it and re-run.
cmd_wizard() {
  local out="${OUT:-.env}"
  wiz_banner
  printf '%sCTF-in-a-box setup wizard%s — walks you to a running, scored event. Safe to re-run — it resumes.\n' "$C_BOLD" "$C_RESET"
  [ "$DRY_RUN" -eq 1 ] && echo "(dry-run: nothing will be changed)"

  # 1. Prerequisites (subshelled so cmd_check's exit doesn't kill the wizard).
  wiz_step "1/8  Prerequisites"
  if ( cmd_check ) >/dev/null 2>&1; then
    echo "  ✅ gh, docker, compose, openssl, gh auth"
  else
    cmd_check || true
    echo "  Fix the above, then re-run the wizard."
    exit 1
  fi

  # 2. Secrets (.env).
  wiz_step "2/8  Secrets ($out)"
  if [ -f "$out" ]; then
    echo "  ✅ $out present"
  elif [ "$DRY_RUN" -eq 1 ]; then
    echo "  DRY-RUN: would generate $out via 'secrets' and prompt EVENT_URL"
  else
    cmd_secrets
    local ev_url
    wiz_ask ev_url "Box URL contestants reach (https:// for a real event)" "$(env_val EVENT_URL)"
    set_env_var "$out" EVENT_URL "$ev_url"
    echo "  ✅ EVENT_URL=$ev_url"
  fi

  # 3. Event config.
  wiz_step "3/8  Event config ($CONFIG)"
  if [ -f "$CONFIG" ] && [ -n "$(yaml_org)" ] && yaml_targets | grep -q .; then
    echo "  ✅ $CONFIG (org: $(yaml_org))"
  else
    echo "  Answer a few questions to write $CONFIG (Enter accepts the [default])."
    local ev_name ev_org ev_admins ev_targets ev_url ev_ingest ev_start ev_end adm_default
    adm_default=""
    [ "$DRY_RUN" -eq 1 ] || adm_default="$(gh api user --jq .login 2>/dev/null || true)"
    wiz_ask ev_name    "Event name" "OWASP Chapter CTF"
    wiz_ask ev_org     "GitHub org (disposable per-event org)" ""
    while [ "$DRY_RUN" -ne 1 ] && [ -z "$ev_org" ]; do
      echo "  org is required."
      wiz_ask ev_org   "GitHub org (disposable per-event org)" ""
    done
    wiz_ask ev_admins  "Admin GitHub login(s), space-separated" "$adm_default"
    wiz_ask ev_targets "Targets — subset of: juice-shop dvwa webgoat securityshepherd vulnerableapp vampi" "juice-shop dvwa webgoat securityshepherd vulnerableapp vampi"
    wiz_ask ev_url     "Event URL contestants reach" "$(env_val EVENT_URL)"
    wiz_ask ev_ingest  "Score ingest (poll | push)" "poll"
    wiz_ask ev_start   "Event start (ISO 8601 e.g. 2026-10-01T09:00:00-03:00, blank to skip)" ""
    ev_end=""
    [ -z "$ev_start" ] || wiz_ask ev_end "Event end (ISO 8601, blank to skip)" ""
    # Optional start/end drive the app's countdown + display dates; emitted only
    # when a start was given (end is nested under it).
    local ev_dates=""
    if [ -n "$ev_start" ]; then
      ev_dates="  start: $ev_start
"
      [ -z "$ev_end" ] || ev_dates="$ev_dates  end: $ev_end
"
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "  DRY-RUN: would write $CONFIG (org: $ev_org)"
    else
      cat > "$CONFIG" <<EOF
event:
  name: "$ev_name"
  url: $ev_url
${ev_dates}github:
  org: $ev_org
modules:
  secure-development:
    targets: [$(csv_of "$ev_targets")]
    score_ingest: $ev_ingest
teams: { enabled: true, max_size: 4 }
hints: { enabled: false }
admins: [$(csv_of "$ev_admins")]
EOF
      echo "  ✅ wrote $CONFIG (org: $ev_org)"
    fi
  fi
  local org=""; [ -f "$CONFIG" ] && org="$(yaml_org)"

  # 4. Scorer image.
  wiz_step "4/8  Scorer image (SCORE_IMAGE)"
  if [ -n "$(env_val SCORE_IMAGE)" ]; then
    echo "  ✅ SCORE_IMAGE=$(env_val SCORE_IMAGE)"
  else
    local img="ghcr.io/$org/score:latest"
    if ask_yn "  Build the scorer image ($img) now?" Y; then
      # linux/amd64 REQUIRED: GitHub runners are amd64; an arm64 image (the
      # default on Apple Silicon) fails the fork's scoring Action with "no
      # matching manifest for linux/amd64".
      docker build --platform linux/amd64 -t "$img" "$SCRIPT_DIR/../scorer"
      set_env_var "$out" SCORE_IMAGE "$img"
      echo "  ✅ built (linux/amd64) + set SCORE_IMAGE=$img"
      printf '  %sPush it before provisioning%s — the org step mirrors it and forks pull it:\n' "$C_YELLOW" "$C_RESET"
      echo "     docker login ghcr.io   # once, with a token that has write:packages"
      echo "     docker push $img"
    else
      echo "  Skipped. Build later (amd64), set SCORE_IMAGE in $out, and push:"
      echo "     docker build --platform linux/amd64 -t $img $SCRIPT_DIR/../scorer"
      echo "     docker login ghcr.io && docker push $img"
    fi
  fi

  # 5. Sync GitHub App (poll auth).
  wiz_step "5/8  Sync GitHub App (poll auth)"
  if [ -n "$(env_val GITHUB_APP_ID)" ] && [ -n "$(env_val GITHUB_APP_PRIVATE_KEY)" ]; then
    echo "  ✅ GitHub App configured"
  elif [ "$DRY_RUN" -eq 1 ]; then
    echo "  DRY-RUN: would open the App-creation form, then prompt App ID + .pem path"
  else
    if ask_yn "  Open the App-creation form now?" Y; then cmd_app_manifest; fi
    pause_confirm "  Press Enter once you've clicked Create, generated the key (.pem), and installed the App…"
    while :; do
      wiz_ask APP_ID          "  App ID" ""
      wiz_ask PEM             "  Path to the downloaded .pem" ""
      PEM="$(expand_tilde "$PEM")"
      wiz_ask INSTALLATION_ID "  Installation ID (optional — Enter to auto-discover)" ""
      if ( cmd_app_config ); then break; fi
      ask_yn "  Re-enter the App ID / .pem path?" || break
    done
  fi

  # 6. Sign-in OAuth app.
  wiz_step "6/8  Sign-in OAuth app"
  if [ -n "$(env_val GITHUB_CLIENT_ID)" ] && [ -n "$(env_val GITHUB_CLIENT_SECRET)" ]; then
    echo "  ✅ OAuth app configured"
  elif [ "$DRY_RUN" -eq 1 ]; then
    echo "  DRY-RUN: would open the OAuth-app page, then prompt Client ID + hidden secret"
  else
    if ask_yn "  Open the OAuth-app page now?" Y; then cmd_oauth_app; fi
    pause_confirm "  Press Enter once you've registered the app and generated a client secret…"
    while :; do
      wiz_ask CLIENT_ID "  OAuth Client ID" ""
      if ( cmd_oauth_config ); then break; fi
      ask_yn "  Re-enter the Client ID / secret?" || break
    done
  fi

  # 7. Create + provision the org.
  wiz_step "7/8  Event org ($org)"
  if gh_ok "orgs/$org"; then
    echo "  ✅ org $org exists"
  else
    echo "  Create it (UI-only): https://github.com/account/organizations/new  (name: $org)"
    pause_confirm "  Press Enter once the org exists…"
    if ! gh_ok "orgs/$org"; then
      echo "  Still can't see org $org — create it, then re-run."
      exit 0
    fi
  fi
  if [ -z "$(env_val SCORE_IMAGE)" ]; then
    echo "  SCORE_IMAGE unset — build it (step 4) before provisioning. Skipping."
  elif ask_yn "  Provision the org now (fork targets, branches, workflow, image)?" Y; then
    cmd_org
  else
    echo "  Skipped. Run 'ctf-setup.sh org' (preview with --dry-run) when ready."
  fi
  echo
  echo "  Verifying with doctor:"
  ( cmd_doctor ) || true
  echo "  Finish any ⚠️ UI-only steps above (fork-network detach, package Read grant)."

  # 8. Bring the containers up.
  wiz_step "8/8  Bring the containers up"
  cat <<EOF
  EVENT_CONFIG_B64="\$(base64 < $CONFIG | tr -d '\n')" \\
    docker compose --profile poll --profile app up -d --build app
EOF
  if ask_yn "  Bring the containers up now?" Y; then
    EVENT_CONFIG_B64="$(base64 < "$CONFIG" | tr -d '\n')" docker compose --profile poll --profile app up -d --build app
  fi

  echo
  echo "== Done. Open $(env_val EVENT_URL), sign in, and check /admin."
  echo "   Re-run 'ctf-setup.sh doctor' anytime to re-verify provisioning."
}

if [ "$CMD" != "__selftest" ]; then
  case "$CMD" in
    ""|wizard) cmd_wizard ;;
    check) cmd_check ;;
    secrets) cmd_secrets ;;
    org) cmd_org ;;
    render) cmd_render ;;
    teardown) cmd_teardown ;;
    doctor) cmd_doctor ;;
    app-manifest) cmd_app_manifest ;;
    app-config) cmd_app_config ;;
    oauth-app) cmd_oauth_app ;;
    oauth-config) cmd_oauth_config ;;
    *) echo "usage: ctf-setup.sh [wizard|check|secrets|org|render|teardown|doctor|app-manifest|app-config|oauth-app|oauth-config] [--dry-run] [--config event.yaml] [--out .env] [--app-id N] [--pem path] [--installation-id N] [--client-id ID]" >&2
       echo "  run with no subcommand (or 'wizard') for the guided step-by-step setup" >&2; exit 2 ;;
  esac
fi
