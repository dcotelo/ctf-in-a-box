import test from "node:test";
import assert from "node:assert/strict";
import { PERSONALITY_NAMES, PERSONALITIES, startStub } from "../tools/vacuous-stub.mjs";

// The stub underpins the vacuous-pass detector (tools/vacuous-sweep.mjs, #47).
// Its whole job is to be UP but USELESS, and both halves are load-bearing: if
// it stopped answering the health probe every rubric would die at import and
// the sweep would report zero findings — the same false all-clear the detector
// exists to catch.

test("every personality answers the health probe 200 so the target reads as UP", async () => {
  for (const name of PERSONALITY_NAMES) {
    const stub = await startStub(name);
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
    const stub = await startStub(name);
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
  const stub = await startStub("empty-200");
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

test("drains a request body rather than stalling a rubric that POSTs a payload", async () => {
  const stub = await startStub("empty-200");
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
  const stub = await startStub("not-found");
  try {
    assert.equal((await fetch(`${stub.url}/foo?next=/`)).status, 404);
    assert.equal((await fetch(`${stub.url}/?x=1`)).status, 200);
  } finally {
    await stub.close();
  }
});

test("rejects an unknown personality rather than silently serving a default", () => {
  assert.ok(!("always-teapot" in PERSONALITIES));
  return assert.rejects(() => startStub("always-teapot"), /unknown personality/);
});
