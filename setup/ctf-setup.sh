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
  check_known_modules || exit 1
  local org; org="$(yaml_org)"
  [ -n "$org" ] || { echo "event.yaml: github.org missing" >&2; exit 1; }
  local rc=0 t id cell name

  if gh_ok "orgs/$org"; then
    printf '%s✅ org %s%s\n\n' "$C_GREEN" "$org" "$C_RESET"
  else
    printf '%s⚠️  org %s — create it: https://github.com/account/organizations/new%s\n\n' "$C_YELLOW" "$org" "$C_RESET"
  fi

  # No secure-development module: no forks, no scorer image, nothing in the
  # per-target matrix below to check — an empty table (headers only) would
  # read as a failure rather than the truth, which is that quiz-only events
  # have no fork-based content at all. Report that plainly instead and stop.
  if ! has_module secure-development; then
    printf '%sℹ️  no secure-development module configured — no provisioned content to check (nothing forked, nothing to inspect here).%s\n' "$C_CYAN" "$C_RESET"
    return 0
  fi

  # secure-development IS enabled: it must have targets. Without this, an
  # unreadable targets list printed an empty (headers-only) table and exited
  # 0 — doctor reporting "all fine" for a config sync rejects outright
  # ("targets must be a non-empty list"). Same check cmd_org makes.
  yaml_targets | grep -q . || { echo "event.yaml: no targets under modules.secure-development" >&2; exit 1; }

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

# Verify config file exists (only for subcommands that need it). Module-key
# validation (check_known_modules) is deliberately NOT run here — it is
# called explicitly by the module-consuming commands (org/render/doctor)
# only. Gating every require_config caller on it would also block teardown
# (the recovery path for a botched event.yaml — an organizer who typo'd a
# module name must still be able to tear down already-forked repos) and the
# UI-flow openers app-manifest/oauth-app, which have no functional
# dependency on module keys at all.
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

