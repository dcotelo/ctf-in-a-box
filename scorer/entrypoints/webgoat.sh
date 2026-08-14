# scorer/entrypoints/webgoat.sh
# WebGoat bring-up. Sourced by entrypoint.sh.
#
# APP_IMAGE only: a WebGoat fork's Maven build does not fit a stock runner's
# timeout budget (docs/scorer.md, "Booting hard targets"), so organizers publish
# a prebuilt patched image per PR instead of building from source here.
#
# WebGoat serves under a /WebGoat context path and takes ~60s to become ready.
# It also ships NO default user: the rubric's helpers.js logs in as webgoat/
# webgoat, and without registering that account first, EVERY login-based lesson
# throws before it even attempts its exploit — a top-level exception in every
# child, which would zero the whole target regardless of patch state (the same
# failure shape as the force-exit bug this rubric exists to catch, just from a
# missing account instead of a torn-down child). Distilled from the upstream
# reference bring-up (.github/actions/ctf-score/entrypoints/
# score-webgoat-challenges.sh), which documents and solves the same problem.
#
# WebWolf (the companion callback server some lessons need) shares this same
# container on :9090 — no extra container, just a second URL to export.
: "${APP_IMAGE:?webgoat: APP_IMAGE is required (a Maven source build will not fit the runner budget)}"

docker pull "$APP_IMAGE" >/dev/null
docker run -d --rm \
  --network "$NETWORK" \
  --network-alias "$APP_HOST" \
  --name "$APP_CONTAINER" \
  -e WEBGOAT_HOST=0.0.0.0 \
  -e WEBGOAT_PORT=8080 \
  "$APP_IMAGE" >/dev/null
BOOTED="$APP_CONTAINER"

export WEBWOLF_URL="http://$APP_HOST:9090/WebWolf"

echo "webgoat: waiting for the app, then registering the scoring user…"
APP_URL="$APP_URL" WEBWOLF_URL="$WEBWOLF_URL" node -e '
  const B = process.env.APP_URL;
  const W = process.env.WEBWOLF_URL;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const get = (u, o = {}) => fetch(u, { redirect: "manual", signal: AbortSignal.timeout(8000), ...o });
  (async () => {
    let up = false;
    for (let i = 0; i < 60; i++) {
      try {
        if ((await get(B + "/login")).ok) { up = true; console.log("WebGoat ready after " + i + " attempt(s)"); break; }
      } catch {}
      await sleep(2000);
    }
    if (!up) { console.error("WebGoat never served /login"); process.exit(2); }

    // Idempotent: 200 (already exists) or 302 (created) are both fine.
    const body = new URLSearchParams({ username: "webgoat", password: "webgoat", matchingPassword: "webgoat", agree: "agree" });
    const reg = await get(B + "/register.mvc", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
    console.log("register.mvc -> " + reg.status);

    for (let i = 0; i < 30; i++) {
      try {
        const r = await get(W + "/");
        if (r.status === 200 || r.status === 302) { console.log("WebWolf ready"); process.exit(0); }
      } catch {}
      await sleep(2000);
    }
    console.log("webgoat: WebWolf never answered — lessons that depend on it will fail to exploit.");
  })();
'
