/**
 * WebGoat test helpers — session management, HTTP fetch, and assignment-status checks.
 *
 * WebGoat is an intentionally vulnerable Spring Boot app. Auth is a single form-login at
 * /WebGoat/login that issues a JSESSIONID cookie. Every assignment endpoint returns an
 * AttackResult JSON ({ lessonCompleted, feedback, ... }) and the per-lesson solved state is
 * exposed at /WebGoat/service/lessonoverview.mvc/{LessonClass}.
 *
 * Tests follow the WebGoat "pass-when-exploitable" contract: a test passes when the exploit
 * marks the assignment solved (lessonCompleted: true / solved: true) against the live target.
 */

const BASE = (process.env.WEBGOAT_URL ?? 'http://localhost:8080/WebGoat').replace(/\/$/, '');
const WEBWOLF = (process.env.WEBWOLF_URL ?? 'http://localhost:9090/WebWolf').replace(/\/$/, '');
const DEFAULT_USER = process.env.WEBGOAT_USER ?? 'webgoat';
const DEFAULT_PASS = process.env.WEBGOAT_PASS ?? 'webgoat';

export { BASE, WEBWOLF };

// ── health check ──────────────────────────────────────────────────────────────

export async function waitForWebGoat({ timeoutMs = 120_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.status === 200) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`WebGoat did not become healthy within ${timeoutMs}ms — last error: ${lastErr}`);
}

export async function webWolfAvailable() {
  try {
    const res = await fetch(`${WEBWOLF}/`, { redirect: 'manual' });
    return res.status === 200 || res.status === 302;
  } catch {
    return false;
  }
}

// ── cookie jar ────────────────────────────────────────────────────────────────

class CookieJar {
  #cookies = new Map();

  add(res) {
    const list = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const header of list) {
      const pair = header.split(';')[0].trim();
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const name = pair.substring(0, eqIdx).trim();
      const value = pair.substring(eqIdx + 1).trim();
      this.#cookies.set(name, value);
    }
  }

  build() {
    return [...this.#cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get(name) { return this.#cookies.get(name) ?? ''; }
  set(name, value) { this.#cookies.set(name, value); }
  erase(name) { this.#cookies.delete(name); }
}

// ── authentication ────────────────────────────────────────────────────────────

/**
 * Log in to WebGoat. Returns { jsessionid, cookieHeader, jar } where cookieHeader is a live
 * getter that reflects later jar mutations.
 */
export async function loginWebGoat({ username = DEFAULT_USER, password = DEFAULT_PASS } = {}) {
  const jar = new CookieJar();

  // GET /login establishes the initial JSESSIONID (Spring Security login form, no CSRF token
  // on this build).
  const getRes = await fetch(`${BASE}/login`, { redirect: 'manual' });
  jar.add(getRes);

  const body = new URLSearchParams({ username, password });
  const postRes = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar.build() },
    body: body.toString(),
    redirect: 'manual',
  });
  jar.add(postRes);

  if (postRes.status !== 302 && postRes.status !== 200) {
    throw new Error(`WebGoat login POST returned ${postRes.status}`);
  }

  // Verify the session is authenticated: reportcard returns JSON for a live session.
  const check = await fetch(`${BASE}/service/reportcard.mvc`, {
    headers: { Cookie: jar.build() },
    redirect: 'manual',
  });
  if (check.status !== 200) {
    throw new Error(`WebGoat login failed — reportcard returned ${check.status}`);
  }

  const jsessionid = jar.get('JSESSIONID');
  if (!jsessionid) throw new Error('No JSESSIONID after WebGoat login');

  return {
    jsessionid,
    jar,
    get cookieHeader() { return jar.build(); },
  };
}

// ── fetch wrapper ─────────────────────────────────────────────────────────────

/**
 * Fetch wrapper that injects the session cookie. Returns { status, json, text, headers }.
 *
 * @param path     Path relative to the WebGoat base (e.g. "/SqlInjection/attack2"), or an
 *                 absolute http(s) URL for cross-origin requests (CSRF / WebWolf).
 * @param body     URLSearchParams | FormData | string | object. Objects are JSON-encoded.
 */
export async function wgFetch(path, { cookies, method = 'GET', body, headers: extraHeaders } = {}) {
  const url = /^https?:\/\//.test(path) ? path : `${BASE}${path}`;
  const jar = cookies?.jar;
  const cookieHeader = jar ? jar.build() : (cookies?.cookieHeader ?? '');

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const isParams = body instanceof URLSearchParams;
  const isPlainObject = body != null && !isFormData && !isParams && typeof body === 'object'
    && !(body instanceof ArrayBuffer) && !(typeof Buffer !== 'undefined' && body instanceof Buffer);

  let outBody;
  let autoHeader = {};
  if (body == null) {
    outBody = undefined;
  } else if (isFormData) {
    outBody = body; // fetch sets its own multipart boundary
  } else if (isParams) {
    outBody = body.toString();
    autoHeader = { 'Content-Type': 'application/x-www-form-urlencoded' };
  } else if (isPlainObject) {
    outBody = JSON.stringify(body);
    autoHeader = { 'Content-Type': 'application/json' };
  } else {
    outBody = body; // string / buffer — caller sets Content-Type
  }

  const res = await fetch(url, {
    method,
    headers: { ...(cookieHeader ? { Cookie: cookieHeader } : {}), ...autoHeader, ...extraHeaders },
    ...(outBody != null ? { body: outBody } : {}),
    redirect: 'manual',
  });
  if (jar) jar.add(res);

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text, headers: res.headers };
}

// ── assignment status ─────────────────────────────────────────────────────────

/**
 * GET /service/lessonoverview.mvc/{lessonClass} and return whether the assignment whose path
 * ends with assignmentPath is solved. assignmentPath may be the full path
 * ("/WebGoat/SqlInjection/attack2") or a suffix ("SqlInjection/attack2").
 */
export async function isAssignmentSolved(cookies, lessonClass, assignmentPath) {
  const res = await wgFetch(`/service/lessonoverview.mvc/${lessonClass}`, { cookies });
  if (!Array.isArray(res.json)) return false;
  const match = res.json.filter((entry) => {
    const p = entry?.assignment?.path ?? '';
    return p === assignmentPath || p.endsWith(assignmentPath);
  });
  // When several assignments share a path (WebGoat reuses {userId}), require all solved.
  if (match.length === 0) return false;
  return match.every((entry) => entry.solved === true);
}

/** Convenience: assert (boolean) that lessonCompleted is true on an AttackResult response. */
export function lessonCompleted(res) {
  return res?.json?.lessonCompleted === true;
}
