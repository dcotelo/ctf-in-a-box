import { test } from "node:test";
import assert from "node:assert/strict";
import { submitScore } from "../src/submit.js";

const CFG = { scorerUrl: "http://scorer:4000", scorerToken: "s3cret" };
const PAYLOAD = { author: "octocat", target: "dvwa", solved: ["sqli-low"], pr: 7, sha: "abc" };

test("POSTs payload with bearer token, true on 202", async () => {
  let seen;
  const f = async (url, opts) => {
    seen = { url: String(url), opts };
    return new Response(null, { status: 202 });
  };
  assert.equal(await submitScore(CFG, PAYLOAD, f), true);
  assert.equal(seen.url, "http://scorer:4000/score");
  assert.equal(seen.opts.method, "POST");
  assert.equal(seen.opts.headers.authorization, "Bearer s3cret");
  assert.deepEqual(JSON.parse(seen.opts.body), PAYLOAD);
});

test("false on 4xx (do not retry)", async () => {
  const f = async () => new Response("bad author", { status: 400 });
  assert.equal(await submitScore(CFG, PAYLOAD, f), false);
});

test("throws on 5xx (retry next tick)", async () => {
  const f = async () => new Response("boom", { status: 503 });
  await assert.rejects(submitScore(CFG, PAYLOAD, f), /scorer 503/);
});
