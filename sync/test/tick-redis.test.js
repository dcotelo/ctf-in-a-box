import test from "node:test";
import assert from "node:assert/strict";
import { tick } from "../src/index.js";
import { TARGETS, REPO_NAMES } from "../src/config.js";

const cfg = { org: "o", commentAuthor: "github-actions[bot]" };
const baseState = () => ({ repos: {}, ingested: 0 });

// A cfg with everything fetchNewScoreComments needs to build a real request,
// for the tests below that actually want the per-repo poll to be reached
// (rather than absorbed by the per-repo try/catch as a poll failure).
const pollableCfg = { ...cfg, apiUrl: "https://api.example", getToken: async () => "ghp_test" };

test("a paused flag holds every cursor and still writes a paused heartbeat", async () => {
  let status = null;
  const redis = { getSecureDevTargets: async () => ["vampi"], isPaused: async () => true, writeStatus: async (s) => { status = s; } };
  const state = baseState();
  state.repos["VAmPI"] = { since: "T0", etag: "E0", seen: ["x"] };
  const fetchImpl = () => { throw new Error("must not poll while paused"); };
  await tick(cfg, state, { redis, fetchImpl, log: () => {} });
  assert.deepEqual(state.repos["VAmPI"], { since: "T0", etag: "E0", seen: ["x"] });
  assert.equal(status.paused, true);
});

test("an unpaused tick writes a heartbeat with paused false", async () => {
  let status = null;
  const redis = { getSecureDevTargets: async () => ["vampi"], isPaused: async () => false, writeStatus: async (s) => { status = s; } };
  const fetchImpl = async () => ({
    status: 200, headers: { get: () => null }, json: async () => [],
  });
  await tick(cfg, baseState(), { redis, fetchImpl, log: () => {} });
  assert.equal(status.paused, false);
  assert.ok(status.lastPollAt);
});

test("a redis status-write failure does not throw out of the tick", async () => {
  const redis = { getSecureDevTargets: async () => ["vampi"], isPaused: async () => false, writeStatus: async () => { throw new Error("down"); } };
  const fetchImpl = async () => ({ status: 200, headers: { get: () => null }, json: async () => [] });
  await assert.doesNotReject(tick(cfg, baseState(), { redis, fetchImpl, log: () => {} }));
});

test("a bumped reset epoch drops the cursor even while paused (poll-mode wipe)", async () => {
  const redis = {
    getSecureDevTargets: async () => ["vampi"],
    getResetAt: async () => "1001",
    isPaused: async () => true, // a reset also freezes scoring
    writeStatus: async () => {},
  };
  const state = baseState();
  state.repos["VAmPI"] = { since: "T0", etag: "E0", seen: ["x"] };
  const fetchImpl = () => { throw new Error("must not poll while paused"); };
  await tick(cfg, state, { redis, fetchImpl, log: () => {} });
  assert.deepEqual(state.repos, {}); // cursor + seen dropped so an unfreeze re-polls fresh
  assert.equal(state.resetAt, "1001");
});

test("an unchanged reset epoch leaves the cursor intact", async () => {
  const redis = { getSecureDevTargets: async () => ["vampi"], getResetAt: async () => "1001", isPaused: async () => true, writeStatus: async () => {} };
  const state = baseState();
  state.resetAt = "1001";
  state.repos["VAmPI"] = { since: "T0", etag: "E0", seen: ["x"] };
  await tick(cfg, state, { redis, fetchImpl: () => { throw new Error("no poll"); }, log: () => {} });
  assert.deepEqual(state.repos["VAmPI"], { since: "T0", etag: "E0", seen: ["x"] });
});

// ── the admin panel's target selection, read fresh every tick ───────────────

test("unreadable targets → reposPolled 0, lastError set, state and cursors unchanged", async () => {
  let status = null;
  const redis = {
    getSecureDevTargets: async () => { throw new Error("boom"); },
    isPaused: async () => false,
    writeStatus: async (s) => { status = s; },
  };
  const state = baseState();
  state.repos["VAmPI"] = { since: "T0", etag: "E0", seen: ["x"] };
  const fetchImpl = () => { throw new Error("must not poll when targets are unreadable"); };
  const result = await tick(pollableCfg, state, { redis, fetchImpl, log: () => {} });
  assert.equal(result, state);
  assert.deepEqual(state.repos["VAmPI"], { since: "T0", etag: "E0", seen: ["x"] });
  assert.equal(state.ingested, 0);
  assert.equal(status.reposPolled, 0);
  assert.equal(status.paused, false);
  assert.match(status.lastError, /targets unreadable: boom/);
});

// The pause flag is read BEFORE the targets fetch (it is fail-open and
// cheap), specifically so an unreadable-targets tick's heartbeat still
// carries the real value instead of hardcoding `paused: false` regardless of
// the actual setting.
test("unreadable targets while paused still reports the real paused value", async () => {
  let status = null;
  const redis = {
    getSecureDevTargets: async () => { throw new Error("boom"); },
    isPaused: async () => true,
    writeStatus: async (s) => { status = s; },
  };
  const fetchImpl = () => { throw new Error("must not poll when targets are unreadable"); };
  await tick(pollableCfg, baseState(), { redis, fetchImpl, log: () => {} });
  assert.equal(status.reposPolled, 0);
  assert.equal(status.paused, true);
  assert.match(status.lastError, /targets unreadable: boom/);
});

test("absent field → all six polled", async () => {
  let status = null;
  const polled = [];
  const redis = { getSecureDevTargets: async () => TARGETS, isPaused: async () => false, writeStatus: async (s) => { status = s; } };
  const fetchImpl = async (url) => {
    polled.push(new URL(String(url)).pathname.split("/")[3]);
    return { status: 200, headers: { get: () => null }, json: async () => [] };
  };
  await tick(pollableCfg, baseState(), { redis, fetchImpl, log: () => {} });
  assert.equal(status.reposPolled, 6);
  assert.deepEqual(polled.sort(), Object.values(REPO_NAMES).sort());
});

test('stored ["vampi"] → only VAmPI polled', async () => {
  let status = null;
  const polled = [];
  // cfg carries no targets at all any more (config-v2 removed it) — this uses
  // a bare pollableCfg so a build that still read cfg.targets would have
  // nothing to iterate, making the divergence from redis-driven scoping obvious.
  const redis = { getSecureDevTargets: async () => ["vampi"], isPaused: async () => false, writeStatus: async (s) => { status = s; } };
  const fetchImpl = async (url) => {
    polled.push(new URL(String(url)).pathname.split("/")[3]);
    return { status: 200, headers: { get: () => null }, json: async () => [] };
  };
  await tick(pollableCfg, baseState(), { redis, fetchImpl, log: () => {} });
  assert.equal(status.reposPolled, 1);
  assert.deepEqual(polled, ["VAmPI"]);
});

// R5: no Redis client at all (main() logs this once at boot, see
// main.test.js) — tick() must still poll something rather than going dark.
// TARGETS (all six) is the documented fallback; there is no `status` object
// to read reposPolled from here (the final writeStatusSafely is itself
// gated on `redis`), so this asserts on which repos were actually fetched.
test("no redis client → falls back to polling all six targets", async () => {
  const polled = [];
  const fetchImpl = async (url) => {
    polled.push(new URL(String(url)).pathname.split("/")[3]);
    return { status: 200, headers: { get: () => null }, json: async () => [] };
  };
  await tick(pollableCfg, baseState(), { fetchImpl, log: () => {} }); // no `redis` key
  assert.equal(polled.length, TARGETS.length);
  assert.deepEqual(polled.sort(), Object.values(REPO_NAMES).sort());
});
