// The ai module's dedicated challenge page (Task 6) — mirrors
// flags/[id]/__tests__/page.test.tsx's static-render pattern and mock set,
// plus this module's own thing: the launcher, and the mint behind it. The
// pins that matter here: the 404 gates (module off, unknown id), the view
// model deriving the same states the board derives, the mint happening ONLY
// for a signed-in viewer, the minted token appearing in the rendered payload
// EXACTLY ONCE, and event-mode hiding the flag form while flag/both show it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const {
  isModuleEnabled,
  isAdminLogin,
  getSession,
  listAiChallenges,
  getAiSolveCounts,
  getViewerAi,
  getResolvedModules,
  mintLaunchUrl,
} = vi.hoisted(() => ({
  isModuleEnabled: vi.fn(),
  isAdminLogin: vi.fn(),
  getSession: vi.fn(),
  listAiChallenges: vi.fn(),
  getAiSolveCounts: vi.fn(),
  getViewerAi: vi.fn(),
  getResolvedModules: vi.fn(),
  mintLaunchUrl: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/enabled-modules", () => import("@/test/enabled-modules-baked"));
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
// ChallengeDetail calls useRouter for its post-submit refresh.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/modules", () => ({ isModuleEnabled }));
vi.mock("@/lib/resolved-modules", () => ({ getResolvedModules }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/admin-auth", () => ({ isAdminLogin }));
vi.mock("@/lib/ai-launch", () => ({ mintLaunchUrl }));
vi.mock("@/lib/ai-store", () => ({
  listAiChallenges,
  getAiSolveCounts,
  getViewerAi,
  AI_COOLDOWN_SEC: 5,
}));

import AiChallengePage, { generateMetadata } from "@/app/(site)/ai/[id]/page";

// The store record's public shape carries `urlTemplate` and `mode`, which the
// page reads directly off `challenge` — never through the view model handed
// to <ChallengeDetail>. `urlTemplate` still has the raw `{token}` placeholder
// in it here, exactly as an authored record would, so a test below can pin
// that the placeholder itself never reaches the markup.
const flagChallenge = {
  id: "a1",
  title: "Prompt Leak",
  category: "Prompt Injection",
  description: "Get the model to **leak** its system prompt.",
  points: 40,
  order: 0,
  mode: "flag" as const,
  urlTemplate: "https://example-challenge.test/launch?token={token}",
  caseSensitive: true,
};

const eventChallenge = {
  id: "a2",
  title: "Jailbreak the Guard",
  category: "Guardrails",
  description: "The external side reports the solve back.",
  points: 60,
  order: 1,
  mode: "event" as const,
  urlTemplate: "https://example-challenge.test/launch?token={token}",
};

const MINTED_URL = "https://example-challenge.test/launch?token=TESTTOKENVALUE123";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  isModuleEnabled.mockReturnValue(true);
  isAdminLogin.mockReturnValue(false);
  getSession.mockResolvedValue({ user: { login: "alice" } });
  listAiChallenges.mockResolvedValue([flagChallenge, eventChallenge]);
  getAiSolveCounts.mockResolvedValue(new Map([["a1", 3]]));
  getViewerAi.mockResolvedValue({ solved: {}, attempts: {} });
  getResolvedModules.mockResolvedValue([
    { id: "ai", title: "AI Challenges", blurb: "Prompt-injection and guardrail challenges." },
  ]);
  mintLaunchUrl.mockResolvedValue(MINTED_URL);
});

describe("ai challenge page gates", () => {
  it("404s when the ai module is not enabled", async () => {
    isModuleEnabled.mockReturnValue(false);
    await expect(AiChallengePage(params("a1"))).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });

  it("404s for an unknown or deleted challenge id", async () => {
    await expect(AiChallengePage(params("nope"))).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });
});

describe("ai challenge page", () => {
  it("renders the challenge's meta, description and a way back", async () => {
    const html = renderToStaticMarkup(await AiChallengePage(params("a1")));
    expect(html).toContain("Prompt Leak");
    expect(html).toContain("Prompt Injection");
    expect(html).toContain("40 pts");
    expect(html).toContain("3 solve");
    expect(html).toMatch(/<strong[^>]*>leak<\/strong>/);
    expect(html).toContain('href="/ai"');
  });

  it("decodes an encoded id from the URL", async () => {
    listAiChallenges.mockResolvedValue([{ ...flagChallenge, id: "web/one two" }]);
    getAiSolveCounts.mockResolvedValue(new Map());
    const html = renderToStaticMarkup(await AiChallengePage(params("web%2Fone%20two")));
    expect(html).toContain("Prompt Leak");
  });
});

describe("ai challenge page launcher", () => {
  it("mints and renders the launcher for a signed-in, teamed viewer", async () => {
    const html = renderToStaticMarkup(await AiChallengePage(params("a1")));

    expect(mintLaunchUrl).toHaveBeenCalledTimes(1);
    expect(mintLaunchUrl).toHaveBeenCalledWith({
      origin: expect.any(String),
      login: "alice",
      challenge: flagChallenge,
      challenges: [flagChallenge, eventChallenge],
      viewer: { solved: {}, attempts: {} },
    });

    expect(html).toContain(`href="${MINTED_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toMatch(/Open challenge/);
    expect(html).toContain("This link is yours — it signs you in on the challenge site.");
  });

  it("prompts sign-in instead of a launcher for a signed-out visitor, and never mints", async () => {
    getSession.mockResolvedValue(null);
    const html = renderToStaticMarkup(await AiChallengePage(params("a1")));

    expect(mintLaunchUrl).not.toHaveBeenCalled();
    expect(getViewerAi).not.toHaveBeenCalled();
    expect(html).toMatch(/sign in with github/i);
    expect(html).not.toContain(MINTED_URL);
    expect(html).not.toMatch(/open challenge/i);
  });

  it("renders the minted token exactly once in the payload, and never the raw placeholder", async () => {
    const html = renderToStaticMarkup(await AiChallengePage(params("a1")));

    const occurrences = html.split(MINTED_URL).length - 1;
    expect(occurrences).toBe(1);

    // The token substring alone (not just the whole URL) also appears once —
    // this would catch a second, differently-formatted rendering of it.
    expect(html.split("TESTTOKENVALUE123").length - 1).toBe(1);

    // The authored template's raw placeholder must never render, in any
    // form — that would mean the substitution was skipped somewhere.
    expect(html).not.toContain("{token}");
  });

  it("derives the origin from BETTER_AUTH_URL, normalized to scheme+host+port — never a path", async () => {
    const prior = process.env.BETTER_AUTH_URL;
    process.env.BETTER_AUTH_URL = "https://ctf.example.org/some/path?x=1";
    try {
      await AiChallengePage(params("a1"));
      expect(mintLaunchUrl).toHaveBeenCalledWith(expect.objectContaining({ origin: "https://ctf.example.org" }));
    } finally {
      if (prior === undefined) delete process.env.BETTER_AUTH_URL;
      else process.env.BETTER_AUTH_URL = prior;
    }
  });

  it("falls back to a safe default when BETTER_AUTH_URL is unset — never the request's Host header", async () => {
    const prior = process.env.BETTER_AUTH_URL;
    delete process.env.BETTER_AUTH_URL;
    try {
      await AiChallengePage(params("a1"));
      expect(mintLaunchUrl).toHaveBeenCalledWith(expect.objectContaining({ origin: "http://localhost" }));
    } finally {
      if (prior !== undefined) process.env.BETTER_AUTH_URL = prior;
    }
  });
});

describe("ai challenge page form", () => {
  it("shows the flag form for a flag-mode challenge", async () => {
    const html = renderToStaticMarkup(await AiChallengePage(params("a1")));
    expect(html).toMatch(/submit flag/i);
    expect(html).toMatch(/case-sensitive/i);
  });

  it("shows the flag form for a both-mode challenge too", async () => {
    listAiChallenges.mockResolvedValue([{ ...flagChallenge, id: "a3", mode: "both" as const }]);
    const html = renderToStaticMarkup(await AiChallengePage(params("a3")));
    expect(html).toMatch(/submit flag/i);
  });

  it("renders no form at all for an event-mode challenge — the launcher is the whole page", async () => {
    const html = renderToStaticMarkup(await AiChallengePage(params("a2")));
    expect(html).not.toMatch(/submit flag/i);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    // The launcher still renders — an event-only challenge has no in-box
    // form, not no page.
    expect(html).toContain(`href="${MINTED_URL}"`);
  });
});

describe("ai challenge page view model", () => {
  it("derives the viewer's solved state through the same rule as the board", async () => {
    getViewerAi.mockResolvedValue({
      solved: { a1: { points: 40, at: "2026-08-18T00:00:00.000Z", source: "flag" } },
      attempts: {},
    });
    const html = renderToStaticMarkup(await AiChallengePage(params("a1")));
    expect(html).toMatch(/solved.*earned 40 point/i);
    expect(html).not.toMatch(/submit flag/i);
  });

  it("derives an active cooldown, without leaking the raw instant", async () => {
    getViewerAi.mockResolvedValue({
      solved: {},
      attempts: { a1: { attempts: 1, lastAt: new Date().toISOString() } },
    });
    const html = renderToStaticMarkup(await AiChallengePage(params("a1")));
    expect(html).toMatch(/on cooldown/i);
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  // The view model is built field by field — nothing beyond the public
  // AiChallenge fields, this challenge's solve count and the derived status
  // may reach the markup, whatever the store record carries.
  it("never lets the launch template or an unexpected store field reach the markup", async () => {
    listAiChallenges.mockResolvedValue([
      // A defense-in-depth check: even if a future bug had the store hand
      // back extra fields no `AiChallenge` should ever carry, the page's
      // field-by-field view model must not surface them.
      { ...flagChallenge, flag: "CTF{never-render-me}", signingKey: "aik_never-render-me" } as unknown as typeof flagChallenge,
    ]);
    const html = renderToStaticMarkup(await AiChallengePage(params("a1")));
    expect(html).not.toContain("CTF{never-render-me}");
    expect(html).not.toContain("aik_never-render-me");
    expect(html).not.toContain(flagChallenge.urlTemplate);
  });
});

describe("ai challenge page metadata", () => {
  it("titles the page after the challenge, with a neutral description", async () => {
    const meta = await generateMetadata(params("a1"));
    expect(meta.title).toBe("Prompt Leak");
    expect(meta.description).toBe("Prompt Injection · 40 points.");
    expect(JSON.stringify(meta)).not.toContain("leak its system prompt");
  });

  it("stays empty for an unknown id or a disabled module", async () => {
    expect(await generateMetadata(params("nope"))).toEqual({});
    isModuleEnabled.mockReturnValue(false);
    expect(await generateMetadata(params("a1"))).toEqual({});
  });
});
