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
