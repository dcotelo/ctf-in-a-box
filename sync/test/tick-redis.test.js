import test from "node:test";
import assert from "node:assert/strict";
import { tick } from "../src/index.js";

const cfg = { targets: ["vampi"], org: "o", commentAuthor: "github-actions[bot]" };
const baseState = () => ({ repos: {}, ingested: 0 });

test("a paused flag holds every cursor and still writes a paused heartbeat", async () => {
  let status = null;
  const redis = { isPaused: async () => true, writeStatus: async (s) => { status = s; } };
  const state = baseState();
  state.repos["VAmPI"] = { since: "T0", etag: "E0", seen: ["x"] };
  const fetchImpl = () => { throw new Error("must not poll while paused"); };
  await tick(cfg, state, { redis, fetchImpl, log: () => {} });
  assert.deepEqual(state.repos["VAmPI"], { since: "T0", etag: "E0", seen: ["x"] });
  assert.equal(status.paused, true);
});

test("an unpaused tick writes a heartbeat with paused false", async () => {
  let status = null;
  const redis = { isPaused: async () => false, writeStatus: async (s) => { status = s; } };
  const fetchImpl = async () => ({
    status: 200, headers: { get: () => null }, json: async () => [],
  });
  await tick(cfg, baseState(), { redis, fetchImpl, log: () => {} });
  assert.equal(status.paused, false);
  assert.ok(status.lastPollAt);
});

test("a redis status-write failure does not throw out of the tick", async () => {
  const redis = { isPaused: async () => false, writeStatus: async () => { throw new Error("down"); } };
  const fetchImpl = async () => ({ status: 200, headers: { get: () => null }, json: async () => [] });
  await assert.doesNotReject(tick(cfg, baseState(), { redis, fetchImpl, log: () => {} }));
});
