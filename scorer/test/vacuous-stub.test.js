import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  AUTH_BY_TARGET,
  HEALTH_PATHS_BY_TARGET,
  PERSONALITY_NAMES,
  PERSONALITIES,
  startStub,
} from "../tools/vacuous-stub.mjs";
import { TARGETS } from "../src/targets.js";

// The stub underpins the vacuous-pass detector (tools/vacuous-sweep.mjs, #47).
// Its whole job is to be UP but USELESS, and both halves are load-bearing: if
// it stopped answering the health probe every rubric would die at import and
// the sweep would report zero findings — the same false all-clear the detector
// exists to catch.

const HEALTH = ["/"];

test("every personality answers the health probe 200 so the target reads as UP", async () => {
  for (const name of PERSONALITY_NAMES) {
    const stub = await startStub(name, { healthPaths: HEALTH });
    try {
      const res = await fetch(`${stub.url}/`);
      assert.equal(res.status, 200, `${name}: health probe must be 200`);
    } finally {
      await stub.close();
    }
  }
});

test("no personality serves anything a real app would", async () => {
  const expected = { "empty-200": 200, "not-found": 404, "server-error": 500 };
  for (const name of PERSONALITY_NAMES) {
    const stub = await startStub(name, { healthPaths: HEALTH });
    try {
      const res = await fetch(`${stub.url}/rest/products/search?q=payload`);
      assert.equal(res.status, expected[name], `${name}: non-probe status`);
      const body = await res.text();
      // Nothing echoed back. A stub that reflected the request could satisfy a
      // `bodyIncludes` assertion and look like a genuine pass.
      assert.ok(!body.includes("payload"), `${name}: must not echo the request`);
    } finally {
      await stub.close();
    }
  }
});

test("counts only non-probe requests, so 'passed without asking anything' is visible", async () => {
  const stub = await startStub("empty-200", { healthPaths: HEALTH });
  try {
    await fetch(`${stub.url}/`);
    assert.equal(stub.requests, 0, "the health probe is not a rubric request");
    await fetch(`${stub.url}/users/v1/_debug`);
    await fetch(`${stub.url}/me`);
    assert.equal(stub.requests, 2);
  } finally {
    await stub.close();
  }
});

test("records distinct paths, so 'stuck at one gate' is separable from 'guard fired'", async () => {
  // Both shapes issue ~1 request per challenge; only the spread of paths tells
  // a login the rubric never cleared from a precondition doing its job.
  const stub = await startStub("empty-200", { healthPaths: HEALTH });
  try {
    await fetch(`${stub.url}/login`);
    await fetch(`${stub.url}/login`);
    assert.deepEqual(stub.paths, ["/login"], "one gate, hit repeatedly");
    await fetch(`${stub.url}/challenge-1?level=2`);
    assert.deepEqual(stub.paths.sort(), ["/challenge-1", "/login"], "query string is not part of the path");
  } finally {
    await stub.close();
  }
});

