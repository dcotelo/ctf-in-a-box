// Cross-route contract test for the ai module's four HTTP endpoints.
//
// Per-route tests cannot see disagreement BETWEEN routes, and four handlers
// written in sequence against the same helpers are exactly where a contract
// drifts — one route quietly re-implementing a check with a different slug,
// or reaching for a store reader the others were careful to avoid. This file
// pins what must hold across all four:
//
//   1. every route answers a CORS preflight the same way;
//   2. no route ever claims `Access-Control-Allow-Credentials` — the module
//      is cookie-blind, so there is no credential to allow (see
//      `ai-http.ts`'s `AI_CORS_HEADERS` comment);
//   3. a condition shared by more than one route (bad token, unknown
//      challenge, wrong mode, teamless, rate limit) produces the SAME
//      `{ error: "<slug>" }` slug everywhere it can occur;
//   4. every route opts out of prerendering the same way;
//   5. and — the invariant this file exists for — no route's SOURCE FILE
//      imports a cookie/session primitive, or an admin-only store reader,
//      structurally rather than behaviourally. A future edit that adds a
//      session read fails here even if its own route test still passes.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyLaunchToken: vi.fn(),
  decodeTokenUnverified: vi.fn(),
  verifyEventSignature: vi.fn(),
  getAiLaunchPublicKey: vi.fn(),
  getAiSigningKey: vi.fn(),
  listAiChallenges: vi.fn(),
  submitAiFlag: vi.fn(),
  awardAiEvent: vi.fn(),
  claimAiNonce: vi.fn(),
  getViewerAi: vi.fn(),
  consumeRateLimit: vi.fn(),
  hasTeam: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai-token", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai-token")>()),
  verifyLaunchToken: mocks.verifyLaunchToken,
  decodeTokenUnverified: mocks.decodeTokenUnverified,
  verifyEventSignature: mocks.verifyEventSignature,
}));
vi.mock("@/lib/ai-store", () => ({
  getAiLaunchPublicKey: mocks.getAiLaunchPublicKey,
  getAiSigningKey: mocks.getAiSigningKey,
  listAiChallenges: mocks.listAiChallenges,
  submitAiFlag: mocks.submitAiFlag,
  awardAiEvent: mocks.awardAiEvent,
  claimAiNonce: mocks.claimAiNonce,
  getViewerAi: mocks.getViewerAi,
}));
vi.mock("@/lib/rate-limit-store", async (orig) => ({
  ...(await orig<typeof import("@/lib/rate-limit-store")>()),
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock("@/lib/team-store", () => ({ hasTeam: mocks.hasTeam }));

import * as SubmitRoute from "@/app/api/ai/submit/route";
import * as EventRoute from "@/app/api/ai/event/route";
import * as StateRoute from "@/app/api/ai/state/route";
import * as LaunchKeyRoute from "@/app/api/ai/launch-key/route";

const CHAL = "prompt-leak-ab12cd";
// Pinned to line up with `postEvent`'s default `ts` below, so the event
// route's clock-skew check (checked before the token) never trips these
// cross-route comparisons for unrelated reasons.
const NOW_MS = 1_756_636_800_000;
// A real Ed25519 public key PEM. `launch-key/route.ts` runs this through the
// real (unmocked) `launchKeyId`, which parses it via `node:crypto` — unlike
// the other three routes, where `verifyLaunchToken` is mocked and never
// looks at the key's actual bytes.
const REAL_PUBLIC_PEM =
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAn3ucqIwaK//zm/i15crO7vM+glf/le0cAR1nN/Dyy+8=\n-----END PUBLIC KEY-----\n";

const ROUTES = {
  submit: SubmitRoute,
  event: EventRoute,
  state: StateRoute,
  "launch-key": LaunchKeyRoute,
} as const;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = {
  submit: readFileSync(path.join(__dirname, "../submit/route.ts"), "utf8"),
  event: readFileSync(path.join(__dirname, "../event/route.ts"), "utf8"),
  state: readFileSync(path.join(__dirname, "../state/route.ts"), "utf8"),
  "launch-key": readFileSync(path.join(__dirname, "../launch-key/route.ts"), "utf8"),
} as const;

/** Just the `import ...` lines from a route source file. Several of these
 *  routes deliberately NAME the readers/primitives they refuse to import, in
 *  a doc comment explaining why (e.g. launch-key's header names
 *  `getAiLaunchKeys()` to say it calls the public accessor instead). A plain
 *  substring check over the whole file would flag that prose as if it were a
 *  real import, so every source-grep assertion below runs over the import
 *  lines alone. */
function importLines(src: string): string {
  return src
    .split("\n")
    .filter((line) => /^import\s/.test(line))
    .join("\n");
}

const IMPORTS = {
  submit: importLines(SOURCE.submit),
  event: importLines(SOURCE.event),
  state: importLines(SOURCE.state),
  "launch-key": importLines(SOURCE["launch-key"]),
} as const;

function tokenIsGood(sub = "alice") {
  mocks.decodeTokenUnverified.mockReturnValue({ sub, aud: CHAL, jti: "n1" });
  mocks.getAiLaunchPublicKey.mockResolvedValue("-----BEGIN PUBLIC KEY-----test");
  mocks.verifyLaunchToken.mockReturnValue({ ok: true, claims: { sub, aud: CHAL, jti: "n1" } });
  mocks.listAiChallenges.mockResolvedValue([{ id: CHAL, mode: "both", points: 300 }]);
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true });
  mocks.hasTeam.mockResolvedValue(true);
}

const postSubmit = (body: unknown) =>
  new Request("http://x/api/ai/submit", { method: "POST", body: JSON.stringify(body) });

const postEvent = (raw: string, ts = NOW_MS / 1000, headers: Record<string, string> = {}) =>
  new Request("http://x/api/ai/event", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-ctf-timestamp": String(ts),
      "x-ctf-signature": "sha256=deadbeef",
      ...headers,
    },
  });

