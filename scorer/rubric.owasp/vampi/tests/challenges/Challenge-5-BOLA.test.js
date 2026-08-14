import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForVAmPI, vampiFetch, getToken, createDb } from '../helpers.js';

await createDb();
await waitForVAmPI();

// Pass-on-patch: drives the BOLA exploit (name1 reads another user's book by title) and asserts the
// cross-owner read is BLOCKED. On the vulnerable app the victim's secret is returned, so this FAILS;
// once the handler enforces ownership the read is denied (or returns no other-owner secret) -> PASSES.
await test('Challenge-5-BOLA', async () => {
  const token = await getToken('name1', 'pass1');

  let victimBook;
  for (let i = 0; i < 8 && !victimBook; i++) {
    const list = await vampiFetch('/books/v1', { token });
    victimBook = list.json?.Books?.find((b) => b.user !== 'name1');
    if (!victimBook) await new Promise((r) => setTimeout(r, 300));
  }
  assert.ok(victimBook, 'there must be a book owned by another user to attempt the exploit');

  // name1 tries to read the victim's book. VULNERABLE: 200 + another owner's secret.
  const res = await vampiFetch(`/books/v1/${encodeURIComponent(victimBook.book_title)}`, { token });
  const leaked = res.status === 200 && res.json?.owner && res.json.owner !== 'name1' && !!res.json?.secret;
  assert.ok(!leaked, 'BOLA must be blocked: name1 must not read another user\'s book secret');
});