# ---------------------------------------------------------------------------
# event.yaml's `modules:` block — the only place this script parses structured
# YAML, and a contract it shares with a second reader written in another
# language (sync/src/config.js, plus the app's
# apps/web/scripts/generate-event-config.mjs). The two must agree on
# accept/reject for the same file: setup/test/module_readers.bats and
# sync/test/module-readers.differential.test.js run a shared corpus of
# event.yaml shapes through BOTH and assert they do.
#
# Everything below FAILS CLOSED. If it cannot confidently parse the block it
# errors (exit 2) instead of reporting "no modules" — a silently empty result
# is indistinguishable from a quiz-only event and makes org/render/doctor
# no-op on a perfectly valid config, which is exactly the bug this parser
# replaced (the old one hard-coded 2-space block style and returned zero keys
# for flow style, 4-space indent, quoted keys, tabs, or a bare `modules:`).
#
# Understood — every one of these is real YAML the other readers accept:
#   - block style at ANY indent, ending at the first line indented less than
#     the module keys
#   - flow style: `modules: { quiz: {}, secure-development: { targets: [dvwa] } }`,
#     including a flow mapping spread over several lines
#   - quoted keys, interleaved comments, blank lines, CRLF, a leading &anchor
#   - targets as a flow sequence (`targets: [a, b]`) or a block sequence
#     (`- a` lines)
# Rejected LOUDLY, never silently: tab indentation, a bare `modules:` with
# nothing under it, a scalar or sequence value for `modules:`, sequence items
# or merge keys (`<<:`) where module keys belong, an unterminated flow
# mapping, an alias (`modules: *base`) this parser cannot resolve, DUPLICATE
# module keys and a duplicated top-level `modules:` block, and any other shape
# it does not understand.
#
# The duplicates are there for the same reason as everything else on that
# list: the YAML libraries behind the other two readers reject a repeated
# mapping key outright ("Map keys must be unique"), so first-wins here meant
# `ctf-setup.sh org` exiting 0 having provisioned whatever the first copy
# said, with the same file blowing up much later at app build. Same shape as
# the flow-style divergence this parser replaced, in miniature.
#
# want=keys    -> one module key per line
# want=targets -> one target per line, scoped to modules.<mod> (a `targets:`
#                 line anywhere else in the file is ignored)
_yaml_modules() {
  awk -v want="$1" -v mod="${2:-}" '
    function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
    function unquote(s,   c) {
      c = substr(s, 1, 1)
      if ((c == "\"" || c == "\047") && length(s) >= 2 && substr(s, length(s), 1) == c)
        return substr(s, 2, length(s) - 2)
      return s
    }
    # Strip a trailing `# comment`, honouring quotes (a # inside "..." is data).
    function strip_comment(s,   i, c, p, q, o) {
      q = ""; o = ""
      for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        if (q != "") { o = o c; if (c == q) q = ""; continue }
        if (c == "\"" || c == "\047") { q = c; o = o c; continue }
        if (c == "#") {
          if (i == 1) return o
          p = substr(s, i - 1, 1)
          if (p == " " || p == "\t") return o
        }
        o = o c
      }
      return o
    }
    function fail(msg) { printf("event.yaml: %s\n", msg) > "/dev/stderr"; failed = 1; exit 2 }
    # Duplicate module keys, tracked as a "\nkey\n..." string rather than an
    # array so a partial flow scan can restore it by assignment (see
    # flow_scan) without depending on `delete arr`.
    function seen(key) { return index(seenbuf, "\n" key "\n") > 0 }
    function see(key) { seenbuf = seenbuf key "\n" }
    function emit(v) { out = out v "\n" }
    function emit_list(inner,   n, a, i, t) {
      n = split(inner, a, ",")
      for (i = 1; i <= n; i++) { t = unquote(trim(a[i])); if (t != "") emit(t) }
    }
    # targets: [ ... ] out of a flow mapping value such as "{targets: [a, b]}"
    function flow_targets(v,   s, i) {
      if (!match(v, /(^|[{, \t])targets[ \t]*:[ \t]*\[/)) return
      s = substr(v, RSTART + RLENGTH)
      i = index(s, "]")
      if (i == 0) fail("unterminated targets: [ ... ] under modules." mod)
      emit_list(substr(s, 1, i - 1))
    }
    function pair(k, v) {
      if (want == "keys") { emit(k); return }
      if (k == mod) flow_targets(v)
    }
    # Quote-aware scan of a flow mapping. Returns 1 when the mapping closed
    # (keys/targets emitted), -1 when it needs more lines. Errors are fatal.
    function flow_scan(s,   i, c, q, depth, tok, st, key, saved, saved_seen) {
      saved = out                        # a partial scan must emit nothing
      # ...and must remember no keys either: a multi-line flow mapping is
      # re-scanned from the start on every added line, so keys carried over
      # from the previous pass would read as duplicates of themselves.
      saved_seen = seenbuf
      q = ""; depth = 0; tok = ""; st = "key"; key = ""
      for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        if (q != "") { tok = tok c; if (c == q) q = ""; continue }
        if (c == "\"" || c == "\047") { q = c; tok = tok c; continue }
        if (c == "{" || c == "[") { depth++; if (depth == 1) tok = ""; else tok = tok c; continue }
        if (c == "}" || c == "]") {
          depth--
          if (depth == 0) {
            if (st == "key" && trim(tok) != "") fail("modules: is not a mapping of module keys near: " trim(tok))
            if (st == "val") pair(key, tok)
            if (trim(substr(s, i + 1)) != "") fail("unexpected text after the modules: mapping: " trim(substr(s, i + 1)))
            return 1
          }
          tok = tok c
          continue
        }
        if (depth == 1 && c == ":" && st == "key") {
          key = unquote(trim(tok))
          if (key == "") fail("modules: has an entry with an empty key")
          if (seen(key)) fail("modules: has a duplicate key: " key)
          see(key)
          tok = ""; st = "val"; continue
        }
        if (depth == 1 && c == ",") {
          if (st == "key") {
            if (trim(tok) != "") fail("modules: entry is not a key: value pair near: " trim(tok))
            continue
          }
          pair(key, tok); tok = ""; st = "key"; continue
        }
        tok = tok c
      }
      out = saved
      seenbuf = saved_seen
      return -1
    }
    # Position of the colon that ends a (possibly quoted) mapping key, or 0.
    function key_colon(s,   i, c, q) {
      q = ""
      for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        if (q != "") { if (c == q) q = ""; continue }
        if (c == "\"" || c == "\047") { q = c; continue }
        if (c == ":") return i
      }
      return 0
    }
    # targets out of the collected block-style subtree of modules.<mod>.
    function block_targets(   n, a, i, j, k, ind, cb, body, rest, acc, item) {
      n = split(modbuf, a, "\n")
      cb = -1
      for (i = 1; i <= n; i++) {
        if (a[i] ~ /^[ \t]*$/ || a[i] ~ /^[ \t]*#/) continue
        match(a[i], /^[ \t]*/); ind = RLENGTH
        if (cb < 0) cb = ind
        if (ind != cb) continue
        body = trim(strip_comment(substr(a[i], cb + 1)))
        j = key_colon(body)
        if (j == 0) continue
        if (unquote(trim(substr(body, 1, j - 1))) != "targets") continue
        rest = trim(substr(body, j + 1))
        if (rest == "") {
          # block sequence: `- item` lines at or below the targets: key
          for (k = i + 1; k <= n; k++) {
            if (a[k] ~ /^[ \t]*$/ || a[k] ~ /^[ \t]*#/) continue
            match(a[k], /^[ \t]*/); if (RLENGTH < cb) break
            item = trim(strip_comment(substr(a[k], RLENGTH + 1)))
            if (substr(item, 1, 1) != "-") break
            item = unquote(trim(substr(item, 2)))
            if (item != "") emit(item)
          }
          return
        }
        if (substr(rest, 1, 1) != "[") return   # a scalar: not a list, emit nothing
        acc = rest
        for (k = i + 1; index(acc, "]") == 0 && k <= n; k++) acc = acc " " trim(strip_comment(a[k]))
        if (index(acc, "]") == 0) fail("unterminated targets: [ ... ] under modules." mod)
        emit_list(substr(acc, 2, index(acc, "]") - 2))
        return
      }
    }

    BEGIN { state = "pre"; base = -1; out = ""; modbuf = ""; inmod = 0; found = 0; seenbuf = "\n" }

    {
      line = $0
      sub(/\r$/, "", line)

      # A SECOND top-level `modules:` key. YAML calls that a duplicate mapping
      # key and the other two readers throw on it; reading it as "the block
      # ended" (which is what an indent-0 line means in state block, and what
      # state done ignores outright) would provision the first copy and drop
      # the second in silence. Not checked in state flow: there, an indent-0
      # line is either inside an unterminated flow mapping — already fatal at
      # END — or a nested key of it.
      if ((state == "block" || state == "done") && line ~ /^modules[ \t]*:/)
        fail("more than one top-level modules: key (line " NR ")")

      if (state == "done") next

      if (state == "pre") {
        if (line !~ /^modules[ \t]*:/) next
        found = 1
        rest = trim(strip_comment(substr(line, index(line, ":") + 1)))
        sub(/^&[^ \t]+[ \t]*/, "", rest)          # `modules: &anchor {...}`
        if (rest == "") { state = "block"; next }
        if (substr(rest, 1, 1) != "{")
          fail("modules: must be a mapping of module keys, got: " rest)
        state = "flow"; flowbuf = rest
        if (flow_scan(flowbuf) == 1) state = "done"
        next
      }

      if (state == "flow") {
        flowbuf = flowbuf " " trim(strip_comment(line))
        if (flow_scan(flowbuf) == 1) state = "done"
        next
      }

      # block style
      if (line ~ /^[ \t]*$/ || line ~ /^[ \t]*#/) next
      match(line, /^[ \t]*/); ind = RLENGTH
      if (substr(line, 1, ind) ~ /\t/)
        fail("tab indentation under modules: is not valid YAML (line " NR ")")
      if (base < 0) {
        if (ind == 0) fail("modules: has no module keys under it — declare at least one module")
        base = ind
      }
      if (ind < base) { state = "done"; next }
      if (ind > base) { if (want == "targets" && inmod) modbuf = modbuf line "\n"; next }

      inmod = 0
      body = trim(strip_comment(substr(line, base + 1)))
      if (body == "") next
      if (substr(body, 1, 1) == "-")
        fail("modules: must be a mapping of module keys, found a sequence item (line " NR ")")
      if (body ~ /^<</)
        fail("merge keys (<<) under modules: are not supported (line " NR ")")
      if (substr(body, 1, 1) == "?")
        fail("complex keys (?) under modules: are not supported (line " NR ")")
      ci = key_colon(body)
      if (ci == 0)
        fail("modules: entry is not a `key:` mapping (line " NR "): " body)
      key = unquote(trim(substr(body, 1, ci - 1)))
      if (key == "") fail("modules: has an entry with an empty key (line " NR ")")
      if (seen(key)) fail("modules: has a duplicate key: " key " (line " NR ")")
      see(key)
      val = trim(substr(body, ci + 1))
      sub(/^&[^ \t]+[ \t]*/, "", val)
      if (want == "keys") { emit(key); next }
      if (key != mod) next
      inmod = 1
      if (val != "") { inmod = 0; if (substr(val, 1, 1) == "{") flow_targets(val) }
      next
    }

    END {
      if (failed) exit 2
      if (!found) { printf("event.yaml: no modules: block\n") > "/dev/stderr"; exit 3 }
      if (state == "flow") fail("unterminated flow mapping after modules:")
      if (state == "block" && base < 0)
        fail("modules: has no module keys under it — declare at least one module")
      if (want == "targets" && modbuf != "") block_targets()
      printf "%s", out
    }
  ' "$CONFIG"
}

# The targets of modules.secure-development, one per line. Empty output means
# "no targets configured" — every caller treats that as an error when the
# module IS enabled (mirroring sync's "targets must be a non-empty list").
yaml_targets() {
  _yaml_modules targets secure-development
}

# The module keys this build KNOWS how to provision-check for. Mirrors
# sync/src/config.js's KNOWN_MODULES — the two readers parse the same
# event.yaml in different languages with no shared code, and AGENTS.md's
# lockstep-readers rule requires they still agree in BEHAVIOUR: a MISSING
# secure-development block is tolerated (every caller below skips its
# fork-based provisioning), an UNKNOWN key is still a hard error. Only
# secure-development has anything here to fork/render/check; quiz is scored
# entirely app-side.
KNOWN_MODULES="secure-development quiz classic"

# Top-level keys directly under `modules:`, one per line. Exit status is part
# of the contract: nonzero means "could not parse", NOT "no modules" — every
# caller must treat a failure as fatal (see has_module / check_known_modules).
yaml_module_keys() {
  _yaml_modules keys
}

# Is module $1 declared under modules: at all? A module is enabled by
# PRESENCE and disabled by omission (docs/modules.md §1) — there is no
# `enabled:` key to check instead.
#
# FAILS CLOSED: a boolean cannot express "I could not read the file", and
# every caller spells this `if ! has_module secure-development; then <skip
# all provisioning>` — so returning "absent" on a parse error would turn a
# malformed (or merely unsupported) event.yaml into a silent, successful
# no-op. On a parse error this aborts the whole script instead. Callers
# already run check_known_modules first, so this is the second line of
# defence, not the only one.
has_module() {
  local keys
  if ! keys="$(yaml_module_keys)"; then
    echo "event.yaml: cannot read the modules: block — refusing to guess what is enabled" >&2
    exit 1
  fi
  printf '%s\n' "$keys" | grep -qx "$1"
}

# Does event.yaml declare a top-level `modules:` key at all? A config with NO
# modules: block has nothing enabled, ever — that's malformed config, not a
# "nothing to provision" state. Mirrors sync/src/config.js:49
# (`if (!modules || typeof modules !== "object") throw ...`): a config
# missing `modules` entirely is rejected there too, distinct from a present
# `modules:` block that merely lacks `secure-development` (which IS
# tolerated — see has_module above / the callers that use it).
yaml_has_modules_block() {
  grep -qE '^modules[[:space:]]*:' "$CONFIG"
}

# Fail loudly on a malformed modules: section: either no modules: block at
# all, or a module key event.yaml declares that this build doesn't
# recognize. A PRESENT modules: block that simply lacks secure-development is
# fine (callers below tolerate that via has_module); an ABSENT modules: block
# or an unrecognized key never is — same two checks as sync/src/config.js's
# loadConfig, so an organizer's typo (or an empty event.yaml) doesn't
# silently no-op in one reader while crash-looping the other.
check_known_modules() {
  yaml_has_modules_block || { echo "event.yaml: modules.secure-development is required" >&2; return 1; }
  # Command substitution, not a process substitution feeding `while` — a
  # pipeline/redirect swallows the parser's exit status, and "could not parse"
  # must never be read as "no modules declared" (that is precisely how a flow-
  # style config used to provision nothing while reporting success).
  local keys k
  keys="$(yaml_module_keys)" || return 1
  while IFS= read -r k; do
    [ -n "$k" ] || continue
    case " $KNOWN_MODULES " in
      *" $k "*) ;;
      *) echo "event.yaml: unknown module: $k (known modules: $KNOWN_MODULES)" >&2; return 1 ;;
    esac
  done <<EOF
$keys
EOF
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
  check_known_modules || exit 1
  local org; org="$(yaml_org)"
  [ -n "$org" ] || { echo "event.yaml: github.org missing" >&2; exit 1; }

  # No secure-development module: there is nothing fork-based to provision
  # (quiz is scored entirely app-side). This is not an error — a module is
  # enabled by presence and disabled by omission — so report it and stop
  # before even resolving SCORE_IMAGE (the quiz-only path needs no scorer
  # image, and --dry-run must make zero gh/docker calls either way).
  if ! has_module secure-development; then
    echo "== event.yaml has no secure-development module — no provisioned content to fork; nothing to do."
    return 0
  fi

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
  check_known_modules || exit 1
  local org; org="$(yaml_org)"
  [ -n "$org" ] || { echo "event.yaml: github.org missing" >&2; exit 1; }

  # No secure-development module: nothing fork-based to render a scoring
  # workflow for. Not an error — same reasoning as cmd_org.
  if ! has_module secure-development; then
    echo "== event.yaml has no secure-development module — no provisioned content to render; nothing to do."
    return 0
  fi

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
#
# Only ever opens for an INTERACTIVE run. The --dry-run guards at each call
# site are not enough on their own: they stop the documented rehearsal path,
# but any other automated invocation — a test harness driving a real
# subcommand, a CI step, an agent running the script against a fixture config
# — would still pop real browser tabs on whoever's machine is running it.
# That happened: a run against the bats fixture org opened GitHub's App and
# OAuth creation pages for an org that does not exist.
#
# stdin is the right thing to test, not stdout: the prompts this accompanies
# are unusable without a terminal to answer them, so no-TTY means no human,
# means print the URL and let the caller decide. Set CTF_NO_BROWSER=1 to
# suppress it even when interactive.
open_url() {
  local target="$1"
  if [ -n "${CTF_NO_BROWSER:-}" ] || [ ! -t 0 ]; then
    echo "open this manually: $target"
    return 0
  fi
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
# Commas in the answer are treated as separators too: an organizer typing
# "alice, bob" at a space-separated prompt otherwise emitted `[alice,, bob]` —
# a flow sequence with a null item in it.
csv_of() {
  local out="" x
  for x in $(printf '%s' "$1" | tr ',' ' '); do
    if [ -n "$out" ]; then out="$out, $x"; else out="$x"; fi
  done
  printf '%s' "$out"
}

# Every target this build can provision, space-separated, read from
# targets.tsv — the same file prov_field/prov_repo_name validate against.
# Deliberately NOT a second hardcoded list: a target added to the TSV and not
# to the wizard's prompt is a target no organizer is ever offered.
all_targets() {
  local out="" t
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    out="$out${out:+ }$t"
  done < <(grep -v '^[[:space:]]*#' "$PROVENANCE_TSV" | cut -f1)
  printf '%s' "$out"
}

# Validate an answer to the "which modules" question. Every token must be a
# key from KNOWN_MODULES (the same list check_known_modules enforces on an
# existing file, mirroring sync/src/config.js) and at least ONE must be given
# — an event with no modules is not a thing, and all three readers reject a
# `modules:` block with no keys under it. Commas are tolerated ("quiz, x").
# Echoes the selection in KNOWN_MODULES order so the emitted file is
# deterministic regardless of how the answer was typed, and deduped.
wiz_modules() {
  local want k m out=""
  want="$(printf '%s' "$1" | tr ',' ' ')"
  for m in $want; do
    case " $KNOWN_MODULES " in
      *" $m "*) ;;
      *) echo "  unknown module: $m (known modules: $KNOWN_MODULES)" >&2; return 1 ;;
    esac
  done
  for k in $KNOWN_MODULES; do
    case " $want " in *" $k "*) out="$out${out:+ }$k" ;; esac
  done
  if [ -z "$out" ]; then
    echo "  at least one module must be enabled (known modules: $KNOWN_MODULES)" >&2
    return 1
  fi
  printf '%s' "$out"
}

