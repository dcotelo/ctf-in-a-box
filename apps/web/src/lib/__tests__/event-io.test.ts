import { describe, expect, it } from "vitest";
import {
  EVENT_BUNDLE_VERSION,
  parseEventBundle,
  serializeEventBundle,
  type EventBundle,
} from "@/lib/event-io";

const valid: EventBundle = {
  version: 1,
  kind: "archive",
  event: { name: "Demo CTF", theme: "web", dates: "2026", location: "online", ctfStartsAt: null },
  settings: { hintCost: 50, teamMaxMembers: 4, enabledModuleIds: ["classic", "quiz"], classicCooldownSec: 45, aiCooldownSec: 12 },
  classic: {
    version: 1,
    categories: ["Web"],
    challenges: [{ id: "web-one-ab12cd", title: "One", category: "Web", description: "hi", points: 50, order: 0, flag: "ctfbox{One}" }],
  },
  quiz: {
    version: 1,
    questions: [{ id: "q-one-ab12cd", prompt: "P?", type: "single", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }], points: 10, order: 0, correct: ["a"] }],
  },
  ai: {
    version: 1,
    categories: ["Prompt Injection"],
    challenges: [
      {
        id: "pi-one-ab12cd",
        title: "One",
        category: "Prompt Injection",
        description: "hi",
        points: 50,
        order: 0,
        mode: "both",
        urlTemplate: "https://ai.example/one?t={token}",
        flag: "ctfbox{One}",
        signingKey: "aik_one",
      },
    ],
  },
};

describe("parseEventBundle", () => {
  it("accepts a well-formed bundle and round-trips its serialization", () => {
    const res = parseEventBundle(serializeEventBundle(valid));
    if (!res.ok) throw new Error(JSON.stringify(res.errors));
    expect(res.bundle).toEqual(valid);
  });

  it("reports malformed JSON as one generic error with no input echoed", () => {
    const res = parseEventBundle('{not json ctfbox{secret}');
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].where).toBe("(document)");
    expect(JSON.stringify(res.errors)).not.toContain("secret");
  });

  it("refuses a newer bundle version, no partial apply", () => {
    const res = parseEventBundle(JSON.stringify({ ...valid, version: EVENT_BUNDLE_VERSION + 1 }));
    expect(res.ok).toBe(false);
  });

  it("refuses a non-archive kind", () => {
    const res = parseEventBundle(JSON.stringify({ ...valid, kind: "backup" }));
    expect(res.ok).toBe(false);
  });

  it("refuses settings carrying a schedule/run field", () => {
    const res = parseEventBundle(JSON.stringify({ ...valid, settings: { ...valid.settings, scoringStartsAt: "2026-01-01T00:00:00Z" } }));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.errors.some((e) => e.where === "settings")).toBe(true);
  });

  it("refuses settings carrying paused", () => {
    const res = parseEventBundle(JSON.stringify({ ...valid, settings: { ...valid.settings, paused: true } }));
    expect(res.ok).toBe(false);
  });

  it("folds embedded classic errors under a classic prefix", () => {
    const bad = { ...valid, classic: { ...valid.classic, challenges: [{ ...valid.classic!.challenges[0], points: -5 }] } };
    const res = parseEventBundle(JSON.stringify(bad));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.errors.some((e) => e.where.startsWith("classic"))).toBe(true);
  });

  it("folds embedded ai errors under an ai prefix", () => {
    const bad = { ...valid, ai: { ...valid.ai, challenges: [{ ...valid.ai!.challenges[0], urlTemplate: "https://no-token.example/" }] } };
    const res = parseEventBundle(JSON.stringify(bad));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.errors.some((e) => e.where.startsWith("ai.challenges[0].urlTemplate"))).toBe(true);
  });

  it("requires at least one module", () => {
    const res = parseEventBundle(JSON.stringify({ version: 1, kind: "archive", event: valid.event, settings: {} }));
    expect(res.ok).toBe(false);
  });

  it("accepts an ai-only archive — ai alone satisfies the at-least-one-module rule", () => {
    const aiOnly = { version: 1, kind: "archive", event: valid.event, settings: {}, ai: valid.ai };
    const res = parseEventBundle(JSON.stringify(aiOnly));
    if (!res.ok) throw new Error(JSON.stringify(res.errors));
    expect(res.bundle.ai).toEqual(valid.ai);
    expect(res.bundle.classic).toBeUndefined();
    expect(res.bundle.quiz).toBeUndefined();
  });

  it("accumulates all errors rather than stopping at the first", () => {
    const res = parseEventBundle(JSON.stringify({ version: 99, kind: "nope", event: {}, settings: { paused: true } }));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.errors.length).toBeGreaterThan(1);
  });
});
