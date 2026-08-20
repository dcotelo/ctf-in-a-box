/**
 * DVWA test helpers — session management, security-level control, and HTTP fetch.
 */

const BASE = process.env.DVWA_URL ?? 'http://localhost:4280';
const DEFAULT_USER = process.env.DVWA_USER ?? 'admin';
const DEFAULT_PASS = process.env.DVWA_PASS ?? 'password';

// ── health check ──────────────────────────────────────────────────────────────

export async function waitForDvwa({ timeoutMs = 120_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/login.php`);
      if (res.status === 200) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`DVWA did not become healthy within ${timeoutMs}ms — last error: ${lastErr}`);
}

// ── cookie jar ────────────────────────────────────────────────────────────────

class CookieJar {
  #cookies = new Map();

  add(res) {
    // Use getSetCookie() — it returns each Set-Cookie header as its own array entry.
    // headers.get('set-cookie') joins multiple cookies with ', ', which corrupts parsing
    // (e.g. PHPSESSID gets swallowed into the preceding cookie's value).
    const list = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const header of list) {
      const pair = header.split(';')[0].trim(); // name=value, drop attributes
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const name = pair.substring(0, eqIdx).trim();
      const value = pair.substring(eqIdx + 1).trim();
      this.#cookies.set(name, value);
    }
  }

  build() {
    return [...this.#cookies.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  erase(name) { this.#cookies.delete(name); }
  get(name) { return this.#cookies.get(name) ?? ''; }
  set(name, value) { this.#cookies.set(name, value); }
}

// ── redirect helper ───────────────────────────────────────────────────────────

/** Follow redirects, accumulating cookies along the way. */
async function followJars(path, jar, maxDepth = 10) {
  // Send the jar's cookies on every hop — without them an authenticated GET (e.g.
  // security.php) bounces to login.php and hands back a fresh unauthenticated PHPSESSID
  // that would clobber the real session. Capture any Set-Cookie along the way.
  const cookieHeaders = () => (jar ? { Cookie: jar.build() } : {});
  let depth = 0;
  let res = await fetch(new URL(path, BASE).href, { redirect: 'manual', headers: cookieHeaders() });
  if (jar) jar.add(res);

  while (res.status === 302 && ++depth < maxDepth) {
    const loc = res.headers.get('location');
    if (!loc) break;
    res = await fetch(new URL(loc, BASE).href, { redirect: 'manual', headers: cookieHeaders() });
    if (jar) jar.add(res);
  }

  return res;
}

// ── authentication ────────────────────────────────────────────────────────────

/**
 * Log in to DVWA and return an object holding the session cookies needed for
 * all subsequent requests.
 */
export async function loginDvwa({ url = BASE, username = DEFAULT_USER, password = DEFAULT_PASS } = {}) {
  const jar = new CookieJar();

  // GET /login.php — establishes PHPSESSID and exposes the anti-CSRF user_token that
  // DVWA's login.php requires. Without the token the POST is rejected and the session
  // stays unauthenticated (every later request silently redirects back to login).
  const getRes = await followJars(`${url}/login.php`, jar);
  const loginHtml = await getRes.text();
  const tokenMatch = loginHtml.match(/name=['"]user_token['"][^>]*value=['"]([^'"]+)['"]/);
  const userToken = tokenMatch ? tokenMatch[1] : '';

  // POST credentials with the established session cookie + the CSRF token.
  const body = new URLSearchParams({
    username, password, Login: 'Login',
    ...(userToken ? { user_token: userToken } : {}),
  });
  const postRes = await fetch(`${url}/login.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar.build() },
    body: body.toString(),
    redirect: 'manual',
  });

  // Accept 200 (direct) or 302 (redirect to index.php after login).
  if (postRes.status !== 302 && postRes.status !== 200) {
    throw new Error(`Login POST returned ${postRes.status}`);
  }

  jar.add(postRes); // capture any cookie the login response sets (the session id is already authed)

  // Do NOT follow the 302 to index.php here: followJars sends no Cookie header, so index.php
  // would bounce to login.php and hand us a FRESH unauthenticated PHPSESSID that clobbers the
  // authenticated session we just established. The authed session id is already in the jar.

  const phpsessid = jar.get('PHPSESSID');
  if (!phpsessid) throw new Error('No PHPSESSID after login');

  // Verify the session is actually authenticated — a failed login leaves us on login.php.
  // Failing loudly here avoids every downstream test misreporting (e.g. a patched-looking
  // "no leak" that is really just the login page). Must send the cookie jar (followJars does
  // NOT) — an authenticated index.php returns 200; otherwise DVWA 302-redirects to login.php.
  const check = await fetch(new URL('/index.php', url).href, {
    headers: { Cookie: jar.build() },
    redirect: 'manual',
  });
  const checkHtml = check.status === 200 ? await check.text() : '';
  if (check.status !== 200 || /Login :: Damn Vulnerable Web Application/i.test(checkHtml)) {
    throw new Error('DVWA login failed — session is not authenticated (check credentials / user_token)');
  }

  return {
    phpsessid,
    security: 'impossible',
    jar,
    // cookieHeader is a live getter (not stale) so jar.set() updates are reflected.
    get cookieHeader() { return jar.build(); },
  };
}

