import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForShepherd, loginShepherd, loginAs, ssPost, ssGet, ssPostJson, ssPostRaw,
  extractSolutionKey, hasSolvedMessage, ensureSecondUser, ensureMongoConfig, getUserId, assertShepherdAlive,
  openModule, caesarDecode, vigenereDecode, extractCipherText, SECOND_USER, SECOND_PASS,
} from '../helpers.js';

await waitForShepherd();
const cookies = await loginShepherd();

test("Challenge-8-IDOR-Bank", async () => {
  // IDOR bank: register an attacker account, then transfer funds out of the rich account #1
  // (no ownership check on senderAccountNumber) and read the key when balance > 5,000,000.
  const uniq = 'haxor' + Date.now();
  await ssPost('/challenges/1f0935baec6ba69d79cfb2eba5fdfa6ac5d77fadee08585eb98b130ec524d00cReg', cookies, { accountHolder: uniq, accountPass: 'pass1234' });
  const login = await ssPost('/challenges/1f0935baec6ba69d79cfb2eba5fdfa6ac5d77fadee08585eb98b130ec524d00c', cookies, { accountHolder: uniq, accountPass: 'pass1234' });
  const myAcct = (login.match(/currentAccountNumber'[^>]*value='(\d+)'/) ||
                  login.match(/value='(\d+)'\s+id='currentAccountNumber'/) || [])[1]
                 || (await import('../helpers.js')).dbQuery(
                      `SELECT account_number FROM directObjectBank.bankAccounts WHERE account_holder='${uniq}';`).trim();
  // IDOR transfer from account #1 (Mr. Banks, 10e9) into our account.
  await ssPost('/challenges/1f0935baec6ba69d79cfb2eba5fdfa6ac5d77fadee08585eb98b130ec524d00cTransfer', cookies,
    { senderAccountNumber: '1', receiverAccountNumber: myAcct, transferAmount: '6000000' });
  const body = await ssPost('/challenges/1f0935baec6ba69d79cfb2eba5fdfa6ac5d77fadee08585eb98b130ec524d00c', cookies, { accountHolder: uniq, accountPass: 'pass1234' });
  const key = extractSolutionKey(body);
  // Anti-vacuous: the assertion below is satisfied by an empty body, a 404 or a
  // 500. Placed AFTER the exploit request so the challenge endpoint is still
  // exercised — a guard that returns first leaves nothing to measure (#106).
  await assertShepherdAlive(cookies);
  assert.ok(!key, 'patched: the IDOR transfer must not succeed / yield a result key');
});
