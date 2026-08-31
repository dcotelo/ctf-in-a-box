// Authoring rules for ai challenges. The two that are NEW (no classic
// equivalent) get the most attention: a launch template must carry the
// {token} placeholder, and every challenge must end up with a signing key —
// minted on create, preserved on edit, replaced only by an explicit rotate.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upstashEval: vi.fn(), upstashPipeline: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({ upstashEval: mocks.upstashEval, upstashPipeline: mocks.upstashPipeline }));

import {
  AiValidationError,
  clearAiChallenges,
  deleteAiChallenge,
  rotateAiSigningKey,
  setAiCategories,
  upsertAiChallenge,
  type AiChallenge,
} from "@/lib/ai-store";

const pipelineCalls = (): (string | number)[][][] =>
  mocks.upstashPipeline.mock.calls.map((call) => call[0] as (string | number)[][]);

/** Next reply: `GET ctf:ai:categories` — upsert reads the list before writing. */
function categoriesReply(names: string[]) {
  mocks.upstashPipeline.mockResolvedValueOnce([{ result: JSON.stringify(names) }]);
}
/** Next reply: `HSETNX ctf:ai:signkey <id> <candidate>` followed by
 *  `HGET ctf:ai:signkey <id>`, in ONE pipeline — the atomic mint-or-preserve.
 *  `hgetResult` is the value every racer converges on: it is what actually
 *  ended up persisted, regardless of whether THIS call's own HSETNX planted
 *  it or lost to a concurrent one. The HSETNX reply itself is never inspected
 *  by the code (only the follow-up HGET is), so its value here is a
 *  placeholder. */
function signingKeyReply(hgetResult: string | null) {
  mocks.upstashPipeline.mockResolvedValueOnce([{ result: 1 }, { result: hgetResult }]);
}
function writeReply(n: number) {
  mocks.upstashPipeline.mockResolvedValueOnce(Array.from({ length: n }, () => ({ result: 1 })));
}

const CHALLENGE: AiChallenge = {
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

describe("upsertAiChallenge", () => {
  it("mints a signing key on create and writes every hash in one pipeline", async () => {
    categoriesReply(["Injection"]);
    signingKeyReply(null);
    writeReply(5);

    const row = await upsertAiChallenge(CHALLENGE, { flag: "CTF{leak}" });

    expect(row.challenge).toEqual(CHALLENGE);
    expect(row.flag).toBe("CTF{leak}");
    expect(row.signingKey.startsWith("aik_")).toBe(true);

    const writes = pipelineCalls()[2];
    expect(writes).toEqual([
      ["HSET", "ctf:ai:challenges", CHALLENGE.id, JSON.stringify(CHALLENGE)],
      ["HSET", "ctf:ai:flag", CHALLENGE.id, "CTF{leak}"],
      ["HSET", "ctf:ai:flagnorm", CHALLENGE.id, "ctf{leak}"],
      ["HDEL", "ctf:ai:hints", CHALLENGE.id],
      ["HSET", "ctf:ai:signkey", CHALLENGE.id, row.signingKey],
    ]);
  });

  it("keeps the existing key on edit — an edit that rotated silently would break a live integration", async () => {
    categoriesReply(["Injection"]);
    signingKeyReply("aik_existing");
    writeReply(5);

    const row = await upsertAiChallenge({ ...CHALLENGE, title: "Renamed" }, { flag: "CTF{leak}" });

    expect(row.signingKey).toBe("aik_existing");
    expect(JSON.stringify(pipelineCalls()[2])).toContain("aik_existing");
  });

  it("stores an event-only challenge with no flag at all", async () => {
    categoriesReply(["Injection"]);
    signingKeyReply(null);
    writeReply(5);

    const row = await upsertAiChallenge({ ...CHALLENGE, mode: "event" }, {});

    expect(row.flag).toBe("");
    const writes = pipelineCalls()[2];
    expect(writes).toContainEqual(["HDEL", "ctf:ai:flag", CHALLENGE.id]);
    expect(writes).toContainEqual(["HDEL", "ctf:ai:flagnorm", CHALLENGE.id]);
  });

  it("requires a flag when the mode grades one", async () => {
    categoriesReply(["Injection"]);
    await expect(upsertAiChallenge({ ...CHALLENGE, mode: "flag" }, {})).rejects.toThrow(AiValidationError);
  });

  it("rejects a template with no {token} placeholder", async () => {
    categoriesReply(["Injection"]);
    await expect(
      upsertAiChallenge({ ...CHALLENGE, urlTemplate: "https://game.example.com/play" }, { flag: "CTF{leak}" }),
    ).rejects.toThrow(/\{token\}/);
  });

  it("rejects an unknown category, a bad id, and non-integer or over-cap points", async () => {
    categoriesReply(["Injection"]);
    await expect(upsertAiChallenge({ ...CHALLENGE, category: "Nope" }, { flag: "f" })).rejects.toThrow(
      AiValidationError,
    );
    await expect(upsertAiChallenge({ ...CHALLENGE, id: "bad id!" }, { flag: "f" })).rejects.toThrow(
      AiValidationError,
    );
    categoriesReply(["Injection"]);
    await expect(upsertAiChallenge({ ...CHALLENGE, points: 1.5 }, { flag: "f" })).rejects.toThrow(
      AiValidationError,
    );
    categoriesReply(["Injection"]);
    await expect(upsertAiChallenge({ ...CHALLENGE, points: 1e21 }, { flag: "f" })).rejects.toThrow(
      AiValidationError,
    );
  });

  it("stores the case-sensitive comparison form when the challenge asks for it", async () => {
    categoriesReply(["Injection"]);
    signingKeyReply(null);
    writeReply(5);

    await upsertAiChallenge({ ...CHALLENGE, caseSensitive: true }, { flag: "CTF{Leak}" });

    expect(pipelineCalls()[2]).toContainEqual(["HSET", "ctf:ai:flagnorm", CHALLENGE.id, "CTF{Leak}"]);
  });

  it("converges on the persisted key when two mints race — the loser must return what was actually saved, not its own discarded candidate", async () => {
    categoriesReply(["Injection"]);
    // HSETNX loses this race (another caller's mint already won); HGET
    // reports the key that ACTUALLY ended up persisted. The candidate this
    // call generated internally must never surface anywhere.
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: 0 }, { result: "aik_winner" }]);
    writeReply(5);

    const row = await upsertAiChallenge(CHALLENGE, { flag: "CTF{leak}" });

    expect(row.signingKey).toBe("aik_winner");
    expect(pipelineCalls()[2]).toContainEqual(["HSET", "ctf:ai:signkey", CHALLENGE.id, "aik_winner"]);
  });
});