// ── security level ────────────────────────────────────────────────────────────

export async function setSecurityLevel(cookies, level) {
  const validLevels = ['low', 'medium', 'high', 'impossible'];
  if (!validLevels.includes(level)) throw new Error(`Invalid security level: ${level}`);

  // Fetch security.php to get the CSRF user_token.
  let jar = cookies.jar;
  let getRes = await followJars(`${BASE}/security.php`, jar);

  const html = await getRes.text();
  const tokenMatch = html.match(/name=['"]user_token['"][^>]*value=['"]([^'"]+)['"]/);
  const userToken = tokenMatch ? tokenMatch[1] : '';

  // POST the security level change with CSRF token.
  const postBody = new URLSearchParams({
    security: level,
    seclev_submit: 'Submit',
    ...(userToken ? { user_token: userToken } : {}),
  });

  let postRes = await fetch(`${BASE}/security.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar.build() },
    body: postBody.toString(),
    redirect: 'manual',
  });

  // Follow redirect.
  if (postRes.status === 302) {
    const loc = postRes.headers.get('location');
    if (loc) await followJars(loc, jar);
  }

  jar.add(postRes);
  // Persist the new security value into the jar so it shows up in cookieHeader
  // on all subsequent jar.build() calls (fixes exec/medium/high tests).
  jar.set('security', level);
  cookies.security = level;
}

// ── fetch wrapper ─────────────────────────────────────────────────────────────

export async function dvwaFetch(path, { cookies, method = 'GET', body, headers: extraHeaders } = {}) {
  const jar = cookies?.jar;

  // FormData must be passed through untouched so fetch sets the multipart boundary itself.
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const outBody = body == null
    ? undefined
    : isFormData
      ? body
      : (body instanceof URLSearchParams ? body.toString() : body);

  // String/urlencoded bodies need an explicit Content-Type so PHP populates $_POST.
  // FormData sets its own (with boundary) — never override it.
  const formHeader = outBody != null && !isFormData
    ? { 'Content-Type': 'application/x-www-form-urlencoded' }
    : {};

  if (jar) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Cookie: jar.build(), ...formHeader, ...extraHeaders },
      ...(outBody != null ? { body: outBody } : {}),
      redirect: 'follow',
    });
    jar.add(res);
    return { status: res.status, text: await res.text(), headers: res.headers };
  }

  const cookieHeader = cookies?.cookieHeader ?? '';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: cookieHeader, ...formHeader, ...extraHeaders },
    ...(outBody != null ? { body: outBody } : {}),
    redirect: 'follow',
  });
  return { status: res.status, text: await res.text(), headers: res.headers };
}

// ── DB init ───────────────────────────────────────────────────────────────────

export async function initDvwaDb({ url = BASE } = {}) {
  const res = await fetch(`${url}/setup.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'create_db=Create+%2F+Reset+Database',
    redirect: 'follow',
  });
  const text = await res.text();
  if (!/Setup successful/i.test(text) && !/already exists/i.test(text)) {
    throw new Error(`DVWA DB init may have failed — setup.php response did not confirm success`);
  }
}

// ── anti-vacuous preconditions ────────────────────────────────────────────────
//
// Nearly every DVWA challenge asserts the same pair: the endpoint still returns
// 200, and the exploit payload does not appear in the response. A target that
// answers `200 {}` to everything satisfies both for free — 38 of the 55
// challenges passed that way (issue #105). The status check was meant to catch
// "break the page instead of fixing it", but a status alone cannot tell a
// rendered page from an empty one.
//
// The oracle is DVWA's own page chrome. Every vulnerability page carries it
// (measured: ~4.6-4.8 KB each), it is unaffected by patching the vulnerability
// — fixing an XSS does not remove the site furniture — and no degraded stub
// reproduces it.

/** Marker present in every DVWA page's own template, on both the vulnerable
 *  and the patched app. */
const DVWA_PAGE_MARKER = 'Damn Vulnerable Web Application';

/**
 * The response the caller is about to assert on must be a real DVWA page.
 *
 * Deliberately takes the ALREADY-FETCHED response rather than making its own
 * request: a guard that probes some other URL proves that other URL was alive,
 * which is not the same claim. This is the response the payload assertion
 * reads.
 */
export function assertDvwaRendered({ status, text }, what) {
  if (status !== 200) {
    throw new Error(
      `anti-vacuous precondition failed: ${what} returned ${status}, not a rendered page. ` +
        `"the payload is absent" below would pass for the wrong reason.`,
    );
  }
  if (!text.includes(DVWA_PAGE_MARKER)) {
    throw new Error(
      `anti-vacuous precondition failed: ${what} returned 200 but not a DVWA page ` +
        `(${text.length} bytes, no "${DVWA_PAGE_MARKER}"). An app answering an empty 200 ` +
        `blocks every payload trivially.`,
    );
  }
}

/**
 * For flows whose verdict is not a page — the CAPTCHA password-change bypass,
 * the crypto token check — prove the app is serving before trusting the
 * outcome. `path` should be the challenge's OWN page, so this stays as close
 * to the endpoint under test as the flow allows.
 */
export async function assertDvwaAlive(cookies, path, what) {
  const res = await dvwaFetch(path, { cookies });
  assertDvwaRendered(res, `${what} (${path})`);
}

/**
 * The API-security challenge's oracle. Its endpoints return JSON, not pages,
 * so `assertDvwaRendered` does not apply — and its "safe request still works"
 * check was `status === 200`, which an empty 200 satisfies.
 *
 * Measured on the live app: `/v2/user/` lists `[{id,name,level},…]` and
 * `/v2/user/2` returns one such record. Patching excessive data exposure or
 * mass assignment removes the `password` field and ignores `level` on write —
 * it does not stop the API listing users, so this holds on both sides.
 */
export function assertDvwaApiRecord({ status, text }, what) {
  if (status !== 200) {
    throw new Error(`anti-vacuous precondition failed: ${what} returned ${status}, not a user record.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `anti-vacuous precondition failed: ${what} returned 200 but not JSON (${text.slice(0, 80)}).`,
    );
  }
  const records = Array.isArray(parsed) ? parsed : [parsed];
  const ok = records.length > 0 && records.every((r) => r && typeof r === 'object' && 'id' in r && 'name' in r);
  if (!ok) {
    throw new Error(
      `anti-vacuous precondition failed: ${what} returned no user records ` +
        `(${text.slice(0, 120)}). "the password field is absent" would pass for the wrong reason.`,
    );
  }
}
