/**
 * XSS (DOM-Based) — pass-when-PATCHED (patch CTF).
 *
 * All three vulnerable levels (low/medium/high) ship the same server-side
 * behaviour: the PHP embeds a JS block containing:
 *
 *   document.write("<option value='" + lang + "'>" + decodeURI(lang) + "</option>");
 *
 * The `decodeURI(lang)` call allows a URL-encoded XSS payload to be decoded
 * and executed client-side.  The `impossible` level removes decodeURI:
 *
 *   document.write("<option value='" + lang + "'>" + (lang) + "</option>");
 *
 * ── DESIGN NOTE (approach B chosen over approach A) ───────────────────────────
 *
 * A runtime-signal approach (A) was evaluated first: sending a DOM-XSS payload
 * via the `default`/`lang` parameter and asserting whether the raw unescaped
 * payload appears in the server response. Verified against live DVWA:
 *
 *   low/medium/high all return: `decodeURI(lang)` present in page source
 *   impossible returns:         `decodeURI(lang)` ABSENT in page source
 *
 * The three vulnerable levels are INDISTINGUISHABLE at the server-response level:
 * the `decodeURI(lang)` sink lives in the SHARED controller `xss_d/index.php`,
 * not in the per-level source files (low.php / medium.php / high.php). A payload
 * sent via the `lang` query parameter reflects identically across all three levels
 * because index.php renders it unconditionally before including the level source.
 *
 * Therefore approach (B) is the correct choice: use the `decodeURI(lang)` proxy
 * as the signal, but document that the INTENDED FIX for this challenge is
 * editing `xss_d/index.php` (the shared controller) to remove or encode the
 * `$decodeURI` / `decodeURI(lang)` call — and all three level subtests share
 * that single signal. Patching any one per-level file cannot make an individual
 * level pass; the fix must target the shared controller.
 *
 * The tests are kept as separate subtests (xss_d-low / xss_d-medium / xss_d-high)
 * so each catalogue key can be scored independently once the shared fix is applied.
 * They will all flip from failing to passing together when index.php is patched.
 *
 * Since this is a client-side vulnerability, we cannot observe script execution
 * over HTTP.  The testable server-side signal is whether the page source still
 * ships `decodeURI(lang)` — its presence is the vulnerability.
 * A patched level must NOT ship `decodeURI(lang)` in the page source.
 *
 * Subtest names match the catalogue keys: xss_d-low / xss_d-medium / xss_d-high.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForDvwa, loginDvwa, setSecurityLevel, dvwaFetch } from '../helpers.js';

const XSS_D = '/vulnerabilities/xss_d/';

// The exact string that appears in vulnerable pages — absent in the impossible fix.
// This signal lives in the SHARED xss_d/index.php controller; the intended fix is
// to remove/encode `decodeURI(lang)` from that shared file. All three levels share
// this signal and will pass/fail together.
const VULN_SIGNAL = 'decodeURI(lang)';

await test('Challenge-10-XSS-DOM-Low', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'low');

  const { status, text } = await dvwaFetch(XSS_D, { cookies });
  assert.equal(status, 200, 'patched XSS DOM low endpoint must still return 200');
  assert.ok(
    !text.includes(VULN_SIGNAL),
    'xss_d-low: page must not ship decodeURI(lang) — the client-side XSS sink must be removed from xss_d/index.php'
  );
});

await test('Challenge-10-XSS-DOM-Medium', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'medium');

  const { status, text } = await dvwaFetch(XSS_D, { cookies });
  assert.equal(status, 200, 'patched XSS DOM medium endpoint must still return 200');
  assert.ok(
    !text.includes(VULN_SIGNAL),
    'xss_d-medium: page must not ship decodeURI(lang) — the client-side XSS sink must be removed from xss_d/index.php'
  );
});

await test('Challenge-10-XSS-DOM-High', async () => {
  await waitForDvwa();
  const cookies = await loginDvwa();
  await setSecurityLevel(cookies, 'high');

  const { status, text } = await dvwaFetch(XSS_D, { cookies });
  assert.equal(status, 200, 'patched XSS DOM high endpoint must still return 200');
  assert.ok(
    !text.includes(VULN_SIGNAL),
    'xss_d-high: page must not ship decodeURI(lang) — the client-side XSS sink must be removed from xss_d/index.php'
  );
});
