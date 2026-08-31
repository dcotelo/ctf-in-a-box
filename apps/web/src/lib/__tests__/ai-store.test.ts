// Read paths for the ai store — and above all, the secrecy boundary. Four
// SECRET hashes hang off this module (`ctf:ai:flag`, `ctf:ai:flagnorm`,
// `ctf:ai:hints`, `ctf:ai:signkey`), and the signing key is the worst of them
// to leak: one leaked key lets its holder assert solves on that challenge for
// anyone who has opened it. The contestant path must issue no command that
// even NAMES those keys.
//
// Authoring (upsert/rotate/delete) lives in ai-store.authoring.test.ts and
// grading in ai-store.grade.test.ts — the latter needs a partial
// `@/lib/admin-store` mock, and forcing all three into one file would mean a
// compromised mock for all of them.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upstashEval: vi.fn(), upstashPipeline: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({ upstashEval: mocks.upstashEval, upstashPipeline: mocks.upstashPipeline }));

import {
  claimAiNonce,
  getAiSigningKey,
  getAiSolveCounts,
  getAiTotals,
  getTeamAiTotalsBatch,
  getViewerAi,
  listAiCategories,
  listAiChallenges,
  listAiChallengesForAdmin,
} from "@/lib/ai-store";
import { AI_NONCE_TTL_SEC } from "@/lib/ai-defaults";

const pipelineCalls = (): (string | number)[][][] =>
  mocks.upstashPipeline.mock.calls.map((call) => call[0] as (string | number)[][]);

/** Every key name a contestant-facing read must never touch. */
const SECRET_KEYS = ["ctf:ai:flag", "ctf:ai:flagnorm", "ctf:ai:hints", "ctf:ai:signkey"];

const CHALLENGE = {
  id: "prompt-leak-ab12cd",
  title: "Prompt leak",
  category: "Injection",
  description: "Make it spill.",
  points: 300,
  order: 1,
  mode: "both",
  urlTemplate: "https://game.example.com/play?t={token}",
};

beforeEach(() => {
  mocks.upstashPipeline.mockReset();
  mocks.upstashEval.mockReset();
});

describe("listAiChallenges", () => {
  it("returns public-safe records in board order and touches no secret key", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([
      {
        result: [
          "guardrail-cd34ef",
          JSON.stringify({ ...CHALLENGE, id: "guardrail-cd34ef", title: "Guardrail", points: 400, order: 2 }),
          CHALLENGE.id,
          JSON.stringify(CHALLENGE),
        ],
      },
    ]);

    const rows = await listAiChallenges();

    expect(rows.map((c) => c.id)).toEqual(["prompt-leak-ab12cd", "guardrail-cd34ef"]);
    expect(rows[0]).toEqual(CHALLENGE);
    const named = JSON.stringify(pipelineCalls());
    for (const key of SECRET_KEYS) expect(named).not.toContain(key);
  });

  it("strips secrets that were stored INSIDE the challenge record — the poisoned-record leak test", async () => {
    // Naming no secret key proves the outgoing commands are clean; it says
    // nothing about the returned payload. Someone simplifying parseChallenge to
    // `return parsed as AiChallenge` (the type checks above it look redundant)
    // would flow a poisoned record straight into /ai's payload with every other
    // test still green. This is the test that notices.
    const poisoned = JSON.stringify({
      ...CHALLENGE,
      flag: "CTF{leak}",
      flagnorm: "ctf{leak}",
      hint: "Try asking twice.",
      signingKey: "aik_secret",
    });
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: [CHALLENGE.id, poisoned] }]);

    const rows = await listAiChallenges();

    expect(rows).toEqual([CHALLENGE]);
    expect(Object.keys(rows[0]).sort()).toEqual(Object.keys(CHALLENGE).sort());
    const payload = JSON.stringify(rows);
    for (const secret of ["CTF{leak}", "ctf{leak}", "aik_secret", "Try asking twice."]) {
      expect(payload).not.toContain(secret);
    }
  });

  it("drops an unparseable or mode-less record rather than rendering a broken tile", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([
      { result: ["bad-1", "{not json", "bad-2", JSON.stringify({ ...CHALLENGE, mode: "nope" }), CHALLENGE.id, JSON.stringify(CHALLENGE)] },
    ]);
    expect((await listAiChallenges()).map((c) => c.id)).toEqual([CHALLENGE.id]);
  });
});