const getState = (token: string) =>
  new Request("http://x/api/ai/state", { headers: { authorization: `Bearer ${token}` } });

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
});

afterEach(() => vi.useRealTimers());

describe("ai module contract: CORS preflight", () => {
  it.each(Object.keys(ROUTES) as (keyof typeof ROUTES)[])("%s answers a 204 preflight with Allow-Origin: *", async (name) => {
    const route = ROUTES[name];
    expect(route.OPTIONS).toBeTypeOf("function");
    const res = await route.OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("ai module contract: never Allow-Credentials", () => {
  it("submit — neither a success nor a refusal sets Allow-Credentials", async () => {
    tokenIsGood();
    mocks.submitAiFlag.mockResolvedValue({ ok: true, correct: true, points: 300 });
    const ok = await SubmitRoute.POST(postSubmit({ token: "t", flag: "CTF{x}" }));
    expect(ok.headers.get("access-control-allow-credentials")).toBeNull();

    mocks.verifyLaunchToken.mockReturnValue({ ok: false, error: "invalid-signature" });
    const bad = await SubmitRoute.POST(postSubmit({ token: "t", flag: "CTF{x}" }));
    expect(bad.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("event — neither a success nor a refusal sets Allow-Credentials", async () => {
    const raw = JSON.stringify({ token: "t", challengeId: CHAL });
    mocks.listAiChallenges.mockResolvedValue([{ id: CHAL, mode: "event", points: 400 }]);
    mocks.getAiSigningKey.mockResolvedValue("aik_key");
    mocks.getAiLaunchPublicKey.mockResolvedValue("-----BEGIN PUBLIC KEY-----test");
    mocks.verifyEventSignature.mockReturnValue(true);
    mocks.verifyLaunchToken.mockReturnValue({ ok: true, claims: { sub: "alice", aud: CHAL, jti: "n1" } });
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true });
    mocks.claimAiNonce.mockResolvedValue(true);
    mocks.hasTeam.mockResolvedValue(true);
    mocks.awardAiEvent.mockResolvedValue({ ok: true, correct: true, points: 400 });

    const ok = await EventRoute.POST(postEvent(raw));
    expect(ok.headers.get("access-control-allow-credentials")).toBeNull();

    mocks.verifyEventSignature.mockReturnValue(false);
    const bad = await EventRoute.POST(postEvent(raw));
    expect(bad.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("state — neither a success nor a refusal sets Allow-Credentials", async () => {
    tokenIsGood();
    mocks.getViewerAi.mockResolvedValue({ solved: {}, attempts: {} });
    const ok = await StateRoute.GET(getState("t"));
    expect(ok.headers.get("access-control-allow-credentials")).toBeNull();

    mocks.verifyLaunchToken.mockReturnValue({ ok: false, error: "invalid-signature" });
    const bad = await StateRoute.GET(getState("t"));
    expect(bad.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("launch-key — neither a success nor a refusal sets Allow-Credentials", async () => {
    mocks.getAiLaunchPublicKey.mockResolvedValue(REAL_PUBLIC_PEM);
    const ok = await LaunchKeyRoute.GET();
    expect(ok.headers.get("access-control-allow-credentials")).toBeNull();

    mocks.getAiLaunchPublicKey.mockRejectedValue(new Error("down"));
    const bad = await LaunchKeyRoute.GET();
    expect(bad.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

describe("ai module contract: shared error slugs agree across routes", () => {
  it("a malformed token yields invalid-token on submit, event and state alike", async () => {
    tokenIsGood();
    mocks.verifyLaunchToken.mockReturnValue({ ok: false, error: "invalid-signature" });
    const submit = await SubmitRoute.POST(postSubmit({ token: "t", flag: "CTF{x}" }));
    expect(await submit.json()).toEqual({ error: "invalid-token" });

    mocks.listAiChallenges.mockResolvedValue([{ id: CHAL, mode: "event", points: 400 }]);
    mocks.getAiSigningKey.mockResolvedValue("aik_key");
    mocks.verifyEventSignature.mockReturnValue(true);
    const event = await EventRoute.POST(postEvent(JSON.stringify({ token: "t", challengeId: CHAL })));
    expect(await event.json()).toEqual({ error: "invalid-token" });

    const state = await StateRoute.GET(getState("t"));
    expect(await state.json()).toEqual({ error: "invalid-token" });
  });

  it("an expired token yields expired on submit, event and state alike", async () => {
    tokenIsGood();
    mocks.verifyLaunchToken.mockReturnValue({ ok: false, error: "expired" });
    const submit = await SubmitRoute.POST(postSubmit({ token: "t", flag: "CTF{x}" }));
    expect(submit.status).toBe(401);
    expect(await submit.json()).toEqual({ error: "expired" });

    mocks.listAiChallenges.mockResolvedValue([{ id: CHAL, mode: "event", points: 400 }]);
    mocks.getAiSigningKey.mockResolvedValue("aik_key");
    mocks.verifyEventSignature.mockReturnValue(true);
    const event = await EventRoute.POST(postEvent(JSON.stringify({ token: "t", challengeId: CHAL })));
    expect(event.status).toBe(401);
    expect(await event.json()).toEqual({ error: "expired" });

    const state = await StateRoute.GET(getState("t"));
    expect(state.status).toBe(401);
    expect(await state.json()).toEqual({ error: "expired" });
  });

  it("an unknown challenge yields unknown-challenge on submit and event alike", async () => {
    tokenIsGood();
    mocks.listAiChallenges.mockResolvedValue([]);
    const submit = await SubmitRoute.POST(postSubmit({ token: "t", flag: "CTF{x}" }));
    expect(submit.status).toBe(404);
    expect(await submit.json()).toEqual({ error: "unknown-challenge" });

    const event = await EventRoute.POST(postEvent(JSON.stringify({ token: "t", challengeId: CHAL })));
    expect(event.status).toBe(404);
    expect(await event.json()).toEqual({ error: "unknown-challenge" });
  });

  it("the wrong mode yields wrong-mode on submit and event alike", async () => {
    tokenIsGood();
    mocks.listAiChallenges.mockResolvedValue([{ id: CHAL, mode: "event", points: 300 }]);
    const submit = await SubmitRoute.POST(postSubmit({ token: "t", flag: "CTF{x}" }));
    expect(submit.status).toBe(409);
    expect(await submit.json()).toEqual({ error: "wrong-mode" });

    mocks.listAiChallenges.mockResolvedValue([{ id: CHAL, mode: "flag", points: 300 }]);
    const event = await EventRoute.POST(postEvent(JSON.stringify({ token: "t", challengeId: CHAL })));
    expect(event.status).toBe(409);
    expect(await event.json()).toEqual({ error: "wrong-mode" });
  });

  it("a teamless subject yields no-team on submit and event alike", async () => {
    tokenIsGood();
    mocks.hasTeam.mockResolvedValue(false);
    const submit = await SubmitRoute.POST(postSubmit({ token: "t", flag: "CTF{x}" }));
    expect(submit.status).toBe(403);
    expect(await submit.json()).toEqual({ error: "no-team" });

    mocks.listAiChallenges.mockResolvedValue([{ id: CHAL, mode: "event", points: 400 }]);
    mocks.getAiSigningKey.mockResolvedValue("aik_key");
    mocks.verifyEventSignature.mockReturnValue(true);
    mocks.claimAiNonce.mockResolvedValue(true);
    const event = await EventRoute.POST(postEvent(JSON.stringify({ token: "t", challengeId: CHAL })));
    expect(event.status).toBe(403);
    expect(await event.json()).toEqual({ error: "no-team" });
  });

  it("an exhausted rate limit yields rate-limited with Retry-After on submit, event and state alike", async () => {
    tokenIsGood();
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 7 });
    const submit = await SubmitRoute.POST(postSubmit({ token: "t", flag: "CTF{x}" }));
    expect(submit.status).toBe(429);
    expect(await submit.json()).toEqual({ error: "rate-limited" });
    expect(submit.headers.get("retry-after")).toBe("7");

    mocks.listAiChallenges.mockResolvedValue([{ id: CHAL, mode: "event", points: 400 }]);
    mocks.getAiSigningKey.mockResolvedValue("aik_key");
    mocks.verifyEventSignature.mockReturnValue(true);
    const event = await EventRoute.POST(postEvent(JSON.stringify({ token: "t", challengeId: CHAL })));
    expect(event.status).toBe(429);
    expect(await event.json()).toEqual({ error: "rate-limited" });
    expect(event.headers.get("retry-after")).toBe("7");

    const state = await StateRoute.GET(getState("t"));
    expect(state.status).toBe(429);
    expect(await state.json()).toEqual({ error: "rate-limited" });
    expect(state.headers.get("retry-after")).toBe("7");
  });

  it("a malformed body yields invalid-request on submit and event alike", async () => {
    const submit = await SubmitRoute.POST(
      new Request("http://x/api/ai/submit", { method: "POST", body: "not json" }),
    );
    expect(submit.status).toBe(400);
    expect(await submit.json()).toEqual({ error: "invalid-request" });

    const event = await EventRoute.POST(
      new Request("http://x/api/ai/event", { method: "POST", body: "not json" }),
    );
    expect(event.status).toBe(400);
    expect(await event.json()).toEqual({ error: "invalid-request" });
  });
});

describe("ai module contract: build-time exports", () => {
  it.each(Object.keys(ROUTES) as (keyof typeof ROUTES)[])("%s opts out of prerendering the same way", (name) => {
    const route = ROUTES[name];
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
  });
});

describe("ai module contract: structural cookie-blindness", () => {
  // Grepping the SOURCE FILE rather than the loaded module: a mocked import
  // in this test file would hide a real `@/lib/auth`/`next/headers` read
  // that only bites in production. This makes the check survive a future
  // edit even if that edit's own route test still passes.
  const FORBIDDEN_IMPORTS = ['"@/lib/auth"', "'@/lib/auth'", '"next/headers"', "'next/headers'", '"@/lib/gate-request"', "'@/lib/gate-request'"];

  it.each(Object.keys(IMPORTS) as (keyof typeof IMPORTS)[])("%s imports no cookie/session primitive", (name) => {
    const imports = IMPORTS[name];
    for (const needle of FORBIDDEN_IMPORTS) {
      expect(imports).not.toContain(needle);
    }
  });
});

describe("ai module contract: no route reaches for an admin-only secret reader", () => {
  // These identifiers are checked against the IMPORT LINES only (see
  // `importLines` above) — launch-key's own doc comment names
  // `getAiLaunchKeys()` in prose precisely to say it does NOT call it, and a
  // whole-file substring check would misread that as a violation.
  it.each(Object.keys(IMPORTS) as (keyof typeof IMPORTS)[])("%s never imports getAiLaunchKeys or listAiChallengesForAdmin", (name) => {
    const imports = IMPORTS[name];
    expect(imports).not.toContain("getAiLaunchKeys");
    expect(imports).not.toContain("listAiChallengesForAdmin");
  });

  it("only event/route.ts imports getAiSigningKey — the one per-challenge secret reader a route may call", () => {
    expect(IMPORTS.event).toContain("getAiSigningKey");
    expect(IMPORTS.submit).not.toContain("getAiSigningKey");
    expect(IMPORTS.state).not.toContain("getAiSigningKey");
    expect(IMPORTS["launch-key"]).not.toContain("getAiSigningKey");
  });
});
