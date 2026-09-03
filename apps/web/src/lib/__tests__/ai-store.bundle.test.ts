// ai's bundle export/import — the half of #155 the event archive was
// missing (#250). Mirrors classic-store's contract: export reads the
// admin-gated list (flags AS AUTHORED, hints, signing keys) plus the category
// list; import is a union on categories and an upsert on challenges, written
// field by field the way `upsertAiChallenge` writes them, and mints a signing
// key for any challenge the bundle does not carry one for. `ctf:ai:launchkey`
// is module identity, not catalogue content — neither direction may touch it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upstashEval: vi.fn(), upstashPipeline: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/upstash", () => ({ upstashEval: mocks.upstashEval, upstashPipeline: mocks.upstashPipeline }));

import { exportBundle, importBundle } from "@/lib/ai-store";
import { AI_BUNDLE_VERSION, type AiBundle } from "@/lib/ai-io";
import { AI_LAUNCHKEY_KEY } from "@/lib/ai-keys";
import { flagComparisonForm } from "@/lib/classic-keys";

const pipelineCalls = (): (string | number)[][][] =>
  mocks.upstashPipeline.mock.calls.map((call) => call[0] as (string | number)[][]);

const flat = (obj: Record<string, string>) => Object.entries(obj).flat();

const stored = {
  graded: {
    id: "pi-one-ab12cd",
    title: "One",
    category: "Prompt Injection",
    description: "d1",
    points: 50,
    order: 0,
    mode: "both",
    urlTemplate: "https://ai.example/one?t={token}",
    caseSensitive: true,
  },
  eventOnly: {
    id: "gr-two-ab12cd",
    title: "Two",
    category: "Guardrails",
    description: "d2",
    points: 20,
    order: 1,
    mode: "event",
    urlTemplate: "https://ai.example/two?t={token}",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("exportBundle (ai)", () => {
  it("carries each challenge with its flag, hint and signing key, omitting what is unset, in board order", async () => {
    mocks.upstashPipeline
      // listAiChallengesForAdmin: HGETALL challenges, flag, hints, signkey
      .mockResolvedValueOnce([
        { result: flat({ [stored.graded.id]: JSON.stringify(stored.graded), [stored.eventOnly.id]: JSON.stringify(stored.eventOnly) }) },
        { result: flat({ [stored.graded.id]: "ctfbox{One}" }) },
        { result: flat({ [stored.graded.id]: "Ask nicely." }) },
        { result: flat({ [stored.graded.id]: "aik_one", [stored.eventOnly.id]: "aik_two" }) },
      ])
      // listAiCategories: GET
      .mockResolvedValueOnce([{ result: JSON.stringify(["Prompt Injection", "Guardrails"]) }]);

    const bundle = await exportBundle();
    expect(bundle).toEqual({
      version: AI_BUNDLE_VERSION,
      categories: ["Prompt Injection", "Guardrails"],
      challenges: [
        // 20 points sorts before 50: cheapest first, same rule as the board.
        {
          id: "gr-two-ab12cd",
          title: "Two",
          category: "Guardrails",
          description: "d2",
          points: 20,
          order: 1,
          mode: "event",
          urlTemplate: "https://ai.example/two?t={token}",
          signingKey: "aik_two",
        },
        {
          id: "pi-one-ab12cd",
          title: "One",
          category: "Prompt Injection",
          description: "d1",
          points: 50,
          order: 0,
          mode: "both",
          urlTemplate: "https://ai.example/one?t={token}",
          caseSensitive: true,
          flag: "ctfbox{One}",
          hint: "Ask nicely.",
          signingKey: "aik_one",
        },
      ],
    });
    // Never the launch keypair: identity, not content.
    expect(JSON.stringify(pipelineCalls())).not.toContain(AI_LAUNCHKEY_KEY);
  });

  it("refuses to export a graded challenge that has no flag row, naming it — the bundle would be unimportable", async () => {
    mocks.upstashPipeline
      .mockResolvedValueOnce([
        { result: flat({ [stored.graded.id]: JSON.stringify(stored.graded) }) },
        { result: [] }, // no ctf:ai:flag row at all
        { result: [] },
        { result: flat({ [stored.graded.id]: "aik_one" }) },
      ])
      .mockResolvedValueOnce([{ result: JSON.stringify(["Prompt Injection"]) }]);
    await expect(exportBundle()).rejects.toThrow(/pi-one-ab12cd.*no flag/);
  });

  it("never emits a flag for an event-only challenge, even if a stale flag row exists", async () => {
    mocks.upstashPipeline
      .mockResolvedValueOnce([
        { result: flat({ [stored.eventOnly.id]: JSON.stringify(stored.eventOnly) }) },
        { result: flat({ [stored.eventOnly.id]: "ctfbox{stale}" }) },
        { result: [] },
        { result: flat({ [stored.eventOnly.id]: "aik_two" }) },
      ])
      .mockResolvedValueOnce([{ result: JSON.stringify(["Guardrails"]) }]);
    const bundle = await exportBundle();
    expect(bundle.challenges).toHaveLength(1);
    expect("flag" in bundle.challenges[0]).toBe(false);
    expect(JSON.stringify(bundle)).not.toContain("ctfbox{stale}");
  });
});

describe("importBundle (ai)", () => {
  const bundle: AiBundle = {
    version: AI_BUNDLE_VERSION,
    categories: ["web", "Guardrails"],
    challenges: [
      {
        id: "pi-one-ab12cd",
        title: "  One  ",
        category: "web",
        description: "d1",
        points: 50,
        order: 0,
        mode: "both",
        urlTemplate: "https://ai.example/one?t={token}",
        flag: " ctfbox{One} ",
        hint: " Ask nicely. ",
        signingKey: "aik_one",
        caseSensitive: true,
      },
      {
        id: "gr-two-ab12cd",
        title: "Two",
        category: "Guardrails",
        description: "d2",
        points: 20,
        order: 1,
        mode: "event",
        urlTemplate: "https://ai.example/two?t={token}",
      },
    ],
  };

  function seedExisting(ids: string[], categories: string[]) {
    mocks.upstashPipeline
      .mockResolvedValueOnce([{ result: ids }, { result: JSON.stringify(categories) }]) // HKEYS, GET
      .mockResolvedValueOnce([]); // the write pipeline
  }

  it("counts created vs updated against the existing ids and unions categories, canonicalizing spellings to the store's", async () => {
    seedExisting(["gr-two-ab12cd"], ["Web"]);
    const summary = await importBundle(bundle);
    expect(summary).toEqual({ created: 1, updated: 1, categories: 2 });

    const writes = pipelineCalls()[1];
    const set = writes.find((c) => c[0] === "SET");
    expect(set).toEqual(["SET", "ctf:ai:categories", JSON.stringify(["Web", "Guardrails"])]);
    // The bundle spelt it "web"; the record is written under the surviving "Web".
    const record = writes.find((c) => c[0] === "HSET" && c[1] === "ctf:ai:challenges" && c[2] === "pi-one-ab12cd");
    expect(JSON.parse(String(record?.[3]))).toEqual({
      id: "pi-one-ab12cd",
      title: "One",
      category: "Web",
      description: "d1",
      points: 50,
      order: 0,
      mode: "both",
      urlTemplate: "https://ai.example/one?t={token}",
      caseSensitive: true,
    });
  });

  it("writes the secrets the way upsertAiChallenge does: flag + comparison form + hint for a graded row, HDELs for an event-only one", async () => {
    seedExisting([], []);
    await importBundle(bundle);
    const writes = pipelineCalls()[1];
    expect(writes).toContainEqual(["HSET", "ctf:ai:flag", "pi-one-ab12cd", "ctfbox{One}"]);
    expect(writes).toContainEqual(["HSET", "ctf:ai:flagnorm", "pi-one-ab12cd", flagComparisonForm("ctfbox{One}", true)]);
    expect(writes).toContainEqual(["HSET", "ctf:ai:hints", "pi-one-ab12cd", "Ask nicely."]);
    expect(writes).toContainEqual(["HDEL", "ctf:ai:flag", "gr-two-ab12cd"]);
    expect(writes).toContainEqual(["HDEL", "ctf:ai:flagnorm", "gr-two-ab12cd"]);
    expect(writes).toContainEqual(["HDEL", "ctf:ai:hints", "gr-two-ab12cd"]);
    // The event-only record carries no caseSensitive and no flag anywhere.
    const record = writes.find((c) => c[0] === "HSET" && c[1] === "ctf:ai:challenges" && c[2] === "gr-two-ab12cd");
    expect(JSON.parse(String(record?.[3]))).toEqual(stored.eventOnly);
  });

  it("restores a carried signing key verbatim and MINTS one (HSETNX, never overwriting) for a challenge without", async () => {
    seedExisting([], []);
    await importBundle(bundle);
    const writes = pipelineCalls()[1];
    expect(writes).toContainEqual(["HSET", "ctf:ai:signkey", "pi-one-ab12cd", "aik_one"]);
    const minted = writes.find((c) => c[1] === "ctf:ai:signkey" && c[2] === "gr-two-ab12cd");
    expect(minted?.[0]).toBe("HSETNX");
    expect(String(minted?.[3])).toMatch(/^aik_[A-Za-z0-9_-]{40,}$/);
  });

  it("never touches the launch keypair", async () => {
    seedExisting([], []);
    await importBundle(bundle);
    expect(JSON.stringify(pipelineCalls())).not.toContain(AI_LAUNCHKEY_KEY);
  });

  it("surfaces a per-command error instead of reporting success", async () => {
    mocks.upstashPipeline
      .mockResolvedValueOnce([{ result: [] }, { result: null }])
      .mockResolvedValueOnce([{ result: 1 }, { error: "WRONGTYPE" }]);
    await expect(importBundle(bundle)).rejects.toThrow(/WRONGTYPE/);
  });
});
