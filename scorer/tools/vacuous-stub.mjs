// A target that is UP but USELESS — the shape a vacuous rubric pass hides in.
//
// The stock-scores-zero invariant catches a rubric that scores points against a
// genuinely unpatched app. It cannot catch a rubric that scores points against
// an app that never did anything: a "pass-on-patch" test asserts the exploit is
// BLOCKED, and an app that answers nothing blocks every exploit trivially. That
// test then reports a solve for a security property nobody verified.
//
// A fully DOWN target is the easy case and is already handled: every target's
// helpers open with a `waitFor…()` that polls until the app answers, so an
// unreachable target throws at module load and fails the whole file loudly.
// The dangerous case is the one in between — reachable, health check green,
// but the endpoint under test degraded or the fixture data missing. That is
// exactly what bit Challenge-7-Weak-JWT: the app was up, the admin account was
// missing after a seeding race, `/me` could not report admin for anyone, and
// "the forged token is not admin" passed for entirely the wrong reason.
//
// So: answer the health probe, then refuse to be a real app. Any challenge that
// still reports a PASS against this is asserting nothing about the target.

import { createServer } from "node:http";

/** Paths a target's `waitFor…()` health probe is likely to poll. Kept generous
 *  on purpose: if the probe never goes green the file dies at import and the
 *  challenge reports a fail, which is a MISSED detection rather than a false
 *  one — the sweep would simply learn nothing about that challenge. */
const HEALTH_PATHS = new Set(["/", "/index.php", "/login.jsp", "/WebGoat", "/VulnerableApp"]);

const isHealth = (pathname) =>
  HEALTH_PATHS.has(pathname) || pathname === "" || /^\/(health|healthz|ping|status)$/.test(pathname);

/**
 * Personalities. Each answers the health probe 200 so the target reads as UP,
 * then degrades everything else a different way — because "useless" has more
 * than one shape and a rubric can be accidentally satisfied by any of them.
 *
 *   empty-200     every request 200 with an empty JSON body. The closest
 *                 analogue to the real Weak-JWT failure: the app answers, the
 *                 oracle is simply not there. Catches assertions that only
 *                 check "the exploit payload is absent from the body".
 *   not-found     404 to everything but the probe. Catches assertions phrased
 *                 as "the vulnerable endpoint must not return 200".
 *   server-error  500 to everything but the probe. Catches assertions that
 *                 treat any non-200 as "the vulnerability is fixed".
 */
export const PERSONALITIES = {
  "empty-200": () => ({ status: 200, body: "{}", type: "application/json" }),
  "not-found": (isProbe) =>
    isProbe
      ? { status: 200, body: "{}", type: "application/json" }
      : { status: 404, body: "not found", type: "text/plain" },
  "server-error": (isProbe) =>
    isProbe
      ? { status: 200, body: "{}", type: "application/json" }
      : { status: 500, body: "internal error", type: "text/plain" },
};

export const PERSONALITY_NAMES = Object.keys(PERSONALITIES);

/**
 * Starts a stub on an ephemeral port. Returns `{ url, requests, close }`.
 *
 * `requests` counts what the rubric actually asked for. It is the difference
 * between "this challenge passed because the assertion is weak" and "this
 * challenge passed without issuing a single request", and the sweep reports
 * the two separately — the second is a worse bug wearing the same result.
 */
export async function startStub(personality = "empty-200") {
  const respond = PERSONALITIES[personality];
  if (!respond) throw new Error(`unknown personality: ${personality}`);

  let requests = 0;
  const server = createServer((req, res) => {
    let pathname = req.url ?? "/";
    const q = pathname.indexOf("?");
    if (q !== -1) pathname = pathname.slice(0, q);
    const probe = isHealth(pathname);
    if (!probe) requests += 1;

    const { status, body, type } = respond(probe);
    // Permissive CORS and no-cache so nothing is refused or served stale for a
    // reason unrelated to what the sweep is measuring.
    res.writeHead(status, {
      "content-type": type,
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    // Drain the request body first: a rubric POSTing a payload to a server that
    // never reads it can stall behind backpressure instead of getting an answer.
    req.resume();
    res.end(body);
  });

  // Keep-alive would hold the rubric's child process open past its last
  // assertion, and the exec runner reads a completion marker the child only
  // emits as it exits — a held-open socket looks exactly like a hung target.
  server.keepAliveTimeout = 1;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    get requests() {
      return requests;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}
