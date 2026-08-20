import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch, assertLevelResponded } from '../helpers.js';

await waitForVulnerableApp();


import { createHmac, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');
const PAYLOAD = JSON.stringify({ sub: '1234567890', name: 'John Doe', admin: true, iat: 1516239022 });
function hs256(headerObj, payload, key) {
  const h = b64u(JSON.stringify(headerObj));
  const p = b64u(payload);
  const sig = createHmac('sha256', key).update(h + '.' + p).digest('base64url');
  return `${h}.${p}.${sig}`;
}
const HIGH_KEY = '12309jansdu912jnas^90nqwq!@!#oqihr82343n';
const LOW_KEY = 'password';

// JWK header injection: self-signed RS256 with embedded attacker JWK

test('Challenge-58-JWT-Level-9', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const header = { alg: 'RS256', typ: 'JWT', jwk: { kty: 'RSA', n: jwk.n, e: jwk.e } };
  const payload = Buffer.from('eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMn0', 'base64url');
  const h = b64u(JSON.stringify(header));
  const p = b64u(payload);
  const sig = cryptoSign('RSA-SHA256', Buffer.from(h + '.' + p), privateKey).toString('base64url');
  const token = `${h}.${p}.${sig}`;
  const res = await vaFetch('/JWTVulnerability/LEVEL_9', { headers: { Cookie: 'JWT=' + token } });
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-58-jwt-level-9');
  assert.notEqual(res.json?.isValid, true, 'JWK header injection (self-signed RS256) must be rejected when patched');
});
