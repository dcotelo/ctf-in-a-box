const BASE = process.env.JUICE_SHOP_URL ?? 'http://localhost:3000';

export async function waitForServer({ timeoutMs = 120_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/rest/admin/application-version`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Juice Shop at ${BASE} did not become healthy in ${timeoutMs}ms`);
}

export async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

export async function registerAndLogin({ email, password }) {
  await api('/api/Users', {
    method: 'POST',
    body: JSON.stringify({ email, password, passwordRepeat: password, securityQuestion: null, securityAnswer: 'x' }),
  });
  const login = await api('/rest/user/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (login.status !== 200) {
    throw new Error(`login failed for ${email}: ${login.status} ${JSON.stringify(login.body)}`);
  }
  return login.body.authentication.token;
}

// ── anti-vacuous precondition ─────────────────────────────────────────────────

/**
 * Proves the shop is genuinely serving before an "the exploit was blocked"
 * assertion is trusted — see docs/scorer.md, "The vacuous pass", and issue #47.
 *
 * Deliberately probes a BENIGN endpoint rather than inspecting the exploit's own
 * response. Several of these challenges legitimately expect the exploit request
 * to fail (a 4xx, or an error envelope), so asserting a shape on that response
 * would break the very check it is meant to protect.
 *
 * A product search is the right oracle: it exercises the HTTP layer and the
 * SQLite database in one call, returns the app's standard
 * `{status:"success", data:[…]}` envelope, and none of the vulnerabilities
 * scored here is "product search works" — so it holds on the vulnerable app and
 * on a patched one alike. Verified against bkimminich/juice-shop:v20.0.0.
 */
export async function assertShopAlive(what = 'juice-shop') {
  let res;
  try {
    res = await api('/rest/products/search?q=apple');
  } catch (err) {
    throw new Error(`anti-vacuous precondition failed: ${what} could not reach product search (${err.message}).`);
  }
  const ok =
    res.status === 200 &&
    res.body &&
    typeof res.body === 'object' &&
    res.body.status === 'success' &&
    Array.isArray(res.body.data) &&
    res.body.data.length > 0;
  if (!ok) {
    throw new Error(
      `anti-vacuous precondition failed: ${what} product search returned no catalogue ` +
        `(status ${res.status}, body ${JSON.stringify(res.body)?.slice(0, 200)}). The app is ` +
        `degraded or unseeded, so "the exploit was blocked" below would pass for the wrong reason.`,
    );
  }
}
