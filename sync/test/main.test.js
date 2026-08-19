// main()'s half of the "a single module can run an event alone" contract.
//
// loadConfig returning `null` for an event.yaml with no polled module is only
// half the story — main() has to ACT on it: log, return, and let the process
// exit 0 so compose's `restart: on-failure` leaves it exited instead of
// restarting it forever. That guard was previously untested: deleting
// `if (!cfg) return` left the entire suite green, because main() was a
// module-private function no test could reach.
//
// Every collaborator is injected here, so these tests need no config file, no
// Redis, no GitHub, and — crucially — no way for the infinite poll loop to
// actually run away: `sleep` throws a sentinel to end the second iteration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "../src/index.js";

const STOP = new Error("stop-the-poll-loop");

function spyDeps(overrides = {}) {
  const calls = { readState: 0, makeRedis: 0, tick: [], writeState: [], sleep: [], log: [], logErr: [] };
  const deps = {
    log: (m) => calls.log.push(m),
    logErr: (m) => calls.logErr.push(m),
    readState: (p) => {
      calls.readState++;
      calls.statePath = p;
      return { repos: {} };
    },
    makeRedisImpl: () => {
      calls.makeRedis++;
      return { fake: "redis" };
    },
    runTick: async (cfg, state, opts) => {
      calls.tick.push({ cfg, state, opts });
      return state;
    },
    writeState: (p, s) => calls.writeState.push([p, s]),
    sleep: (ms) => {
      calls.sleep.push(ms);
      throw STOP; // one iteration is all we need to prove it entered the loop
    },
    ...overrides,
  };
  return { deps, calls };
}

test("a null config logs the reason and returns without starting the poller", async () => {
  const { deps, calls } = spyDeps({ load: () => null });

  await main(deps); // must RESOLVE — a throw here would exit nonzero and restart

  assert.deepEqual(calls.log, ["ctf-sync: no polled module enabled, nothing to do"]);
  // Nothing beyond the guard may have run: no state file read, no Redis
  // client, no tick, no sleep.
  assert.equal(calls.readState, 0);
  assert.equal(calls.makeRedis, 0);
  assert.deepEqual(calls.tick, []);
  assert.deepEqual(calls.sleep, []);
});

test("a valid config proceeds: state, redis, then the poll loop", async () => {
  const cfg = {
    org: "test-event-org",
    targets: ["dvwa", "vampi"],
    statePath: "/state/state.json",
    pollIntervalMs: 30000,
  };
  const { deps, calls } = spyDeps({ load: () => cfg });

  await assert.rejects(() => main(deps), (err) => err === STOP);

  assert.equal(calls.readState, 1);
  assert.equal(calls.statePath, "/state/state.json");
  assert.equal(calls.makeRedis, 1);
  assert.equal(calls.tick.length, 1);
  assert.equal(calls.tick[0].cfg, cfg);
  assert.equal(calls.tick[0].opts.redis.fake, "redis");
  // The tick's state is persisted before sleeping, under the config's path.
  assert.equal(calls.writeState.length, 1);
  assert.equal(calls.writeState[0][0], "/state/state.json");
  assert.equal(calls.writeState[0][1], calls.tick[0].state);
  // Slept around the configured interval (±20% jitter), not the raw value.
  assert.equal(calls.sleep.length, 1);
  assert.ok(calls.sleep[0] >= 24000 && calls.sleep[0] <= 36000, `slept ${calls.sleep[0]}ms`);
  // The startup banner names what it is polling; the no-op line must not appear.
  assert.match(calls.logErr[0], /polling 2 repos in test-event-org/);
  assert.deepEqual(calls.log, []);
});

test("the guard is on the config, not on a falsy-but-present one", async () => {
  // A config object is a config object even with zero ingested state: only
  // loadConfig's explicit `null` (no polled module) means "nothing to do".
  const cfg = { org: "o", targets: [], statePath: "/s", pollIntervalMs: 1000 };
  const { deps, calls } = spyDeps({ load: () => cfg });

  await assert.rejects(() => main(deps), (err) => err === STOP);

  assert.equal(calls.tick.length, 1);
  assert.deepEqual(calls.log, []);
});
