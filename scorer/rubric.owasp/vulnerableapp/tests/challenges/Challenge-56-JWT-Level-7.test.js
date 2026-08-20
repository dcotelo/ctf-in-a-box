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

// alg:none bypass via Authorization header

test('Challenge-56-JWT-Level-7', async () => {
  const h = b64u(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const p = b64u(PAYLOAD);
  const token = `${h}.${p}.`;
  const res = await vaFetch('/JWTVulnerability/LEVEL_7', { headers: { Authorization: token } });
  // Anti-vacuous: prove the level actually evaluated the request before
  // trusting the absence assertion below (docs/scorer.md, #47).
  assertLevelResponded(res, 'challenge-56-jwt-level-7');
  assert.notEqual(res.json?.isValid, true, 'alg:none via Authorization header must be rejected when patched');
});