describe("rotateAiSigningKey", () => {
  it("replaces the key and returns the new one", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: JSON.stringify(CHALLENGE) }]);
    writeReply(1);

    const key = await rotateAiSigningKey(CHALLENGE.id);

    expect(key.startsWith("aik_")).toBe(true);
    expect(pipelineCalls()[1]).toEqual([["HSET", "ctf:ai:signkey", CHALLENGE.id, key]]);
  });

  it("refuses to mint a key for a challenge that does not exist", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([{ result: null }]);
    await expect(rotateAiSigningKey("ghost-000000")).rejects.toThrow(AiValidationError);
    expect(pipelineCalls()).toHaveLength(1);
  });
});

describe("deleteAiChallenge", () => {
  it("removes the record and every secret that hangs off it", async () => {
    writeReply(6);
    await deleteAiChallenge(CHALLENGE.id);
    expect(pipelineCalls()[0]).toEqual([
      ["HDEL", "ctf:ai:challenges", CHALLENGE.id],
      ["HDEL", "ctf:ai:flag", CHALLENGE.id],
      ["HDEL", "ctf:ai:flagnorm", CHALLENGE.id],
      ["HDEL", "ctf:ai:hints", CHALLENGE.id],
      ["HDEL", "ctf:ai:signkey", CHALLENGE.id],
      ["HDEL", "ctf:ai:solvecount", CHALLENGE.id],
    ]);
  });

  it("surfaces a failed delete instead of leaving a live key behind", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([{ error: "boom" }]);
    await expect(deleteAiChallenge(CHALLENGE.id)).rejects.toThrow(/boom/);
  });
});

describe("clearAiChallenges", () => {
  it("wipes every content key in one pipeline", async () => {
    writeReply(7);
    await clearAiChallenges();
    expect(pipelineCalls()[0]).toEqual([
      ["DEL", "ctf:ai:challenges"],
      ["DEL", "ctf:ai:flag"],
      ["DEL", "ctf:ai:flagnorm"],
      ["DEL", "ctf:ai:hints"],
      ["DEL", "ctf:ai:signkey"],
      ["DEL", "ctf:ai:categories"],
      ["DEL", "ctf:ai:solvecount"],
    ]);
  });

  it("surfaces a failed clear instead of leaving stale content behind", async () => {
    mocks.upstashPipeline.mockResolvedValueOnce([{ error: "boom" }]);
    await expect(clearAiChallenges()).rejects.toThrow(/boom/);
  });
});

describe("setAiCategories", () => {
  it("trims, dedupes and stores the organizer's order", async () => {
    writeReply(1);
    expect(await setAiCategories([" Injection ", "Jailbreak", "Injection"])).toEqual(["Injection", "Jailbreak"]);
    expect(pipelineCalls()[0]).toEqual([
      ["SET", "ctf:ai:categories", JSON.stringify(["Injection", "Jailbreak"])],
    ]);
  });

  it("rejects an over-long name and an over-long list", async () => {
    await expect(setAiCategories(["x".repeat(65)])).rejects.toThrow(AiValidationError);
    await expect(setAiCategories(Array.from({ length: 51 }, (_, i) => `c${i}`))).rejects.toThrow(AiValidationError);
  });
});
