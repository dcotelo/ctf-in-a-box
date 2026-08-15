import crypto from "node:crypto";

const b64url = (input) => Buffer.from(input).toString("base64url");

// Short-lived GitHub App JWT (RS256), hand-rolled — no jsonwebtoken dependency.
// iat is backdated 60s for clock skew; exp is capped at 10 min per GitHub's limit.
export function mintAppJwt({ appId, privateKey, now = Date.now() }) {
  const iat = Math.floor(now / 1000) - 60;
  const exp = iat + 600;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat, exp, iss: String(appId) }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(privateKey, "base64url");
  return `${signingInput}.${signature}`;
}

const GH_HEADERS = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
const REFRESH_SKEW_MS = 5 * 60 * 1000;

// Installation-token provider: mints an App JWT, exchanges it for an
// installation token, caches it, and refreshes when near expiry. Pure/testable
// via injected fetchImpl + now.
export function makeAppAuth({ appId, privateKey, installationId, apiUrl = "https://api.github.com" }) {
  let cache = null;      // { token, expiresAt(ms) }
  let instId = installationId;

  async function ghJson(url, opts, what) {
    const res = await opts.fetchImpl(url, { method: opts.method, headers: { authorization: `Bearer ${opts.jwt}`, ...GH_HEADERS } });
    if (!res.ok) throw new Error(`GitHub ${res.status} ${what}`);
    return res.json();
  }

  async function getToken(fetchImpl = fetch, now = Date.now()) {
    if (cache && cache.expiresAt - now > REFRESH_SKEW_MS) return cache.token;
    const jwt = mintAppJwt({ appId, privateKey, now });
    if (instId == null) {
      const list = await ghJson(`${apiUrl}/app/installations`, { fetchImpl, jwt, method: "GET" }, "listing app installations");
      if (!Array.isArray(list) || list.length === 0) throw new Error("GitHub App has no installations");
      instId = list[0].id;
    }
    const body = await ghJson(`${apiUrl}/app/installations/${instId}/access_tokens`, { fetchImpl, jwt, method: "POST" }, "minting installation token");
    cache = { token: body.token, expiresAt: new Date(body.expires_at).getTime() };
    return cache.token;
  }

  return { getToken };
}
