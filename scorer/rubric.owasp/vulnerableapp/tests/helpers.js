/**
 * VulnerableApp test helpers — health check and HTTP fetch wrapper.
 *
 * BASE points at the nginx facade by default; override with VULNERABLEAPP_URL.
 */

const BASE = process.env.VULNERABLEAPP_URL ?? 'http://localhost/VulnerableApp';

// ── health check ──────────────────────────────────────────────────────────────

export async function waitForVulnerableApp({ timeoutMs = 120_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/allEndPointJson`);
      if (res.status === 200) return;
      lastErr = new Error(`status ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`VulnerableApp did not become healthy within ${timeoutMs}ms — last error: ${lastErr}`);
}

// ── fetch wrapper ─────────────────────────────────────────────────────────────

/**
 * Fetch a VulnerableApp endpoint.
 *
 * @param {string} path  e.g. '/AuthenticationVulnerability/LEVEL_1'
 * @param {object} opts
 * @param {string} [opts.method]        HTTP method (default GET)
 * @param {object} [opts.params]        query-string params
 * @param {*}      [opts.body]          request body (object => JSON, string => raw, URLSearchParams/FormData passthrough)
 * @param {object} [opts.headers]       extra headers
 * @param {boolean}[opts.json]          send body as JSON (default true for plain objects)
 * @param {string} [opts.redirect]      fetch redirect mode (default 'follow')
 * @returns {Promise<{status:number,json:any,text:string,headers:Headers}>}
 */
export async function vaFetch(path, {
  method = 'GET',
  params,
  body,
  headers = {},
  json = true,
  redirect = 'follow',
} = {}) {
  const url = new URL(BASE + path);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const isParams = body instanceof URLSearchParams;
  const isString = typeof body === 'string';

  let outBody;
  const outHeaders = { ...headers };
  if (body != null) {
    if (isForm) {
      outBody = body; // fetch sets multipart boundary
    } else if (isParams) {
      outBody = body.toString();
      if (!outHeaders['Content-Type']) outHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (isString) {
      outBody = body;
    } else if (json) {
      outBody = JSON.stringify(body);
      if (!outHeaders['Content-Type']) outHeaders['Content-Type'] = 'application/json';
    } else {
      outBody = body;
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: outHeaders,
    ...(outBody != null ? { body: outBody } : {}),
    redirect,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json: parsed, text, headers: res.headers };
}

// ── anti-vacuous preconditions ────────────────────────────────────────────────
//
// Almost every check here is phrased pass-on-patch: drive the exploit, assert
// the exploit signal is ABSENT. An app that answers nothing satisfies that for
// free, so the check reports a solve for a property nobody verified — see
// docs/scorer.md, "The vacuous pass", and issue #47.
//
// The guards below prove the endpoint actually answered in its own contract
// BEFORE the absence assertion is trusted. Both hold on the vulnerable app and
// on a patched one: a patch changes the VALUE the endpoint returns, not the
// shape of its response. Verified against the real stock image
// (sasanlabs/owasp-vulnerableapp:2.1.37) and against the reference patch in
// patches/vulnerableapp/, which rewrites a query and leaves the envelope alone.

/**
 * VulnerableApp answers most levels with a uniform envelope,
 * `{"content": ..., "isValid": <bool>}` — `isValid` reports whether the
 * submitted input satisfied the level. Its PRESENCE is the liveness signal:
 * a degraded or empty response has no `isValid` at all, so the exploit could
 * not have been evaluated and the absence assertion below means nothing.
 *
 * Deliberately asserts presence and type, never a particular value — the value
 * is exactly what a patch is supposed to change.
 */
export function assertLevelResponded(res, what = 'endpoint') {
  if (typeof res?.json?.isValid !== 'boolean') {
    throw new Error(
      `anti-vacuous precondition failed: ${what} did not return VulnerableApp's ` +
        `{content, isValid} envelope (status ${res?.status}, body ${JSON.stringify(res?.text)?.slice(0, 200)}). ` +
        `Without it the exploit was never evaluated, so "the exploit was blocked" proves nothing.`,
    );
  }
}

/**
 * The redirect levels answer with a 3xx and a Location header rather than the
 * JSON envelope. A patched app still redirects — it redirects somewhere SAFE —
 * so "is a redirect at all" is the liveness signal, and asserting the header's
 * absence-of-attacker-host is only meaningful once a header exists.
 */
export function assertRedirected(res, what = 'endpoint') {
  const location = res?.headers?.get?.('location');
  if (!(res?.status >= 300 && res?.status < 400) || !location) {
    throw new Error(
      `anti-vacuous precondition failed: ${what} did not redirect (status ${res?.status}, ` +
        `location ${JSON.stringify(location)}). A response with no Location header trivially ` +
        `satisfies "must not redirect to the attacker host".`,
    );
  }
}

/**
 * The weaker sibling of `assertLevelResponded`, for levels that do NOT answer
 * with the {content, isValid} envelope — the SQL-injection levels return
 * `{isCarPresent, carInformation}`, the img-attribute and persistent-XSS levels
 * return raw HTML fragments.
 *
 * There is no single oracle field to check on those, so this asserts the weaker
 * but still decisive property: the app returned a real answer rather than
 * nothing. An empty body, or the empty JSON object a degraded service hands
 * back, is not an answer — and an assertion of the form "the exploit's output
 * is absent" is satisfied for free by both.
 *
 * Verified against the real stock image: every level in scope returns either a
 * populated JSON object or a non-empty HTML fragment.
 */
export function assertAnswered(res, what = 'endpoint') {
  const emptyJson =
    res?.json && typeof res.json === 'object' && Object.keys(res.json).length === 0;
  if (res?.status !== 200 || !res?.text?.trim() || emptyJson) {
    throw new Error(
      `anti-vacuous precondition failed: ${what} did not return a real answer ` +
        `(status ${res?.status}, body ${JSON.stringify(res?.text)?.slice(0, 200)}). ` +
        `An empty response trivially satisfies "the exploit output is absent".`,
    );
  }
}
