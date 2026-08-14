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

// null-byte signature truncation bypass

test('Challenge-54-JWT-Level-5', async () => {
  const token = hs256({ alg: 'HS256', typ: 'JWT' }, PAYLOAD, HIGH_KEY) + '%00ATTACKERJUNK';
  const res = await vaFetch('/JWTVulnerability/LEVEL_5', { headers: { Cookie: 'JWT=' + token } });
  assert.notEqual(res.json?.isValid, true, 'null-byte signature truncation must not bypass validation when patched');
});
