// Shared HTTP plumbing for the ai module's three cross-origin routes. The
// CORS headers and the raw-body cap are pinned here rather than in each
// route's own test, so a route cannot drift from the contract by copying an
// older sibling.
import { describe, expect, it } from "vitest";

import { AI_CORS_HEADERS, aiJson, aiPreflight, readRawBody } from "@/lib/ai-http";
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
