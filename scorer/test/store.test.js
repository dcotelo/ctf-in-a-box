import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore, createRedisStore, solvesKey } from "../src/store.js";

const T0 = "2026-08-14T10:00:00.000Z";
const T1 = "2026-08-14T11:00:00.000Z";

test("memory store keeps first-solve timestamps; replays no-op", async () => {
  const store = createMemoryStore();
  await store.recordSolves("dvwa", "octocat", ["sqli-low", "xss-dom"], T0);
  await store.recordSolves("dvwa", "octocat", ["sqli-low"], T1); // replay
  assert.deepEqual(await store.getSolves("dvwa"), {
    "octocat:sqli-low": T0,
    "octocat:xss-dom": T0,
  });
  assert.deepEqual(await store.getSolves("juice-shop"), {}); // targets isolated
});

test("redis store: HSETNX command arrays via SRH pipeline, bearer token", async (t) => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    const commands = JSON.parse(opts.body);
    return new Response(JSON.stringify(commands.map(() => ({ result: 1 }))), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const store = createRedisStore({ url: "http://srh:80/", token: "redis-token" });
  await store.recordSolves("dvwa", "octocat", ["sqli-low", "xss-dom"], T0);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://srh:80/pipeline");
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.headers.authorization, "Bearer redis-token");
  // Monotonic writes: HSETNX only — a replay must never touch the timestamp.
  assert.deepEqual(JSON.parse(calls[0].opts.body), [
    ["HSETNX", "ctf:solves:dvwa", "octocat:sqli-low", T0],
    ["HSETNX", "ctf:solves:dvwa", "octocat:xss-dom", T0],
  ]);

  await store.recordSolves("dvwa", "octocat", [], T1);
  assert.equal(calls.length, 1); // nothing to write, no round-trip
});

test("redis store: HGETALL parses the flat field/value array", async (t) => {
  const bodies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return new Response(
      JSON.stringify([{ result: ["octocat:sqli-low", T0, "hubot:xss-dom", T1] }]),
      { status: 200 },
    );
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const store = createRedisStore({ url: "http://srh:80", token: "redis-token" });
  assert.deepEqual(await store.getSolves("dvwa"), {
    "octocat:sqli-low": T0,
    "hubot:xss-dom": T1,
  });
  assert.deepEqual(bodies, [[["HGETALL", "ctf:solves:dvwa"]]]);
});

test("redis store: HTTP failure and per-command errors throw", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  globalThis.fetch = async () => new Response("boom", { status: 503 });
  await assert.rejects(
    createRedisStore({ url: "http://srh:80", token: "redis-token" }).getSolves("dvwa"),
    /upstash pipeline: HTTP 503/,
  );

  globalThis.fetch = async () =>
    new Response(JSON.stringify([{ error: "WRONGTYPE" }]), { status: 200 });
  await assert.rejects(
    createRedisStore({ url: "http://srh:80", token: "redis-token" }).getSolves("dvwa"),
    /upstash: WRONGTYPE/,
  );
});

test("redis store refuses to build without URL/token", () => {
  assert.throws(() => createRedisStore({ url: "", token: "" }), /UPSTASH_REDIS_REST_URL\/TOKEN/);
});

test("solvesKey matches the ctf:solves:<target> data model", () => {
  assert.equal(solvesKey("juice-shop"), "ctf:solves:juice-shop");
});

test("memory store getTeams: [] by default, returns seeded teams with sorted members", async () => {
  const empty = createMemoryStore();
  assert.deepEqual(await empty.getTeams(), []);

  const store = createMemoryStore({
    teams: [
      { slug: "red-team", name: "Red Team", captain: "octocat", members: ["hubot", "octocat"] },
      { slug: "blue-team", name: "Blue Team", captain: "hal9000", members: ["zeus", "ada"] },
    ],
  });
  assert.deepEqual(await store.getTeams(), [
    { slug: "red-team", name: "Red Team", captain: "octocat", members: ["hubot", "octocat"] },
    { slug: "blue-team", name: "Blue Team", captain: "hal9000", members: ["ada", "zeus"] },
  ]);
});

test("redis store getTeams: SCANs ctf:team:*:members, HGET/SMEMBERS per slug", async (t) => {
  const bodies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    const commands = JSON.parse(opts.body);
    bodies.push(commands);
    if (commands[0][0] === "SCAN") {
      return new Response(
        JSON.stringify([{ result: ["0", ["ctf:team:red-team:members", "ctf:team:blue-team:members"]] }]),
        { status: 200 },
      );
    }
    // HGET name, HGET captain, SMEMBERS for red-team, then blue-team
    return new Response(
      JSON.stringify(
        [
          { result: "Red Team" },
          { result: "octocat" },
          { result: ["octocat", "hubot"] },
          { result: "Blue Team" },
          { result: "hal9000" },
          { result: ["zeus", "ada"] },
        ],
      ),
      { status: 200 },
    );
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const store = createRedisStore({ url: "http://srh:80", token: "redis-token" });
  assert.deepEqual(await store.getTeams(), [
    { slug: "red-team", name: "Red Team", captain: "octocat", members: ["hubot", "octocat"] },
    { slug: "blue-team", name: "Blue Team", captain: "hal9000", members: ["ada", "zeus"] },
  ]);
  assert.deepEqual(bodies[0], [["SCAN", "0", "MATCH", "ctf:team:*:members", "COUNT", 1000]]);
  assert.deepEqual(bodies[1], [
    ["HGET", "ctf:team:red-team", "name"],
    ["HGET", "ctf:team:red-team", "captain"],
    ["SMEMBERS", "ctf:team:red-team:members"],
    ["HGET", "ctf:team:blue-team", "name"],
    ["HGET", "ctf:team:blue-team", "captain"],
    ["SMEMBERS", "ctf:team:blue-team:members"],
  ]);
});

test("redis store getTeams: no teams -> []", async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify([{ result: ["0", []] }]), { status: 200 });
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const store = createRedisStore({ url: "http://srh:80", token: "redis-token" });
  assert.deepEqual(await store.getTeams(), []);
});

test("redis store getTeams: falls back to slug when name is empty", async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    const commands = JSON.parse(opts.body);
    if (commands[0][0] === "SCAN") {
      return new Response(
        JSON.stringify([{ result: ["0", ["ctf:team:nameless:members"]] }]),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify([{ result: null }, { result: "octocat" }, { result: ["octocat"] }]),
      { status: 200 },
    );
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const store = createRedisStore({ url: "http://srh:80", token: "redis-token" });
  assert.deepEqual(await store.getTeams(), [
    { slug: "nameless", name: "nameless", captain: "octocat", members: ["octocat"] },
  ]);
});
