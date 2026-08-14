/**
 * SQL Injection (intro + advanced + mitigations) — A05:2025 Injection. Pass-on-patch:
 * each exploit subtest passes only when the injection is BLOCKED (lesson NOT solved).
 * Pure quiz/mitigation subtests (no attacker payload) are left as pass-when-answered and noted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForWebGoat, loginWebGoat, wgFetch, lessonCompleted } from '../helpers.js';

await waitForWebGoat();
const cookies = await loginWebGoat();

const post = (path, params) =>
  wgFetch(path, { cookies, method: 'POST', body: new URLSearchParams(params) });

// ── intro ──────────────────────────────────────────────────────────────────
await test('Challenge-17-SQL-Injection-DQL', async () => {
  const res = await post('/SqlInjection/attack2', { query: "SELECT * FROM employees WHERE department='Marketing'" });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});
await test('Challenge-18-SQL-Injection-String-Completion', async () => {
  const res = await post('/SqlInjection/attack3', { query: "UPDATE employees SET department='Sales' WHERE last_name='Barnett'" });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});
await test('Challenge-19-SQL-Injection-Numeric', async () => {
  // ALTER is idempotent-unfriendly; a patched lesson is never solved server-side either.
  const res = await post('/SqlInjection/attack4', { query: 'ALTER TABLE employees ADD phone varchar(20)' });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
  const ov = await wgFetch('/service/lessonoverview.mvc/SqlInjection', { cookies });
  const solved = (ov.json ?? []).some((e) => e.assignment?.path?.endsWith('/SqlInjection/attack4') && e.solved);
  assert.ok(!solved, 'patched: the assignment must not be solved server-side');
});
await test('Challenge-20-SQL-Injection-Compromise', async () => {
  const res = await post('/SqlInjection/attack5', { query: 'GRANT ALL ON grant_rights TO unauthorized_user' });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});
await test('Challenge-21-SQL-Injection-UNION', async () => {
  const res = await post('/SqlInjection/assignment5a', { account: 'Smith', operator: "' OR '", injection: "'='" });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});
await test('Challenge-22-SQL-Injection-Column-Discovery', async () => {
  const res = await post('/SqlInjection/assignment5b', { userid: '0 OR 1=1', login_count: '0' });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});
await test('Challenge-23-SQL-Injection-DML-Update', async () => {
  const res = await post('/SqlInjection/attack8', { name: "' OR '1'='1' --", auth_tan: '' });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});
await test('Challenge-24-SQL-Injection-DDL-Drop', async () => {
  const res = await post('/SqlInjection/attack9', { name: "Smith'; UPDATE employees SET salary=99999 WHERE last_name='Smith", auth_tan: '3SL99A' });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
  const ov = await wgFetch('/service/lessonoverview.mvc/SqlInjection', { cookies });
  const solved = (ov.json ?? []).some((e) => e.assignment?.path?.endsWith('/SqlInjection/attack9') && e.solved);
  assert.ok(!solved, 'patched: the assignment must not be solved server-side');
});
await test('Challenge-25-SQL-Injection-Blind-Inference', async () => {
  const res = await post('/SqlInjection/attack10', { action_string: "%'; DROP TABLE access_log --" });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
  const ov = await wgFetch('/service/lessonoverview.mvc/SqlInjection', { cookies });
  const solved = (ov.json ?? []).some((e) => e.assignment?.path?.endsWith('/SqlInjection/attack10') && e.solved);
  assert.ok(!solved, 'patched: the assignment must not be solved server-side');
});

// ── advanced ─────────────────────────────────────────────────────────────────
await test('Challenge-28-SQL-Injection-UNION-Advanced', async () => {
  const res = await post('/SqlInjectionAdvanced/attack6a', {
    userid_6a: "Smith' UNION SELECT userid,user_name,password,cookie,cookie,cookie,userid FROM user_system_data --",
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});
await test('Challenge-29-SQL-Injection-Blind-Boolean', async () => {
  // dave's password recovered via 6a is passW0rD.
  const res = await post('/SqlInjectionAdvanced/attack6b', { userid_6b: 'passW0rD' });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});
await test('Challenge-30-SQL-Injection-Login-Bypass', async () => {
  // The login query is parameterized, so we recover tom's password with a blind boolean SQLi
  // against the injectable registration check (select userid ... where userid = '<inj>'), then
  // log in. This works regardless of the current password value.
  const CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_-';
  const rowExists = async (inj) => {
    const r = await wgFetch('/SqlInjectionAdvanced/register', {
      cookies, method: 'PUT',
      body: new URLSearchParams({ username_reg: inj, email_reg: 'a@a.io', password_reg: 'p' }),
    });
    return /exists/i.test(r.json?.feedback ?? '');
  };
  let pw = '';
  for (let pos = 1; pos <= 40; pos++) {
    let found = null;
    for (const ch of CHARSET) {
      // eslint-disable-next-line no-await-in-loop
      if (await rowExists(`tom' AND substring(password,${pos},1)='${ch}`)) { found = ch; break; }
    }
    if (found === null) break;
    pw += found;
  }
  // On a patched (parameterized) register check the blind SQLi extracts nothing, so the
  // recovered password is wrong and the subsequent login cannot solve the lesson.
  const res = await post('/SqlInjectionAdvanced/login', { username_login: 'tom', password_login: pw });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-31-SQL-Order-By-Defense', async () => {
  // webgoat-prd hidden IP recovered via the Servers sort SQLi.
  const res = await post('/SqlInjectionMitigations/attack12a', { ip: '104.130.219.202' });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});
await test('Challenge-26-SQL-Input-Validation', async () => {
  // No spaces allowed — use tabs as whitespace in the UNION injection.
  const t = '\t';
  const payload = `Smith'${t}UNION${t}SELECT${t}userid,user_name,password,cookie,cookie,cookie,userid${t}FROM${t}user_system_data${t}--`;
  const res = await post('/SqlOnlyInputValidation/attack', { userid_sql_only_input_validation: payload });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});
await test('Challenge-27-SQL-Keyword-Filter-Bypass', async () => {
  // FROM/SELECT stripped after uppercasing; obfuscate so removal reconstructs them. Tabs for spaces.
  const t = '\t';
  const payload = `SMITH'${t}UNION${t}SESELECTLECT${t}USERID,USER_NAME,PASSWORD,COOKIE,COOKIE,COOKIE,USERID${t}FRFROMOM${t}USER_SYSTEM_DATA${t}--`;
  const res = await post('/SqlOnlyInputValidationOnKeywords/attack', { userid_sql_only_input_validation_on_keywords: payload });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});
