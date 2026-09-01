// Shared HTTP plumbing for the ai module's four cross-origin routes. The
// CORS headers and the raw-body cap are pinned here rather than in each
// route's own test, so a route cannot drift from the contract by copying an
// older sibling.
import { describe, expect, it, vi } from "vitest";

import { AI_CORS_HEADERS, aiAwardResponse, aiJson, aiPreflight, aiRoute, readRawBody } from "@/lib/ai-http";
import { AI_EVENT_BODY_MAX } from "@/lib/ai-defaults";

const post = (body: string) => new Request("http://x/api/ai/event", { method: "POST", body });

describe("CORS", () => {
  it("allows any origin without ever allowing credentials", () => {
    // `Allow-Origin: *` together with `Allow-Credentials: true` is rejected by
    // browsers AND would invite a cookie these routes deliberately never read.
    expect(AI_CORS_HEADERS["Access-Control-Allow-Origin"]).toBe("*");
    expect(AI_CORS_HEADERS["Access-Control-Allow-Credentials"]).toBeUndefined();
  });

  it("advertises the headers a signed event actually sends", () => {
    const allowed = AI_CORS_HEADERS["Access-Control-Allow-Headers"].toLowerCase();
    for (const header of ["content-type", "authorization", "x-ctf-timestamp", "x-ctf-signature"]) {
      expect(allowed).toContain(header);
    }
  });

  it("puts the CORS headers on every JSON response, error responses included", () => {
    const res = aiJson({ error: "invalid-token" }, 401);
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers a preflight with 204 and the allowed methods", async () => {
    const res = aiPreflight("POST, OPTIONS");
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(await res.text()).toBe("");
  });
});

describe("readRawBody", () => {
  it("returns the raw bytes alongside the parsed object", async () => {
    const raw = '{"token":"abc","flag":"CTF{x}"}';
    const res = await readRawBody(post(raw));
    expect(res).toEqual({ ok: true, raw, parsed: { token: "abc", flag: "CTF{x}" } });
  });

  it("preserves the raw bytes EXACTLY, whitespace and key order included", async () => {
    // The event route HMACs these bytes. Re-serializing the parsed object
    // would change them and break every real integrator's signature.
    const raw = '{ "b":2,\n  "a":1 }';
    const res = await readRawBody(post(raw));
    expect(res.ok && res.raw).toBe(raw);
  });

  it("refuses a body over the cap before parsing it", async () => {
    const raw = JSON.stringify({ token: "x".repeat(AI_EVENT_BODY_MAX) });
    expect(await readRawBody(post(raw))).toEqual({ ok: false, error: "too-large" });
  });

  it("measures the cap in BYTES, not characters", async () => {
    // A multi-byte body just under the cap in characters can be over it in
    // bytes; Redis and the HMAC both see bytes.
    const raw = JSON.stringify({ token: "€".repeat(Math.ceil(AI_EVENT_BODY_MAX / 2)) });
    expect(raw.length).toBeLessThan(AI_EVENT_BODY_MAX);
    expect(await readRawBody(post(raw))).toEqual({ ok: false, error: "too-large" });
  });

  it("refuses malformed JSON and a non-object body", async () => {
    expect(await readRawBody(post("{not json"))).toEqual({ ok: false, error: "invalid-json" });
    expect(await readRawBody(post('"a string"'))).toEqual({ ok: false, error: "invalid-json" });
    expect(await readRawBody(post("null"))).toEqual({ ok: false, error: "invalid-json" });
  });
});

describe("aiAwardResponse", () => {
  it("maps a wrong-mode refusal to 409, the same status the routes use for their own pre-check", async () => {
    // `AWARD_SCRIPT` refuses a signed event against a flag-only challenge on
    // its own, even if a route's mode check missed it — this is that path
    // reaching the wire.
    const res = aiAwardResponse({ ok: false, reason: "wrong-mode" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "wrong-mode" });
  });

  it("carries dryRun through a correct-solve result without altering its status", async () => {
    const res = aiAwardResponse({ ok: true, correct: true, points: 0, dryRun: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ correct: true, points: 0, already: false, dryRun: true });
  });
});

describe("aiRoute", () => {
  it("passes a handler's own response through untouched", async () => {
    // The wrapper converts THROWN errors only. A handler that decided is a
    // handler whose decision reaches the wire byte for byte.
    const handler = vi.fn(async () => aiJson({ error: "invalid-token" }, 401));
    const res = await aiRoute(handler)();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid-token" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("forwards every argument to the handler", async () => {
    const handler = vi.fn(async (request: Request) => aiJson({ url: request.url }));
    const request = new Request("http://x/api/ai/state");
    const res = await aiRoute(handler)(request);
    expect(handler).toHaveBeenCalledWith(request);
    expect(await res.json()).toEqual({ url: "http://x/api/ai/state" });
  });

  it("turns a thrown store failure into 503 unavailable WITH the CORS headers", async () => {
    // `upstashPipeline` throws on any non-2xx or transport failure. Uncaught,
    // Next answers 500 with no CORS headers at all — so a browser integrator's
    // fetch fails at the CORS layer with no readable status and the outage
    // reads as "your CORS is broken".
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await aiRoute(async () => {
        throw new Error("Upstash pipeline failed: 500");
      })();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "unavailable" });
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("catches a synchronous throw and a non-Error rejection alike", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const sync = await aiRoute((): Response => {
        throw new Error("boom");
      })();
      expect(sync.status).toBe(503);

      // A rejected promise can be an arbitrary value, not an `Error`.
      const nonError = await aiRoute(() => Promise.reject("CTF{thrown-string}"))();
      expect(nonError.status).toBe(503);
      expect(await nonError.json()).toEqual({ error: "unavailable" });
    } finally {
      spy.mockRestore();
    }
  });

  it("logs a redacted label — never the error object, whose fields can carry the flag", async () => {
    // Same danger as `ai-store.ts`'s `errorLabel`: the award path's Redis ARGV
    // carries the submitted flag AND its comparison form, so a driver that
    // decorates its rejection with the failed request turns one
    // `console.error(err)` into the event's flags in the log.
    const FLAG = "CTF{do-not-log-me}";
    const decorated = Object.assign(new Error("Upstash pipeline failed: ERR timeout"), {
      command: ["EVAL", "...", FLAG],
      cause: new Error(`while sending ${FLAG}`),
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await aiRoute(async () => Promise.reject(decorated))()).status).toBe(503);

      // Anti-vacuous: the failure really did reach the logger, and said so.
      expect(spy).toHaveBeenCalledTimes(1);
      const logged = spy.mock.calls[0] as unknown[];
      expect(String(logged[0])).toContain("ai route: unhandled failure");
      expect(logged.some((arg) => arg instanceof Error)).toBe(false);
      const rendered = logged.map((arg) => JSON.stringify(arg)).join(" ");
      expect(rendered).not.toContain(FLAG);
      // What IS kept: enough to tell one failure from another.
      expect(rendered).toContain("ERR timeout");
    } finally {
      spy.mockRestore();
    }
  });

  it("never renders a thrown STRING, which could itself be the flag", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await aiRoute(() => Promise.reject("CTF{a-thrown-flag}"))();
      const rendered = (spy.mock.calls[0] as unknown[]).map((arg) => JSON.stringify(arg)).join(" ");
      expect(rendered).not.toContain("CTF{a-thrown-flag}");
      expect(rendered).toContain("non-Error throw");
    } finally {
      spy.mockRestore();
    }
  });
});
