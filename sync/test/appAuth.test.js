import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mintAppJwt } from "../src/appAuth.js";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

test("mintAppJwt builds a verifiable RS256 JWT with the right claims", () => {
  const now = 1_700_000_000_000; // fixed epoch-ms
  const jwt = mintAppJwt({ appId: "12345", privateKey, now });
  const [h, p, sig] = jwt.split(".");
  assert.deepEqual(decode(h), { alg: "RS256", typ: "JWT" });
  const payload = decode(p);
  assert.equal(payload.iss, "12345");
  assert.equal(payload.iat, Math.floor(now / 1000) - 60); // backdated 60s
  assert.equal(payload.exp, payload.iat + 600);           // <= 10 min
  // Signature verifies against the public key over "header.payload".
  const ok = crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, sig, "base64url");
  assert.equal(ok, true);
});

import { makeAppAuth } from "../src/appAuth.js";

// Minimal fetch stub: routes by URL substring, records calls.
function stubFetch(routes) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    for (const [needle, resp] of routes) {
      if (String(url).includes(needle)) return resp(opts);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  impl.calls = calls;
  return impl;
}
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("getToken mints, exchanges with the JWT bearer, and caches", async () => {
  const auth = makeAppAuth({ appId: "1", privateKey, installationId: 99, apiUrl: "https://api.github.test" });
  const fetchImpl = stubFetch([
    ["/app/installations/99/access_tokens", (opts) => {
      assert.match(opts.headers.authorization, /^Bearer .+\..+\..+$/); // a JWT
      assert.equal(opts.method, "POST");
      return jsonRes(201, { token: "ghs_installtok", expires_at: "2033-11-14T00:00:00Z" });
    }],
  ]);
  const now = 1_700_000_000_000;
  const t1 = await auth.getToken(fetchImpl, now);
  assert.equal(t1, "ghs_installtok");
  // Second call well before expiry: served from cache, no new fetch.
  const t2 = await auth.getToken(fetchImpl, now + 1000);
  assert.equal(t2, "ghs_installtok");
  assert.equal(fetchImpl.calls.length, 1);
});

test("getToken refreshes when within 5 min of expiry", async () => {
  const auth = makeAppAuth({ appId: "1", privateKey, installationId: 99, apiUrl: "https://api.github.test" });
  let n = 0;
  const fetchImpl = stubFetch([
    ["/access_tokens", () => jsonRes(201, { token: `tok${++n}`, expires_at: new Date(1_700_000_000_000 + 3600_000).toISOString() })],
  ]);
  const base = 1_700_000_000_000;
  assert.equal(await auth.getToken(fetchImpl, base), "tok1");
  // 56 min later: within 5 min of the 60-min expiry -> refresh.
  assert.equal(await auth.getToken(fetchImpl, base + 56 * 60_000), "tok2");
  assert.equal(fetchImpl.calls.length, 2);
});

test("getToken discovers the installation id when not configured", async () => {
  const auth = makeAppAuth({ appId: "1", privateKey, apiUrl: "https://api.github.test" });
  const fetchImpl = stubFetch([
    ["/app/installations/77/access_tokens", () => jsonRes(201, { token: "tok", expires_at: "2023-11-14T00:00:00Z" })],
    ["/app/installations", () => jsonRes(200, [{ id: 77 }])], // list (checked after the more specific route)
  ]);
  const t = await auth.getToken(fetchImpl, 1_700_000_000_000);
  assert.equal(t, "tok");
  assert.ok(fetchImpl.calls.some((c) => c.url.endsWith("/app/installations")));
});

// new Date("garbage").getTime() is NaN, and `NaN - now > skew` is always false
// — so a token with an unusable expiry would be re-minted on EVERY call,
// silently. A malformed expiry is a broken response; say so.
test("getToken rejects an installation token whose expires_at is unusable", async () => {
  const auth = makeAppAuth({ appId: "1", privateKey, installationId: 99, apiUrl: "https://api.github.test" });
  const fetchImpl = stubFetch([
    ["/access_tokens", () => jsonRes(201, { token: "tok", expires_at: "garbage" })],
  ]);
  await assert.rejects(auth.getToken(fetchImpl, 1_700_000_000_000), /expires_at/);
});
