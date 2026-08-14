import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVulnerableApp, vaFetch } from '../helpers.js';

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

import { readFileSync } from 'node:fs';
import { createPublicKey } from 'node:crypto';
// RS256->HS256 algorithm confusion (public key as HMAC secret)
test('Challenge-57-JWT-Level-8', async () => {
  // Server validates with the RSA public key; when alg=HS256 it uses the key bytes as the HMAC secret.
  const pemPath = new URL('../keys/jwt_rsa_public.pem', import.meta.url);
  const pem = readFileSync(pemPath, 'utf8');
  const der = createPublicKey(pem).export({ type: 'spki', format: 'der' });
  const payload = Buffer.from('eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMn0', 'base64url');
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(payload);
  const sig = createHmac('sha256', der).update(h + '.' + p).digest('base64url');
  const token = `${h}.${p}.${sig}`;
  const res = await vaFetch('/JWTVulnerability/LEVEL_8', { headers: { Cookie: 'JWT=' + token } });
  assert.notEqual(res.json?.isValid, true, 'RS256->HS256 algorithm confusion must be rejected when patched');
});
