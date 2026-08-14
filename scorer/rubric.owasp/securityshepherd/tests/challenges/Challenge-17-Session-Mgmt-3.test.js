import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-17-Session-Mgmt-3", async () => {
  // Change-password takes the target user from a client cookie (double base64). Reset admin's
  // password to a chosen value, then sign in.
  const cur = Buffer.from(Buffer.from('admin').toString('base64')).toString('base64');
  await ssPost('/challenges/b467dbe3cd61babc0ec599fd0c67e359e6fe04e8cdc618d537808cbb693fee8a',
    { ...cookies, current: cur }, { newPassword: 'hax12345' });
  const body = await ssPost('/challenges/t193c6634f049bcf65cdcac72269eeac25dbb2a6887bdb38873e57d0ef447bc3', cookies, { subUserName: 'admin', subUserPassword: 'hax12345' });
  const key = extractSolutionKey(body);
  assert.ok(!(hasSolvedMessage(body) || key), 'patched: the exploit must not solve the challenge / yield a result key');
});
