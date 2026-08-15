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