describe("listAiChallengesForAdmin", () => {
  it("returns the flag, hint and signing key in their own fields, nested off the public record", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([
      { result: [CHALLENGE.id, JSON.stringify(CHALLENGE)] },
      { result: [CHALLENGE.id, "CTF{leak}"] },
      { result: [CHALLENGE.id, "Try asking twice."] },
      { result: [CHALLENGE.id, "aik_secret"] },
    ]);

    const rows = await listAiChallengesForAdmin();

    expect(rows).toEqual([
      { challenge: CHALLENGE, flag: "CTF{leak}", hint: "Try asking twice.", signingKey: "aik_secret" },
    ]);
    // Reads every hash in ONE pipeline, so the four come from one instant.
    expect(pipelineCalls()).toHaveLength(1);
  });

  it("reports a challenge with no key or flag rather than inventing either", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([
      { result: [CHALLENGE.id, JSON.stringify(CHALLENGE)] },
      { result: [] },
      { result: [] },
      { result: [] },
    ]);
    expect(await listAiChallengesForAdmin()).toEqual([
      { challenge: CHALLENGE, flag: "", hint: null, signingKey: "" },
    ]);
  });
});

describe("getAiSigningKey", () => {
  it("reads ONE field of ONE hash — never the other three secrets", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: "aik_secret" }]);

    expect(await getAiSigningKey(CHALLENGE.id)).toBe("aik_secret");

    // The whole point of this function over listAiChallengesForAdmin: a route
    // that needs one key must not pull every flag and every key in the event
    // into a request handler that answers the public internet.
    expect(pipelineCalls()).toEqual([[["HGET", "ctf:ai:signkey", CHALLENGE.id]]]);
    const named = JSON.stringify(pipelineCalls());
    for (const key of ["ctf:ai:flag", "ctf:ai:flagnorm", "ctf:ai:hints", "ctf:ai:challenges"]) {
      expect(named).not.toContain(key);
    }
  });

  it("returns null — never '' — for a missing row, a non-string reply or a bad id", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: null }]);
    expect(await getAiSigningKey(CHALLENGE.id)).toBeNull();

    mocks.upstashPipeline.mockResolvedValueOnce([{ result: 1 }]);
    expect(await getAiSigningKey(CHALLENGE.id)).toBeNull();

    // An empty stored key is a KEYLESS row, not a usable key: ai-token.ts
    // throws on "" precisely because an empty HMAC key is guessable.
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: "" }]);
    expect(await getAiSigningKey(CHALLENGE.id)).toBeNull();

    expect(await getAiSigningKey("bad id!")).toBeNull();
    expect(pipelineCalls()).toHaveLength(3); // the bad id cost no round trip
  });
});

describe("claimAiNonce", () => {
  // This is the single check between a captured signed request and unlimited
  // re-awards, so it fails CLOSED — the deliberate opposite of the pause gate.
  it("claims a fresh jti atomically with SET NX EX", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: "OK" }]);

    expect(await claimAiNonce("jti-1")).toBe(true);

    const [[cmd]] = pipelineCalls();
    expect(cmd[0]).toBe("SET");
    expect(cmd[1]).toBe("ctf:ai:nonce:jti-1");
    // NX (claim-or-lose in ONE round trip; a GET-then-SET would let two copies
    // of the same captured request both see "not seen yet") and a TTL.
    expect(cmd.slice(3)).toEqual(["NX", "EX", AI_NONCE_TTL_SEC]);
  });

  it("refuses a replay — a null reply means someone else already claimed it", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: null }]);
    expect(await claimAiNonce("jti-1")).toBe(false);
  });

  it("fails CLOSED when Redis throws", async () => {
    mocks.upstashPipeline.mockRejectedValueOnce(new Error("redis down"));
    expect(await claimAiNonce("jti-1")).toBe(false);
  });

  it("fails CLOSED on a per-command error", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([{ error: "ERR syntax" }]);
    expect(await claimAiNonce("jti-1")).toBe(false);
  });

  it("fails CLOSED on any reply it does not recognise", async () => {
    for (const result of [1, "ok", true, {}, [], undefined]) {
      mocks.upstashPipeline.mockResolvedValueOnce([{ result }]);
      expect(await claimAiNonce("jti-1")).toBe(false);
    }
  });

  it("refuses an empty or non-string jti without a round trip", async () => {
    expect(await claimAiNonce("")).toBe(false);
    expect(await claimAiNonce(undefined as unknown as string)).toBe(false);
    expect(pipelineCalls()).toHaveLength(0);
  });
});

