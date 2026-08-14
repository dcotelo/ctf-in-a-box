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
