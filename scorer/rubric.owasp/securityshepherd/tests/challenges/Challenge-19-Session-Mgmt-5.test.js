import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-19-Session-Mgmt-5", async () => {
  // Forge the predictable timestamp reset token (base64 of Java Date.toString()), reset admin's
  // password (>=12 chars), then log in.
  const d = new Date();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${days[d.getUTCDay()]} ${mons[d.getUTCMonth()]} ${d.getUTCDate()} ` +
    `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} +0000 ${d.getUTCFullYear()}`;
  const token = Buffer.from(stamp).toString('base64');
  await ssPost('/challenges/7aed58f3a00087d56c844ed9474c671f8999680556c127a19ee79fa5d7a132e1ChangePass', cookies,
    { userName: 'admin', newPassword: 'haxhaxhax1234', resetPasswordToken: token });
  const body = await ssPost('/challenges/7aed58f3a00087d56c844ed9474c671f8999680556c127a19ee79fa5d7a132e1', cookies, { subUserName: 'admin', subUserPassword: 'haxhaxhax1234' });
  const key = extractSolutionKey(body);
  assert.ok(!(hasSolvedMessage(body) || key), 'patched: the exploit must not solve the challenge / yield a result key');
});