test("drains a request body rather than stalling a rubric that POSTs a payload", async () => {
  const stub = await startStub("empty-200", { healthPaths: HEALTH });
  try {
    const res = await fetch(`${stub.url}/users/v1/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "name1", password: "pass1" }),
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "{}");
  } finally {
    await stub.close();
  }
});

test("query strings do not turn a real path into a health probe", async () => {
  // `/` is a probe; `/foo?x=/` must not be, or a rubric hitting a query-bearing
  // endpoint would be answered 200 by the degraded personalities too.
  const stub = await startStub("not-found", { healthPaths: HEALTH });
  try {
    assert.equal((await fetch(`${stub.url}/foo?next=/`)).status, 404);
    assert.equal((await fetch(`${stub.url}/?x=1`)).status, 200);
  } finally {
    await stub.close();
  }
});

test("rejects an unknown personality rather than silently serving a default", () => {
  assert.ok(!("always-teapot" in PERSONALITIES));
  return assert.rejects(() => startStub("always-teapot", { healthPaths: HEALTH }), /unknown personality/);
});

test("refuses to start without health paths instead of guessing one", async () => {
  // A guessed default is how dvwa and webgoat sat at a silent zero: the probe
  // never went green, every file died at import, and the sweep called it clean.
  await assert.rejects(() => startStub("empty-200"), /healthPaths is required/);
  await assert.rejects(() => startStub("empty-200", { healthPaths: [] }), /healthPaths is required/);
});

test("only the target's own probe path is answered by the degraded personalities", async () => {
  // Per-target scoping is what keeps one target's probe from handing another
  // target's rubric a free 200 on a path it never should have reached.
  const stub = await startStub("not-found", { healthPaths: HEALTH_PATHS_BY_TARGET.dvwa });
  try {
    assert.equal((await fetch(`${stub.url}/login.php`)).status, 200, "dvwa's own probe");
    assert.equal((await fetch(`${stub.url}/login.jsp`)).status, 404, "securityshepherd's probe");
    assert.equal((await fetch(`${stub.url}/`)).status, 404, "vampi's probe");
  } finally {
    await stub.close();
  }
});

// ── anti-rot guards ───────────────────────────────────────────────────────────
//
// The map is a copy of a fact that lives in each target's helpers.js. Copies
// rot, and this one rots SILENTLY: a renamed probe path sends its target back
// to a confident zero it never measured. These two tests are what make the
// copy safe to keep.

test("every rubric target has a health path", () => {
  const missing = Object.values(TARGETS)
    .map((t) => t.name)
    .filter((n) => !HEALTH_PATHS_BY_TARGET[n]);
  assert.deepEqual(missing, [], "targets with no entry in HEALTH_PATHS_BY_TARGET");
});

test("each mapped health path is the path that target's helpers actually poll", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const [name, paths] of Object.entries(HEALTH_PATHS_BY_TARGET)) {
    const helpers = readFileSync(join(root, "rubric.owasp", name, "tests", "helpers.js"), "utf8");
    // The probe is written as a template literal against the target's base URL,
    // e.g. fetch(`${BASE}/login.php`). vampi polls the base itself (`${BASE}/`).
    const probe = paths[0] === "/" ? "${BASE}/`" : `\${BASE}${paths[0]}\``;
    assert.ok(
      helpers.includes(probe),
      `${name}: helpers.js does not poll ${paths[0]} — the map is stale and this ` +
        `target will report a zero it never measured`,
    );
  }
});

// ── the login handshake (#47) ────────────────────────────────────────────────
//
// Fixing the health paths got dvwa, webgoat and securityshepherd past their
// waitFor…() and into a second wall at LOGIN, where all 164 of their challenges
// died before asserting anything. These pin the handshake that clears it — and,
// just as importantly, that clearing it did not make the stub useful.

test("every target whose helpers log in has a handshake", () => {
  // The three are named explicitly rather than derived: a target that starts
  // requiring a login should fail here and be added deliberately, not be
  // silently blind again.
  for (const name of ["dvwa", "webgoat", "securityshepherd"]) {
    assert.ok(AUTH_BY_TARGET[name], `${name} needs an AUTH_BY_TARGET entry`);
    assert.ok(AUTH_BY_TARGET[name].cookies.length > 0, `${name} must set a session cookie`);
  }
});

test("the handshake answers identically under every personality", async () => {
  // Degrading it is exactly what left these three stuck at login under two
  // personalities out of three, reporting a zero nobody had measured.
  for (const name of PERSONALITY_NAMES) {
    const stub = await startStub(name, {
      healthPaths: HEALTH_PATHS_BY_TARGET.securityshepherd,
      auth: AUTH_BY_TARGET.securityshepherd,
    });
    try {
      const res = await fetch(`${stub.url}/login`, { method: "POST", redirect: "manual" });
      assert.equal(res.status, 200, `${name}: login must succeed`);
      const cookies = res.headers.getSetCookie();
      assert.ok(
        cookies.some((c) => c.startsWith("JSESSIONID=")),
        `${name}: loginShepherd throws without JSESSIONID`,
      );
      assert.ok(
        cookies.some((c) => c.startsWith("token=")),
        `${name}: loginShepherd throws without the CSRF token`,
      );
    } finally {
      await stub.close();
    }
  }
});

test("authenticating does not make the stub useful", async () => {
  // The property the whole detector rests on. "Session store works,
  // application logic does not" is an ordinary way for a real app to be broken;
  // past the handshake every path must degrade exactly as before.
  const stub = await startStub("not-found", {
    healthPaths: HEALTH_PATHS_BY_TARGET.dvwa,
    auth: AUTH_BY_TARGET.dvwa,
  });
  try {
    assert.equal((await fetch(`${stub.url}/login.php`)).status, 200, "handshake");
    assert.equal((await fetch(`${stub.url}/index.php`)).status, 200, "auth check");
    assert.equal((await fetch(`${stub.url}/vulnerabilities/sqli/`)).status, 404, "still useless");
    assert.equal((await fetch(`${stub.url}/vulnerabilities/xss_r/`)).status, 404, "still useless");
  } finally {
    await stub.close();
  }
});

test("handshake traffic is not counted as rubric requests", async () => {
  // Counting it would push every target past the "reached one distinct path"
  // threshold and retire the warning that catches a target which never got
  // anywhere — the failure this tool exists to surface.
  const stub = await startStub("empty-200", {
    healthPaths: HEALTH_PATHS_BY_TARGET.webgoat,
    auth: AUTH_BY_TARGET.webgoat,
  });
  try {
    await fetch(`${stub.url}/login`, { method: "POST" });
    await fetch(`${stub.url}/service/reportcard.mvc`);
    assert.equal(stub.requests, 0, "logging in is plumbing, not a measurement");
    assert.deepEqual(stub.paths, []);
    await fetch(`${stub.url}/WebGoat/SqlInjection/attack`);
    assert.equal(stub.requests, 1, "a real endpoint IS a measurement");
  } finally {
    await stub.close();
  }
});

test("no handshake token can be mistaken for a securityshepherd result key", async () => {
  // extractSolutionKey accepts a bare 64-hex run (#42). A stub token shaped
  // like one, echoed back by a rubric, would read as a solve — a vacuous pass
  // manufactured by the detector itself.
  const values = Object.values(AUTH_BY_TARGET)
    .flatMap((a) => [...a.cookies, ...Object.values(a.routes)])
    .join(" ");
  assert.equal(/\b[0-9a-f]{32,}\b/i.test(values), false, "no long hex run in any handshake value");
});
