import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRedis, outsideWindow } from "../src/redis.js";

const PAST = "2000-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";
const env = { UPSTASH_REDIS_REST_URL: "http://srh:80", UPSTASH_REDIS_REST_TOKEN: "t" };

// Mock fetch that returns a single HMGET [paused, scoringStartsAt, scoringEndsAt] reply.
const hmgetFetch = (row) => async () =>
  new Response(JSON.stringify([{ result: row }]), { status: 200 });

test("outsideWindow: before start / after end / inside / unbounded", () => {
  const now = Date.parse("2026-06-01T12:00:00Z");
  assert.equal(outsideWindow(now, FUTURE, null), true);
  assert.equal(outsideWindow(now, null, PAST), true);
  assert.equal(outsideWindow(now, PAST, FUTURE), false);
  assert.equal(outsideWindow(now, null, null), false);
});

test("isPaused: manual flag pauses", async () => {
  const redis = makeRedis(env, hmgetFetch(["1", null, null]));
  assert.equal(await redis.isPaused(), true);
});

test("isPaused: scheduled window (after end) pauses without the manual flag", async () => {
  const redis = makeRedis(env, hmgetFetch([null, null, PAST]));
  assert.equal(await redis.isPaused(), true);
});

test("isPaused: inside the window is not paused", async () => {
  const redis = makeRedis(env, hmgetFetch([null, PAST, FUTURE]));
  assert.equal(await redis.isPaused(), false);
});

test("isPaused: fails OPEN when redis errors", async () => {
  const redis = makeRedis(env, async () => { throw new Error("down"); }, () => {});
  assert.equal(await redis.isPaused(), false);
});

// A per-command failure comes back as { error } with a 200 — the shape a
// WRONGTYPE, NOAUTH or unknown-command reply from SRH takes. It must be
// treated like any other read failure: fail OPEN, and say so.
const errorReplyFetch = (message) => async () =>
  new Response(JSON.stringify([{ error: message }]), { status: 200 });

test("isPaused: a per-command error reply fails OPEN and is logged", async () => {
  const logs = [];
  const redis = makeRedis(env, errorReplyFetch("WRONGTYPE Operation against a key holding the wrong kind of value"), (m) => logs.push(m));
  assert.equal(await redis.isPaused(), false);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /isPaused.*WRONGTYPE/);
});

test("getResetAt: a per-command error reply reads as no reset and is logged", async () => {
  const logs = [];
  const redis = makeRedis(env, errorReplyFetch("NOAUTH Authentication required"), (m) => logs.push(m));
  assert.equal(await redis.getResetAt(), null);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /getResetAt.*NOAUTH/);
});

test("writeStatus: a per-command error reply is logged instead of vanishing", async () => {
  const logs = [];
  const redis = makeRedis(env, errorReplyFetch("WRONGTYPE Operation against a key holding the wrong kind of value"), (m) => logs.push(m));
  await redis.writeStatus({ lastPollAt: PAST, ingested: 1, reposPolled: 1, paused: false });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /writeStatus.*WRONGTYPE/);
});

// A backend that accepts the connection and never answers must not stall the
// tick forever — `restart: on-failure` cannot help a process that never exits.
// The fake holds a ref'd timer until the abort arrives: a real fetch keeps the
// event loop alive with its socket, but `AbortSignal.timeout`'s own timer is
// unref'd, so without the placeholder Node 22 drains the loop before the
// timeout fires and the test dies as "promise still pending".
const hangUntilAborted = (_url, opts) =>
  new Promise((_, reject) => {
    const keepAlive = setTimeout(() => {}, 60_000);
    opts.signal.addEventListener("abort", () => {
      clearTimeout(keepAlive);
      reject(opts.signal.reason);
    });
  });

test("isPaused: a hung backend times out and fails OPEN", async () => {
  const logs = [];
  const redis = makeRedis(env, hangUntilAborted, (m) => logs.push(m), { timeoutMs: 20 });
  assert.equal(await redis.isPaused(), false);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /isPaused.*timeout/i);
});

// Redis's unknown-command error echoes the command's arguments ("…, with args
// beginning with: …"). Those arguments are whatever the caller sent — for the
// app that could be a flag — so the echoed tail must never reach a log.
test("a per-command error is logged by its Redis error text, never its echoed arguments", async () => {
  const logs = [];
  const redis = makeRedis(
    env,
    errorReplyFetch("ERR unknown command 'hset', with args beginning with: 'ctf:sync:status' 'ctf{leaked}' "),
    (m) => logs.push(m),
  );
  assert.equal(await redis.isPaused(), false);
  assert.match(logs[0], /ERR unknown command 'hset'/);
  assert.doesNotMatch(logs[0], /ctf\{leaked\}/);
  assert.doesNotMatch(logs[0], /with args beginning with/);
});
