#!/usr/bin/env bash
# Offline e2e for the in-repo scorer engine (scorer/): build the image with the
# default example rubric, boot `score serve` + a tiny fake target app, then run
# the judge entrypoint exactly the way the consumer workflow / score-action
# does (entrypoint override, docker.sock, workspace + event.json mounts).
#
# The fake app deliberately PASSES two example-rubric challenges and FAILS one,
# so the asserted "2 / 3" count proves the probes actually discriminate — an
# all-pass or all-fail app could green-light a judge that ignores its rubric.
# A second, "stock" fake app then fails EVERY probe (unpatched behaviour) and
# the asserted "0 / 3" plus its absence from the leaderboard proves the
# stock-scores-zero invariant (docs/modules.md §6.4) mechanically.
#
# Asserts, against the real artifacts (no mocks on the scorer side):
#   - ctf-score.md carries the two score-action regexes verbatim
#     (title line + "**N / M** challenges patched") with the expected N/M
#   - oracle discipline: no probe path/expect string from the rubric leaks
#   - the sync marker parses via the REAL sync/src/parse.js import
#   - push mode: POST /score landed (no not-recorded marker) and
#     GET /leaderboard shows rubric-derived points and totals
#   - poll mode (no SCORE_API): marker still present, still no not-recorded
# Needs Docker only; the sole network access is pulling node:22-alpine.
set -euo pipefail
cd "$(dirname "$0")/.."

IMG=ctf-score:acceptance
NET=ctf-scorer-acceptance
SERVE_CTR=ctf-scorer-acceptance-serve
APP_CTR=ctf-scorer-acceptance-app
STOCK_CTR=ctf-scorer-acceptance-stock
SERVE_PORT=4102
TMP=$(mktemp -d /tmp/ctf-scorer-acceptance.XXXXXX)
WS_PUSH="$TMP/workspace-push"
WS_POLL="$TMP/workspace-poll"
WS_STOCK="$TMP/workspace-stock"
mkdir -p "$WS_PUSH" "$WS_POLL" "$WS_STOCK"

