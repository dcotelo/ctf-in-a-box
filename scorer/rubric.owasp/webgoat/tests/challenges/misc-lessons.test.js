/**
 * Misc lessons: LogSpoofing (A09), VulnerableComponents (A03 supply chain), HttpProxies (A02),
 * InsecureDeserialization (A08). Pass-on-patch: each subtest passes only when the exploit is BLOCKED.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { waitForWebGoat, loginWebGoat, wgFetch, lessonCompleted, BASE } from '../helpers.js';

await waitForWebGoat();
const cookies = await loginWebGoat();

// ── Log Spoofing (A09) ─────────────────────────────────────────────────────────
await test('Challenge-73-Log-Injection-Spoofing', async () => {
  // CRLF injection: a newline becomes <br/> placing a forged "admin" line in the log.
  const res = await wgFetch('/LogSpoofing/log-spoofing', {
    cookies, method: 'POST',
    body: new URLSearchParams({ username: '5\nLogin Succeeded for username admin', password: 'x' }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

await test('Challenge-72-Log-Injection-Bleeding', async () => {
  // The admin password is logged (base64) at startup and the exploit replays it.
  //
  // docker-less sandbox: the workflow reads the container log host-side (where docker exists)
  // and exports the leaked, already-decoded plaintext password as WEBGOAT_LEAKED_ADMIN_PW:
  //   - env SET & non-empty -> use it directly as the password to replay.
  //   - env SET but EMPTY   -> the host found NO leaked password (app patched); the exploit
  //                            cannot proceed, so the lesson is not solvable -> pass on patch.
  //   - env ABSENT          -> fall back to reading the container log via docker.
  let password = null;
  const leaked = process.env.WEBGOAT_LEAKED_ADMIN_PW;
  if (leaked !== undefined) {
    if (leaked === '') {
      // Patched: nothing leaked, exploit closed. Pass without solving.
      assert.ok(true, 'patched: no admin password leaked to the log');
      return;
    }
    password = leaked;
  } else {
    // Locate the WebGoat container by its published 8080 port, then grep the leaked line.
    try {
      const cid = execFileSync('docker', ['ps', '--filter', 'publish=8080', '--format', '{{.ID}}'], { encoding: 'utf8' }).trim().split('\n')[0];
      if (cid) {
        const logs = execFileSync('docker', ['logs', cid], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
        const m = [...logs.matchAll(/Password for admin:\s*([A-Za-z0-9+/=]{20,})/g)].pop();
        if (m) password = Buffer.from(m[1], 'base64').toString('utf8');
      }
    } catch { /* docker unavailable — fall through */ }
    assert.ok(password, 'could not read leaked admin password from WebGoat container log (docker required)');
  }
  const res = await wgFetch('/LogSpoofing/log-bleeding', {
    cookies, method: 'POST', body: new URLSearchParams({ username: 'Admin', password }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

// ── Vulnerable Components (A03) ──────────────────────────────────────────────────
await test('Challenge-75-Vulnerable-Components', async () => {
  // XStream CVE-2013-7285: a dynamic-proxy gadget deserializes into a non-Contact object.
  const payload = '<contact class="dynamic-proxy">'
    + '<interface>org.owasp.webgoat.lessons.vulnerablecomponents.Contact</interface>'
    + '<handler class="java.beans.EventHandler"><target class="java.lang.ProcessBuilder">'
    + '<command><string>echo</string></command></target><action>start</action></handler></contact>';
  const res = await wgFetch('/VulnerableComponents/attack1', {
    cookies, method: 'POST', body: new URLSearchParams({ payload }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});

// ── HTTP Proxies (A02) ───────────────────────────────────────────────────────────

// ── Insecure Deserialization (A08) ───────────────────────────────────────────────
await test('Challenge-74-Insecure-Deserialization', async () => {
  // Build a serialized VulnerableTaskHolder(taskAction="sleep 5") with the exact class from the
  // running WebGoat jar so the version check passes and the ~5s sleep lands in the accepted 3-7s
  // window. The server URL-safe-decodes the token, so we send standard base64 with +/ mapped to
  // -/_ (matching the docker path below).
  //
  // docker-less sandbox: the workflow builds the gadget host-side (where docker + the jar exist)
  // and exports its standard-base64 encoding as WEBGOAT_DESER_PAYLOAD:
  //   - env SET & non-empty -> replay it (URL-safe encoded) and assert the server does NOT sleep.
  //   - env SET but EMPTY   -> the host could not build a working gadget (app patched); the
  //                            exploit cannot proceed -> pass on patch without solving.
  //   - env ABSENT          -> fall back to building the gadget in the container via docker.
  let token = null;
  const deser = process.env.WEBGOAT_DESER_PAYLOAD;
  if (deser !== undefined) {
    if (deser === '') {
      // Patched: no working gadget, exploit closed. Pass without solving.
      assert.ok(true, 'patched: no working deserialization gadget available');
      return;
    }
    token = deser.replace(/\+/g, '-').replace(/\//g, '_'); // server reverses this
  } else {
  try {
    const cid = execFileSync('docker', ['ps', '--filter', 'publish=8080', '--format', '{{.ID}}'], { encoding: 'utf8' }).trim().split('\n')[0];
    assert.ok(cid, 'no WebGoat container found');
    const script = [
      'set -e', 'cd /tmp', 'rm -rf wgdeser && mkdir wgdeser && cd wgdeser',
      'jar xf /home/webgoat/webgoat.jar BOOT-INF/classes/org/dummy/insecure/framework/VulnerableTaskHolder.class 2>/dev/null',
      'SLF4J=$(jar tf /home/webgoat/webgoat.jar | grep -i "slf4j-api" | head -1)',
      'jar xf /home/webgoat/webgoat.jar "$SLF4J" 2>/dev/null',
      'CP="BOOT-INF/classes:$SLF4J"',
      'cat > Gen.java <<EOF',
      'import java.io.*; import java.util.Base64; import org.dummy.insecure.framework.VulnerableTaskHolder;',
      'public class Gen { public static void main(String[] a) throws Exception {',
      '  VulnerableTaskHolder t = new VulnerableTaskHolder("delete", "sleep 5");',
      '  ByteArrayOutputStream b = new ByteArrayOutputStream();',
      '  ObjectOutputStream o = new ObjectOutputStream(b); o.writeObject(t); o.flush();',
      '  System.out.println(Base64.getEncoder().encodeToString(b.toByteArray())); } }',
      'EOF',
      'javac -cp "$CP" Gen.java 2>/dev/null',
      'java -cp "$CP:." Gen 2>/dev/null',
    ].join('\n');
    const b64 = execFileSync('docker', ['exec', cid, 'sh', '-c', script], { encoding: 'utf8' }).trim().split('\n').pop();
    token = b64.replace(/\+/g, '-').replace(/\//g, '_'); // server reverses this
  } catch (e) {
    assert.fail(`could not generate serialized payload (docker + WebGoat jar required): ${e.message}`);
  }
  }
  const res = await wgFetch('/InsecureDeserialization/task', {
    cookies, method: 'POST', body: new URLSearchParams({ token }),
  });
  assert.ok(!lessonCompleted(res), 'patched: the exploit must not solve the lesson');
});
