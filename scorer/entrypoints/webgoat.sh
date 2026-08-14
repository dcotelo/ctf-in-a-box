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

    // register.mvc never throws on a bad response (fetch does not throw on non-2xx),
    // so a silent form/behaviour change upstream — an added CSRF field, a transient
    // 5xx, whatever — would otherwise log a status and fall through here believing
    // bring-up succeeded. Close the loop instead: prove the account can actually log
    // in, since every one of the 12 test files throws at loginWebGoat() before
    // registering a single test if it cannot. A silent failure here is the exact
    // vacuous zero this task exists to rule out — clean-looking 0/69, no non-zero
    // exit, no error line anywhere.
    const jar = new Map();
    const addCookies = (r) => { for (const h of r.headers.getSetCookie()) { const p = h.split(";")[0], i = p.indexOf("="); if (i > 0) jar.set(p.slice(0, i).trim(), p.slice(i + 1).trim()); } };
    const cookieHeader = () => [...jar].map(([k, v]) => k + "=" + v).join("; ");

    const loginGet = await get(B + "/login"); addCookies(loginGet);
    const loginPost = await get(B + "/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
      body: new URLSearchParams({ username: "webgoat", password: "webgoat" }).toString(),
    });
    addCookies(loginPost);
    const reportcard = await get(B + "/service/reportcard.mvc", { headers: { cookie: cookieHeader() } });
    const loggedIn = (loginPost.status === 302 || loginPost.status === 200) && reportcard.status === 200 && jar.has("JSESSIONID");
    if (!loggedIn) {
      console.error(`webgoat: scoring user cannot log back in after registration (login=${loginPost.status} reportcard=${reportcard.status}) — refusing to hand off to the judge`);
      process.exit(3);
    }
    console.log("webgoat: scoring user verified (register + login + reportcard all healthy)");

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

# Two lessons are not scored over HTTP: Log-Injection-Bleeding (Challenge-72) replays
# the admin password WebGoat logs at startup, and Insecure-Deserialization
# (Challenge-74) needs a gadget built against the exact class in the running jar.
# misc-lessons.test.js reads WEBGOAT_LEAKED_ADMIN_PW / WEBGOAT_DESER_PAYLOAD directly:
# an EMPTY value means "the exploit can't proceed -> patched" (an intentional early
# pass on a hardened app); an ABSENT one falls back to `docker ps --filter
# publish=8080`, which finds nothing here (this bring-up publishes no host port) and
# permanently fails both challenges regardless of patch state. So both are gathered
# here, over docker.sock, while the app is known-good, and ALWAYS exported — empty
# only when the recon genuinely finds nothing. Distilled from upstream's same
# bring-up script (score-webgoat-challenges.sh), substituting $APP_CONTAINER for its
# $APP_NAME.
LEAK_B64="$(docker logs "$APP_CONTAINER" 2>&1 | grep -oE 'Password for admin: *[A-Za-z0-9+/=]{20,}' | tail -1 | sed 's/.*: *//' || true)"
export WEBGOAT_LEAKED_ADMIN_PW="$(printf '%s' "$LEAK_B64" | base64 -d 2>/dev/null || true)"
if [ -n "$WEBGOAT_LEAKED_ADMIN_PW" ]; then
  echo "webgoat: recovered the leaked admin password from the container log"
else
  echo "webgoat: no admin password in the log — Challenge-72 scores as patched"
fi

GENB64='aW1wb3J0IGphdmEuaW8uKjsgaW1wb3J0IGphdmEudXRpbC5CYXNlNjQ7IGltcG9ydCBvcmcuZHVtbXkuaW5zZWN1cmUuZnJhbWV3b3JrLlZ1bG5lcmFibGVUYXNrSG9sZGVyOwpwdWJsaWMgY2xhc3MgR2VuIHsgcHVibGljIHN0YXRpYyB2b2lkIG1haW4oU3RyaW5nW10gYSkgdGhyb3dzIEV4Y2VwdGlvbiB7CiAgVnVsbmVyYWJsZVRhc2tIb2xkZXIgdCA9IG5ldyBWdWxuZXJhYmxlVGFza0hvbGRlcigiZGVsZXRlIiwgInNsZWVwIDUiKTsKICBCeXRlQXJyYXlPdXRwdXRTdHJlYW0gYiA9IG5ldyBCeXRlQXJyYXlPdXRwdXRTdHJlYW0oKTsKICBPYmplY3RPdXRwdXRTdHJlYW0gbyA9IG5ldyBPYmplY3RPdXRwdXRTdHJlYW0oYik7IG8ud3JpdGVPYmplY3QodCk7IG8uZmx1c2goKTsKICBTeXN0ZW0ub3V0LnByaW50bG4oQmFzZTY0LmdldEVuY29kZXIoKS5lbmNvZGVUb1N0cmluZyhiLnRvQnl0ZUFycmF5KCkpKTsgfSB9'
export WEBGOAT_DESER_PAYLOAD="$(docker exec -e GENB64="$GENB64" "$APP_CONTAINER" sh -c 'cd /tmp && rm -rf wgd && mkdir wgd && cd wgd && jar xf /home/webgoat/webgoat.jar BOOT-INF/classes/org/dummy/insecure/framework/VulnerableTaskHolder.class 2>/dev/null; SLF4J=$(jar tf /home/webgoat/webgoat.jar | grep -i slf4j-api | head -1); jar xf /home/webgoat/webgoat.jar "$SLF4J" 2>/dev/null; CP="BOOT-INF/classes:$SLF4J"; echo "$GENB64" | base64 -d > Gen.java; javac -cp "$CP" Gen.java 2>/dev/null; java -cp "$CP:." Gen 2>/dev/null' 2>/dev/null | tail -1 || true)"
if [ -n "$WEBGOAT_DESER_PAYLOAD" ]; then
  echo "webgoat: built the deserialization gadget from the running jar"
else
  echo "webgoat: could not build the gadget — Challenge-74 scores as patched"
fi