cleanup() {
  docker rm -f "$SERVE_CTR" "$APP_CTR" "$STOCK_CTR" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker rmi "$IMG" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

# Fabricated pull_request webhook payload — the judge reads author/pr/sha
# from it (readEvent), exactly what Actions mounts at /github/event.json.
cat > "$TMP/event.json" <<'JSON'
{ "pull_request": { "number": 7, "user": { "login": "octocat" }, "head": { "sha": "deadbeefcafe" } } }
JSON

# Fake target app, judged against scorer/rubric.example/juice-shop.yaml:
#   reflected-xss-search  PASS (200, payload not echoed back)
#   sqli-login-bypass     PASS (login answers 401)
#   confidential-ftp-doc  FAIL (still serves the document with a 200)
APP_JS=$(cat <<'JS'
require("node:http").createServer((req, res) => {
  const url = req.url || "";
  if (url.startsWith("/rest/products/search")) { res.writeHead(200); res.end("[]"); return; }
  if (url === "/rest/user/login") { res.writeHead(401); res.end("Invalid credentials"); return; }
  if (url === "/ftp/acquisitions.md") { res.writeHead(200); res.end("unpatched: still serving acquisitions"); return; }
  res.writeHead(200); res.end("ok");
}).listen(3000, () => console.error("fake target app on :3000"));
JS
)

echo "--- build scorer image (default example rubric)"
docker build -t "$IMG" scorer/

docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null

echo "--- boot score serve (memory store) + fake target app"
docker run -d --name "$SERVE_CTR" --network "$NET" \
  -p "127.0.0.1:$SERVE_PORT:4000" -e SCORER_TOKEN=test-token "$IMG" >/dev/null
docker run -d --name "$APP_CTR" --network "$NET" \
  node:22-alpine node -e "$APP_JS" >/dev/null

deadline=$((SECONDS + 60))
until curl -sf "http://127.0.0.1:$SERVE_PORT/healthz" >/dev/null 2>&1; do
  [ "$SECONDS" -ge "$deadline" ] && { echo "FAIL: score serve never came up"; exit 1; }
  sleep 1
done

echo "--- run judge (push mode: SCORE_API set) via the score-action contract"
# No --network on purpose: score-action starts the scorer on the default
# bridge and the entrypoint must self-attach to $NET over docker.sock.
docker run --rm \
  --entrypoint /usr/local/bin/entrypoint.sh \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$WS_PUSH:/github/workspace" \
  -v "$TMP/event.json:/github/event.json:ro" \
  -e TARGET=juice-shop \
  -e APP_URL="http://$APP_CTR:3000" \
  -e NETWORK="$NET" \
  -e GITHUB_WORKSPACE=/github/workspace \
  -e GITHUB_EVENT_PATH=/github/event.json \
  -e APP_READY_TRIES=15 -e APP_READY_DELAY=1 \
  -e SCORE_API="http://$SERVE_CTR:4000" \
  -e SCORE_TOKEN=test-token \
  "$IMG"

REPORT="$WS_PUSH/ctf-score.md"
[ -f "$REPORT" ] || { echo "FAIL: judge wrote no ctf-score.md"; exit 1; }

echo "--- report carries the score-action regexes with the expected count"
grep -qF '## 🏆 CTF Patch Score' "$REPORT"
grep -qF '**2 / 3** challenges patched' "$REPORT"

echo "--- oracle discipline: no probe internals leak into the comment"
for secret in '/rest/products/search' 'alert(1)' '/rest/user/login' '/ftp/acquisitions.md' 'bodyMissing'; do
  if grep -qF "$secret" "$REPORT"; then
    echo "FAIL: probe internal '$secret' leaked into ctf-score.md"; exit 1
  fi
done

echo "--- sync marker parses via the real sync/src/parse.js"
node -e '
const { readFileSync } = require("node:fs");
import("./sync/src/parse.js").then(({ parseScoreComment }) => {
  const body = readFileSync(process.argv[1], "utf8");
  const r = parseScoreComment(body, { targets: ["juice-shop"] });
  if (!r) { console.error("FAIL: marker did not parse"); process.exit(1); }
  const solved = [...r.solved].sort().join(",");
  if (r.author !== "octocat" || r.target !== "juice-shop" || r.pr !== 7 ||
      r.sha !== "deadbeefcafe" || solved !== "reflected-xss-search,sqli-login-bypass") {
    console.error("FAIL: unexpected parse result: " + JSON.stringify(r)); process.exit(1);
  }
  console.log("marker ok: " + JSON.stringify(r));
}).catch((e) => { console.error(e); process.exit(1); });
' "$REPORT"

echo "--- push landed: no not-recorded marker"
if grep -qF '<!-- ctf-score:not-recorded -->' "$REPORT"; then
  echo "FAIL: push mode appended the not-recorded marker"; exit 1
fi

echo "--- leaderboard shows octocat with rubric-derived points/totals"
curl -sf "http://127.0.0.1:$SERVE_PORT/leaderboard" | node -e '
let s = "";
process.stdin.on("data", (c) => (s += c)).on("end", () => {
  const { leaderboard } = JSON.parse(s);
  const e = leaderboard && leaderboard[0];
  if (!e || leaderboard.length !== 1 || e.rank !== 1 || e.author !== "octocat" ||
      e.points !== 20 ||
      !e.apps || !e.apps["juice-shop"] ||
      e.apps["juice-shop"].solved !== 2 || e.apps["juice-shop"].total !== 3) {
    console.error("FAIL: unexpected leaderboard: " + s); process.exit(1);
  }
  console.log("leaderboard ok: " + s);
});
'

echo "--- stock-scores-zero (modules.md 6.4): judge an unpatched fake app"
# Second webhook payload: a different author, so the leaderboard check below
# can prove the stock run recorded nothing for them specifically.
cat > "$TMP/event-stock.json" <<'JSON'
{ "pull_request": { "number": 8, "user": { "login": "mallory" }, "head": { "sha": "0000000000ck" } } }
JSON

# "Stock" fake app: hits every example-rubric probe's FAIL branch —
#   reflected-xss-search  FAIL (200 but the payload is echoed back verbatim)
#   sqli-login-bypass     FAIL (200 + token: the SQLi bypass still logs in)
#   confidential-ftp-doc  FAIL (200: the document is still served)
STOCK_APP_JS=$(cat <<'JS'
require("node:http").createServer((req, res) => {
  const url = req.url || "";
  if (url.startsWith("/rest/products/search")) { res.writeHead(200); res.end("<h1>Results for <script>alert(1)</script></h1>"); return; }
  if (url === "/rest/user/login") { res.writeHead(200); res.end('{"authentication":{"token":"stock-jwt"}}'); return; }
  if (url === "/ftp/acquisitions.md") { res.writeHead(200); res.end("top secret acquisitions"); return; }
  res.writeHead(200); res.end("ok");
}).listen(3000, () => console.error("stock fake app on :3000"));
JS
)
docker run -d --name "$STOCK_CTR" --network "$NET" \
  node:22-alpine node -e "$STOCK_APP_JS" >/dev/null

docker run --rm \
  --entrypoint /usr/local/bin/entrypoint.sh \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$WS_STOCK:/github/workspace" \
  -v "$TMP/event-stock.json:/github/event.json:ro" \
  -e TARGET=juice-shop \
  -e APP_URL="http://$STOCK_CTR:3000" \
  -e NETWORK="$NET" \
  -e GITHUB_WORKSPACE=/github/workspace \
  -e GITHUB_EVENT_PATH=/github/event.json \
  -e APP_READY_TRIES=15 -e APP_READY_DELAY=1 \
  -e SCORE_API="http://$SERVE_CTR:4000" \
  -e SCORE_TOKEN=test-token \
  "$IMG"

STOCK_REPORT="$WS_STOCK/ctf-score.md"
[ -f "$STOCK_REPORT" ] || { echo "FAIL: stock judge wrote no ctf-score.md"; exit 1; }
grep -qF '**0 / 3** challenges patched' "$STOCK_REPORT"
if grep -qF '<!-- ctf-score:not-recorded -->' "$STOCK_REPORT"; then
  echo "FAIL: stock run's empty-solve push must still be recorded (202)"; exit 1
fi

echo "--- leaderboard: the stock author gained nothing (zero/absent entry)"
curl -sf "http://127.0.0.1:$SERVE_PORT/leaderboard" | node -e '
let s = "";
process.stdin.on("data", (c) => (s += c)).on("end", () => {
  const { leaderboard } = JSON.parse(s);
  const mallory = leaderboard.find((e) => e.author === "mallory");
  if (mallory && (mallory.points !== 0 || mallory.apps["juice-shop"].solved !== 0)) {
    console.error("FAIL: stock target handed out points: " + s); process.exit(1);
  }
  if (leaderboard.length !== 1 || leaderboard[0].author !== "octocat") {
    console.error("FAIL: unexpected leaderboard after stock run: " + s); process.exit(1);
  }
  console.log("stock-zero ok: " + s);
});
'

echo "--- run judge again in poll mode (no SCORE_API): marker only, no push"
docker run --rm \
  --entrypoint /usr/local/bin/entrypoint.sh \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$WS_POLL:/github/workspace" \
  -v "$TMP/event.json:/github/event.json:ro" \
  -e TARGET=juice-shop \
  -e APP_URL="http://$APP_CTR:3000" \
  -e NETWORK="$NET" \
  -e GITHUB_WORKSPACE=/github/workspace \
  -e GITHUB_EVENT_PATH=/github/event.json \
  -e APP_READY_TRIES=15 -e APP_READY_DELAY=1 \
  "$IMG"

POLL_REPORT="$WS_POLL/ctf-score.md"
grep -qF '**2 / 3** challenges patched' "$POLL_REPORT"
grep -qF '<!-- ctf-score: ' "$POLL_REPORT"
if grep -qF '<!-- ctf-score:not-recorded -->' "$POLL_REPORT"; then
  echo "FAIL: poll mode (no SCORE_API) must not mark not-recorded"; exit 1
fi

echo "ACCEPTANCE PASS"
