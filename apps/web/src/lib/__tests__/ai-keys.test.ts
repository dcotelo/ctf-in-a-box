// The ai module's dependency-free contract. The URL-template rules get the
// most attention here because they are the only NEW validation this module
// invents: a template without the {token} placeholder produces a launcher
// that hands the external side no identity at all, and it must be rejected at
// author time rather than discovered mid-event.
import { describe, expect, it } from "vitest";

import {
  AI_CHALLENGES_KEY,
  AI_FLAG_KEY,
  AI_FLAGNORM_KEY,
  AI_SIGNKEY_KEY,
  AI_TOKEN_PLACEHOLDER,
  AI_URL_TEMPLATE_MAX,
  aiAttemptsKey,
  aiNonceKey,
  aiSolvesKey,
  isAiMode,
  renderLaunchUrl,
  validateUrlTemplate,
} from "@/lib/ai-keys";

describe("ai key names", () => {
  it("namespaces every key under ctf:ai:", () => {
    expect(AI_CHALLENGES_KEY).toBe("ctf:ai:challenges");
    expect(AI_FLAG_KEY).toBe("ctf:ai:flag");
    expect(AI_FLAGNORM_KEY).toBe("ctf:ai:flagnorm");
    expect(AI_SIGNKEY_KEY).toBe("ctf:ai:signkey");
    expect(aiSolvesKey("Alice")).toBe("ctf:ai:solves:Alice");
    expect(aiAttemptsKey("Alice")).toBe("ctf:ai:attempts:Alice");
    expect(aiNonceKey("abc123")).toBe("ctf:ai:nonce:abc123");
  });
});

describe("isAiMode", () => {
  it("accepts the three modes and nothing else", () => {
    expect(isAiMode("flag")).toBe(true);
    expect(isAiMode("event")).toBe(true);
    expect(isAiMode("both")).toBe(true);
    expect(isAiMode("Flag")).toBe(false);
    expect(isAiMode("")).toBe(false);
    expect(isAiMode(undefined)).toBe(false);
  });
});

describe("validateUrlTemplate", () => {
  it("accepts an https template carrying the placeholder", () => {
    const res = validateUrlTemplate("  https://game.example.com/play?t={token}  ");
    expect(res).toEqual({ ok: true, value: "https://game.example.com/play?t={token}" });
  });

  it("accepts http only for a loopback host, so local authoring works", () => {
    expect(validateUrlTemplate("http://localhost:5173/?t={token}").ok).toBe(true);
    expect(validateUrlTemplate("http://127.0.0.1:5173/?t={token}").ok).toBe(true);
    expect(validateUrlTemplate("http://game.example.com/?t={token}")).toEqual({
      ok: false,
      reason: "http is only allowed for localhost",
    });
  });

  it("rejects a template with no {token} placeholder", () => {
    expect(validateUrlTemplate("https://game.example.com/play")).toEqual({
      ok: false,
      reason: `Template must contain ${AI_TOKEN_PLACEHOLDER}`,
    });
  });

  it("rejects non-http(s) schemes and embedded credentials", () => {
    expect(validateUrlTemplate("javascript:alert({token})").ok).toBe(false);
    expect(validateUrlTemplate("https://user:pw@game.example.com/?t={token}").ok).toBe(false);
  });

  it("rejects an over-long template", () => {
    const long = `https://game.example.com/${"a".repeat(AI_URL_TEMPLATE_MAX)}?t={token}`;
    expect(validateUrlTemplate(long).ok).toBe(false);
  });
});

describe("renderLaunchUrl", () => {
  it("substitutes every occurrence of the placeholder", () => {
    expect(renderLaunchUrl("https://g.example/{token}/x?t={token}", "abc.def")).toBe(
      "https://g.example/abc.def/x?t=abc.def",
    );
  });

  it("leaves a template with no placeholder untouched", () => {
    expect(renderLaunchUrl("https://g.example/", "abc")).toBe("https://g.example/");
  });
});