# What to offer as the default answer to the modules question: whatever the
# existing event.yaml already declares (filtered to keys this build knows),
# otherwise secure-development. Re-running the wizard over a half-finished
# quiz-only config must not silently switch the organizer back to a module
# they deliberately did not pick. An unreadable file just falls back — the
# wizard is the one place that REWRITES event.yaml, so refusing to guess here
# would strand the organizer in the editor the wizard exists to replace.
wiz_module_default() {
  local keys k out=""
  if [ -f "$CONFIG" ]; then
    if keys="$(yaml_module_keys 2>/dev/null)"; then
      for k in $KNOWN_MODULES; do
        if printf '%s\n' "$keys" | grep -qx "$k"; then out="$out${out:+ }$k"; fi
      done
    fi
  fi
  if [ -z "$out" ]; then out="secure-development"; fi
  printf '%s' "$out"
}

# Render the event.yaml the wizard's answers describe, to stdout (so it can be
# diffed against setup/test/corpus/ in tests rather than only observed through
# a file the wizard wrote).
#
# Emits a block ONLY for the modules that were enabled, and only the keys each
# module actually has: secure-development carries targets + score_ingest; quiz
# and classic carry nothing — quiz's attempt cap and retry cooldown, and
# classic's submission cooldown, are runtime /admin settings in Redis, not
# build-time config, so there is nothing to ask for and nothing to write.
# Fails closed on an empty or unknown selection instead of emitting a
# `modules:` block with no keys under it, which every reader rejects.
#
# Args: name url dates org modules targets ingest admins
wiz_event_yaml() {
  local name="$1" url="$2" dates="$3" org="$4" mods="$5" targets="$6" ingest="$7" admins="$8" m
  if [ -z "$mods" ]; then
    echo "event.yaml: at least one module must be enabled (known modules: $KNOWN_MODULES)" >&2
    return 1
  fi
  printf 'event:\n  name: "%s"\n  url: %s\n%sgithub:\n  org: %s\nmodules:\n' \
    "$name" "$url" "$dates" "$org"
  for m in $mods; do
    case "$m" in
      secure-development)
        if [ -z "$targets" ]; then
          echo "event.yaml: secure-development needs at least one target" >&2
          return 1
        fi
        printf '  secure-development:\n    targets: [%s]\n    score_ingest: %s\n' \
          "$(csv_of "$targets")" "$ingest"
        ;;
      quiz) printf '  quiz: {}\n' ;;
      classic) printf '  classic: {}\n' ;;
      *) echo "event.yaml: unknown module: $m" >&2; return 1 ;;
    esac
  done
  # `admins:` only. Neither `hints:` nor `teams:` is emitted any more, because
  # nothing has ever read either one — `generate-event-config.mjs` mentions
  # neither word — and a key that cannot change the answer misleads whichever
  # value it carries. An organizer who wrote `hints: { enabled: false }` still
  # got hints; one who wrote `teams: { max_size: 6 }` still got a cap of 4.
  # Emitting `hints: { enabled: true }` had been an earlier attempt to stop the
  # key lying by agreeing with the app, which fixed the value and not the
  # problem.
  #
  # Where each setting actually lives:
  #   hints    on by default (hint-defaults.ts: HINT_DEFAULT_ENABLED), turned
  #            off in /admin — ADR 31.
  #   teams    always available; /admin opens and closes registration. The
  #            4-member cap is TEAM_MAX_MEMBERS in team-store.ts.
  #
  # A config written before this change still parses: the generator warns on
  # both keys rather than failing.
  printf 'admins: [%s]\n' "$(csv_of "$admins")"
}