describe("listAiCategories", () => {
  it("reads the organizer's order, and an absent value is an empty board", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: JSON.stringify(["Injection", "Jailbreak"]) }]);
    expect(await listAiCategories()).toEqual(["Injection", "Jailbreak"]);

    mocks.upstashPipeline.mockResolvedValueOnce([{ result: null }]);
    expect(await listAiCategories()).toEqual([]);
  });
});

describe("getViewerAi", () => {
  it("returns solves and attempts for one login, keeping the solve source", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([
      { result: [CHALLENGE.id, JSON.stringify({ points: 300, at: "2026-08-31T11:00:00.000Z", source: "event" })] },
      { result: [CHALLENGE.id, JSON.stringify({ attempts: 2, lastAt: "2026-08-31T11:02:00.000Z" })] },
    ]);

    expect(await getViewerAi("alice")).toEqual({
      solved: { [CHALLENGE.id]: { points: 300, at: "2026-08-31T11:00:00.000Z", source: "event" } },
      attempts: { [CHALLENGE.id]: { attempts: 2, lastAt: "2026-08-31T11:02:00.000Z" } },
    });
    expect(pipelineCalls()[0]).toEqual([
      ["HGETALL", "ctf:ai:solves:alice"],
      ["HGETALL", "ctf:ai:attempts:alice"],
    ]);
  });

  it("strips secrets a poisoned solve or attempt row carries", async () => {
    // A solve row is written by AWARD_SCRIPT, but the archive import (#155)
    // writes them too, so a hand-edited bundle can plant extra fields here.
    mocks.upstashPipeline.mockResolvedValueOnce([
      {
        result: [
          CHALLENGE.id,
          JSON.stringify({ points: 300, at: "2026-08-31T11:00:00.000Z", source: "event", flag: "CTF{leak}" }),
        ],
      },
      {
        result: [
          CHALLENGE.id,
          JSON.stringify({ attempts: 2, lastAt: "2026-08-31T11:02:00.000Z", signingKey: "aik_secret" }),
        ],
      },
    ]);

    const viewer = await getViewerAi("alice");

    expect(Object.keys(viewer.solved[CHALLENGE.id]).sort()).toEqual(["at", "points", "source"]);
    expect(Object.keys(viewer.attempts[CHALLENGE.id]).sort()).toEqual(["attempts", "lastAt"]);
    const payload = JSON.stringify(viewer);
    expect(payload).not.toContain("CTF{leak}");
    expect(payload).not.toContain("aik_secret");
  });

  it("defaults a legacy solve row with no source to the graded path", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([
      { result: [CHALLENGE.id, JSON.stringify({ points: 300, at: "2026-08-31T11:00:00.000Z" })] },
      { result: [] },
    ]);
    expect((await getViewerAi("alice")).solved[CHALLENGE.id].source).toBe("flag");
  });
});

describe("totals", () => {
  it("folds the two aggregate hashes into per-login totals", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([
      { result: ["alice", "700", "bob", "300"] },
      { result: ["alice", "2", "bob", "1"] },
    ]);
    expect(await getAiTotals()).toEqual(
      new Map([
        ["alice", { points: 700, solved: 2, lastAt: null }],
        ["bob", { points: 300, solved: 1, lastAt: null }],
      ]),
    );
  });

  it("counts distinct solvers per challenge", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: [CHALLENGE.id, "4"] }]);
    expect(await getAiSolveCounts()).toEqual(new Map([[CHALLENGE.id, 4]]));
  });

  it("unions a team's solves instead of summing member aggregates", async () => {
    const solve = JSON.stringify({ points: 300, at: "2026-08-31T11:00:00.000Z" });
    mocks.upstashPipeline.mockResolvedValueOnce([
      { result: [CHALLENGE.id, solve] },
      { result: [CHALLENGE.id, solve] },
    ]);
    const [team] = await getTeamAiTotalsBatch([["alice", "bob"]]);
    expect(team.points).toBe(300);
    expect(team.solved).toBe(1);
  });

  it("costs zero round trips for an empty team list", async () => {
    expect(await getTeamAiTotalsBatch([[]])).toEqual([{ points: 0, solved: 0, lastAt: null }]);
    expect(pipelineCalls()).toHaveLength(0);
  });
});