# Is an existing event.yaml complete enough to skip the config questions? Org
# (checked by the caller) plus, when secure-development is enabled, a
# non-empty targets list. A quiz-only config HAS no targets by design —
# demanding them here made the wizard re-ask every single run and offer to
# overwrite a perfectly good quiz-only event.
wiz_config_complete() {
  local keys
  keys="$(yaml_module_keys 2>/dev/null)" || return 1
  printf '%s\n' "$keys" | grep -qx secure-development || return 0
  yaml_targets | grep -q .
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
  # The modules step 3 enabled, for the later steps to key off when there is no
  # written config to read them back from (--dry-run). Empty = never asked.
  WIZ_MODULES=""
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
  if [ -f "$CONFIG" ] && [ -n "$(yaml_org)" ] && wiz_config_complete; then
    echo "  ✅ $CONFIG (org: $(yaml_org))"
  else
    echo "  Answer a few questions to write $CONFIG (Enter accepts the [default])."
    local ev_name ev_org ev_admins ev_mods ev_reply ev_targets ev_url ev_ingest ev_start ev_end adm_default
    adm_default=""
    [ "$DRY_RUN" -eq 1 ] || adm_default="$(gh api user --jq .login 2>/dev/null || true)"
    wiz_ask ev_name    "Event name" "OWASP Chapter CTF"
    wiz_ask ev_org     "GitHub org (disposable per-event org)" ""
    while [ "$DRY_RUN" -ne 1 ] && [ -z "$ev_org" ]; do
      echo "  org is required."
      wiz_ask ev_org   "GitHub org (disposable per-event org)" ""
    done
    wiz_ask ev_admins  "Admin GitHub login(s), space-separated" "$adm_default"
    # WHICH modules the event runs decides what else there is to ask: a module
    # is enabled by appearing under modules: (docs/modules.md §1), so this one
    # answer is the whole shape of the file. Re-asked until it names at least
    # one known module; under --dry-run the default always is one, so this
    # cannot spin.
    ev_mods=""
    while [ -z "$ev_mods" ]; do
      wiz_ask ev_reply "Modules to enable — subset of: $KNOWN_MODULES" "$(wiz_module_default)"
      if ! ev_mods="$(wiz_modules "$ev_reply")"; then
        ev_mods=""
        if [ "$DRY_RUN" -eq 1 ]; then exit 1; fi
      fi
    done
    WIZ_MODULES="$ev_mods"
    # Only secure-development has anything else to configure. A quiz-only event
    # is never asked for targets it will never fork, and quiz's own knobs (max
    # attempts, retry cooldown) are runtime /admin settings, not event.yaml.
    ev_targets=""; ev_ingest="poll"
    case " $ev_mods " in
      *" secure-development "*)
        wiz_ask ev_targets "Targets — subset of: $(all_targets)" "$(all_targets)"
        while [ "$DRY_RUN" -ne 1 ] && [ -z "$ev_targets" ]; do
          echo "  secure-development needs at least one target."
          wiz_ask ev_targets "Targets — subset of: $(all_targets)" "$(all_targets)"
        done
        wiz_ask ev_ingest  "Score ingest (poll | push)" "poll"
        ;;
    esac
    wiz_ask ev_url     "Event URL contestants reach" "$(env_val EVENT_URL)"
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
      echo "  DRY-RUN: would write $CONFIG (org: $ev_org, modules: $ev_mods)"
    else
      # Render to a temp file first: a redirect straight onto $CONFIG truncates
      # it BEFORE the emitter can refuse, which would leave an organizer with
      # an empty event.yaml where their old one used to be.
      if wiz_event_yaml "$ev_name" "$ev_url" "$ev_dates" "$ev_org" \
           "$ev_mods" "$ev_targets" "$ev_ingest" "$ev_admins" > "$CONFIG.tmp"; then
        mv "$CONFIG.tmp" "$CONFIG"
        echo "  ✅ wrote $CONFIG (org: $ev_org, modules: $ev_mods)"
      else
        rm -f "$CONFIG.tmp"
        echo "  Could not write $CONFIG — re-run the wizard." >&2
        exit 1
      fi
    fi
  fi
  local org=""; [ -f "$CONFIG" ] && org="$(yaml_org)"

  # Everything from here on that touches forks, the scorer image or the poll
  # App belongs to ONE module, secure-development. A quiz-only event has no
  # repos to fork, no image to build and nothing to poll, so those steps are
  # reported as not-applicable rather than asking an organizer for credentials
  # they will never use. Read from the config when there is one (the
  # authoritative answer, including on a resumed run) and otherwise from what
  # step 3 just collected; with neither — only reachable under --dry-run with
  # no config at all — assume the full poll stack, the historical default.
  local secdev=1
  if [ -f "$CONFIG" ]; then
    if ! has_module secure-development; then secdev=0; fi
  elif [ -n "$WIZ_MODULES" ]; then
    case " $WIZ_MODULES " in *" secure-development "*) ;; *) secdev=0 ;; esac
  fi

  # 4. Scorer image.
  wiz_step "4/8  Scorer image (SCORE_IMAGE)"
  if [ "$secdev" -eq 0 ]; then
    echo "  ⏭  not needed — no secure-development module (nothing to score in a fork)"
  elif [ -n "$(env_val SCORE_IMAGE)" ]; then
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
  if [ "$secdev" -eq 0 ]; then
    echo "  ⏭  not needed — no secure-development module (nothing to poll)"
  elif [ -n "$(env_val GITHUB_APP_ID)" ] && [ -n "$(env_val GITHUB_APP_PRIVATE_KEY)" ]; then
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
  if [ "$secdev" -eq 0 ]; then
    echo "  ⏭  nothing to provision — no secure-development module (no targets to fork)"
  elif [ -z "$(env_val SCORE_IMAGE)" ]; then
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
  #
  # Compose profiles follow the ENABLED MODULES: `app` always, plus the
  # score-ingest profile (poll or push — both carry the scorer, which belongs
  # to secure-development just as `sync` does) only when that module is
  # configured. A quiz-only event needs neither: it has nothing to poll and no
  # scorer image to pull, and asking for one would fail the bring-up outright.
  # `secdev` above is that answer, config-derived when a config exists and
  # answer-derived under --dry-run when one was never written.
  wiz_step "8/8  Bring the containers up"
  local profiles=(--profile app)
  if [ "$secdev" -eq 1 ]; then
    if [ "$(env_val SCORE_INGEST)" = "push" ]; then
      profiles=(--profile push "${profiles[@]}")
    else
      profiles=(--profile poll "${profiles[@]}")
    fi
  fi
  cat <<EOF
  EVENT_CONFIG_B64="\$(base64 < $CONFIG | tr -d '\n')" \\
    docker compose ${profiles[*]} up -d --build
EOF
  if ask_yn "  Bring the containers up now?" Y; then
    EVENT_CONFIG_B64="$(base64 < "$CONFIG" | tr -d '\n')" docker compose "${profiles[@]}" up -d --build
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
