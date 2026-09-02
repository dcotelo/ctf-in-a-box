// Same testing constraints as admin-ai-controls.test.tsx: this repo's vitest
// config runs in the `node` environment (no jsdom, no
// `@testing-library/react`), so no DOM event can ever be simulated —
// `renderToStaticMarkup` produces a plain HTML string, and `onClick`
// handlers are never serialized into it at all.
//
// `AiIntegrationPanel` is exported specifically so every visual state
// (masked/revealed, the rotate confirm open/closed, a specific Send test
// outcome) can be rendered DIRECTLY with that state as an explicit prop,
// the same way admin-ai-controls.test.tsx renders `AiChallengeForm` directly
// with `flagRevealed` set. The button-press LOGIC a click would otherwise
// trigger (`requestRotate`, `confirmRotate`, `fetchAiTest`,
// `classifyAiTestResponse`) is proven by calling those exported functions
// directly — mirrors `commitAiCooldown` in admin-ai-controls.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AiChallenge } from "@/lib/ai-store";
import AdminAiIntegration, {
  AiIntegrationPanel,
  ROTATE_CONSEQUENCE,
  classifyAiTestResponse,
  confirmRotate,
  fetchAiTest,
  requestRotate,
  type AiIntegrationPanelProps,
} from "@/components/admin-ai-integration";

const CHALLENGE: AiChallenge = {
  id: "prompt-leak-ab12cd",
  title: "Prompt Leak",
  category: "AI",
  description: "d",
  points: 100,
  order: 1,
  mode: "event",
  urlTemplate: "https://challenge.example/{token}",
};

const REAL_KEY = "aik_" + "z".repeat(43);
const ORIGIN = "https://ctf.dcotelo.dev";

const noop = () => {};

function panelProps(overrides: Partial<AiIntegrationPanelProps> = {}): AiIntegrationPanelProps {
  return {
    challenge: CHALLENGE,
    signingKey: REAL_KEY,
    origin: ORIGIN,
    pending: false,
    revealed: false,
    onToggleReveal: noop,
    rotateConfirmOpen: false,
    onRequestRotate: noop,
    onCancelRotate: noop,
    onConfirmRotate: noop,
    testPending: false,
    testOutcome: null,
    onSendTest: noop,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<AiIntegrationPanelProps> = {}): string {
  return renderToStaticMarkup(<AiIntegrationPanel {...panelProps(overrides)} />);
}

/** Finds the `<button>` whose text is exactly `label` and returns whether it
 *  carries a real `disabled` attribute. NOT a substring check for the word
 *  "disabled" anywhere in the tag — this component's buttons use Tailwind's
 *  `disabled:opacity-50` variant in their `class`, which contains the
 *  literal substring "disabled" whether or not the attribute is present, so
 *  a naive `/disabled/` match would pass on every button regardless of its
 *  actual state. */
function isButtonDisabled(html: string, label: string): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<button([^>]*)>${escaped}<\\/button>`));
  if (!match) throw new Error(`no <button>${label}</button> found in rendered markup`);
  return /(^|\s)disabled(=|\s|$)/.test(match[1]);
}

describe("AiIntegrationPanel — signing key masking", () => {
  it("masks the key by default: the raw key is absent from markup, the placeholder is present", () => {
    const html = renderPanel({ revealed: false });
    expect(html).not.toContain(REAL_KEY);
    expect(html).toContain("aik_…");
  });

  it("reveals the key when `revealed` is true, and the placeholder no longer stands in for it", () => {
    const html = renderPanel({ revealed: true });
    expect(html).toContain(REAL_KEY);
  });
});

describe("AiIntegrationPanel — test curl", () => {
  function curlBlock(html: string): string {
    const match = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
    if (!match) throw new Error("no <pre> block found in rendered markup");
    return match[1];
  }

  it("masked: the curl's KEY line shows the placeholder, never the real key", () => {
    const html = renderPanel({ revealed: false });
    const curl = curlBlock(html);
    expect(curl).toContain("KEY=&#x27;aik_…&#x27;");
    expect(curl).not.toContain(REAL_KEY);
  });

  it("revealed: the curl contains the real key exactly once", () => {
    const html = renderPanel({ revealed: true });
    const curl = curlBlock(html);
    const occurrences = curl.split(REAL_KEY).length - 1;
    expect(occurrences).toBe(1);
  });

  it("the curl's POST target and challengeId use the real origin and challenge id", () => {
    const html = renderPanel({ revealed: true });
    const curl = curlBlock(html);
    expect(curl).toContain(`${ORIGIN}/api/ai/event`);
    // The rendered markup HTML-entity-escapes quotes (&quot;), so this checks
    // the un-escaped substrings the curl's JSON body is built from rather
    // than a literal `"challengeId":"..."` slice.
    expect(curl).toContain("challengeId");
    expect(curl).toContain(CHALLENGE.id);
  });

  it("the TOKEN stays a placeholder with the caption pointing at Send test", () => {
    const html = renderPanel({ revealed: true });
    const curl = curlBlock(html);
    expect(curl).toContain("TOKEN=&#x27;eyJ…&#x27;");
    expect(html).toContain("Use Send test below for a server-minted token, or copy a token from your own launcher link.");
  });
});

describe("AiIntegrationPanel — endpoint URLs", () => {
  it("renders the three endpoint URLs with the given origin", () => {
    const html = renderPanel();
    expect(html).toContain(`${ORIGIN}/api/ai/submit`);
    expect(html).toContain(`${ORIGIN}/api/ai/event`);
    expect(html).toContain(`${ORIGIN}/api/ai/state`);
  });

  it("a different origin changes all three — not hard-coded to one host", () => {
    const html = renderPanel({ origin: "http://localhost:3000" });
    expect(html).toContain("http://localhost:3000/api/ai/submit");
    expect(html).not.toContain(`${ORIGIN}/api/ai/submit`);
  });
});

describe("AiIntegrationPanel — rotate confirm", () => {
  it("closed by default: the confirm's consequence sentence is not in the markup", () => {
    const html = renderPanel({ rotateConfirmOpen: false });
    expect(html).not.toContain(ROTATE_CONSEQUENCE);
  });

  it("open: renders the exact, verbatim consequence sentence", () => {
    const html = renderPanel({ rotateConfirmOpen: true });
    expect(html).toContain(ROTATE_CONSEQUENCE);
  });
});

describe("requestRotate / confirmRotate — the rotate button never fires onRotate directly", () => {
  it("requestRotate opens the confirm and never touches onRotate", () => {
    const setOpen = vi.fn();
    requestRotate(setOpen);
    expect(setOpen).toHaveBeenCalledWith(true);
  });

  it("confirmRotate is the only path that calls onRotate, and closes the confirm once it resolves", async () => {
    const onRotate = vi.fn().mockResolvedValue(undefined);
    const setOpen = vi.fn();
    await confirmRotate(onRotate, setOpen);
    expect(onRotate).toHaveBeenCalledTimes(1);
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it("a rejected onRotate leaves the confirm open rather than closing it", async () => {
    const onRotate = vi.fn().mockRejectedValue(new Error("rotate failed"));
    const setOpen = vi.fn();
    await confirmRotate(onRotate, setOpen);
    expect(onRotate).toHaveBeenCalledTimes(1);
    expect(setOpen).not.toHaveBeenCalled();
  });
});

describe("AdminAiIntegration — mounting alone never fires onRotate", () => {
  it("a plain render calls onRotate zero times", () => {
    const onRotate = vi.fn().mockResolvedValue(undefined);
    renderToStaticMarkup(
      <AdminAiIntegration challenge={CHALLENGE} signingKey={REAL_KEY} onRotate={onRotate} pending={false} />,
    );
    expect(onRotate).not.toHaveBeenCalled();
  });

  it("a plain render masks the key (the default component never reveals on mount)", () => {
    const html = renderToStaticMarkup(
      <AdminAiIntegration challenge={CHALLENGE} signingKey={REAL_KEY} onRotate={vi.fn()} pending={false} />,
    );
    expect(html).not.toContain(REAL_KEY);
  });
});

describe("classifyAiTestResponse", () => {
  it("wouldAward: true → award", () => {
    const outcome = classifyAiTestResponse(true, {
      status: 200,
      body: { dryRun: true, wouldAward: true, verdict: "would-award", checks: [] },
    });
    expect(outcome).toEqual({ kind: "award" });
  });

  it("a relayed wrong-mode refusal (200 from the admin route, 409 relayed inside) → named wrong-mode, not award", () => {
    const outcome = classifyAiTestResponse(true, { status: 409, body: { error: "wrong-mode" } });
    expect(outcome).toEqual({ kind: "named", label: "wrong-mode" });
  });

  it("a 429 from the admin route itself (not a relay) → named rate-limited", () => {
    const outcome = classifyAiTestResponse(false, { error: "rate-limited" });
    expect(outcome).toEqual({ kind: "named", label: "rate-limited" });
  });

  it("a dry run that would refuse (not award) is named by its verdict, not treated as an award", () => {
    const outcome = classifyAiTestResponse(true, {
      status: 200,
      body: { dryRun: true, wouldAward: false, verdict: "would-refuse", checks: [] },
    });
    expect(outcome).toEqual({ kind: "named", label: "would-refuse" });
  });
});

describe("fetchAiTest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts exactly {challengeId} to /api/admin/ai/test and classifies a wouldAward response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 200, body: { dryRun: true, wouldAward: true, verdict: "would-award", checks: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await fetchAiTest(CHALLENGE.id);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/ai/test");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ challengeId: CHALLENGE.id });
    expect(outcome).toEqual({ kind: "award" });
  });

  it("a 429 from the route surfaces as a named rate-limited outcome, not an award", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: "rate-limited" }) }),
    );
    const outcome = await fetchAiTest(CHALLENGE.id);
    expect(outcome).toEqual({ kind: "named", label: "rate-limited" });
  });

  it("a network failure is a named unavailable outcome, not a thrown error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    const outcome = await fetchAiTest(CHALLENGE.id);
    expect(outcome).toEqual({ kind: "named", label: "unavailable" });
  });
});

describe("AiIntegrationPanel — Send test rendering", () => {
  it("no outcome yet: neither the award line nor a named-result line is rendered", () => {
    const html = renderPanel({ testOutcome: null });
    expect(html).not.toContain("Would award");
    expect(html).not.toContain("Test result:");
  });

  it("wouldAward outcome renders a clear, green would-award success line", () => {
    const html = renderPanel({ testOutcome: { kind: "award" } });
    expect(html).toContain("Would award");
    expect(html).not.toContain("Test result:");
  });

  it("a named refusal (e.g. wrong-mode) names the slug, and is NOT rendered as an award", () => {
    const html = renderPanel({ testOutcome: { kind: "named", label: "wrong-mode" } });
    expect(html).toContain("Test result: wrong-mode");
    expect(html).not.toContain("Would award");
  });

  it("a named rate-limited result names the slug", () => {
    const html = renderPanel({ testOutcome: { kind: "named", label: "rate-limited" } });
    expect(html).toContain("Test result: rate-limited");
  });

  it("Send test is disabled while `pending`", () => {
    const html = renderPanel({ pending: true, testPending: false });
    expect(isButtonDisabled(html, "Send test")).toBe(true);
  });

  it("Send test is enabled when neither pending nor testPending", () => {
    const html = renderPanel({ pending: false, testPending: false });
    expect(isButtonDisabled(html, "Send test")).toBe(false);
  });

  it("Send test is disabled while a test is in flight (testPending)", () => {
    const html = renderPanel({ pending: false, testPending: true });
    expect(html).toContain("Sending…");
    expect(isButtonDisabled(html, "Sending…")).toBe(true);
  });
});

describe("AiIntegrationPanel — rotate button disabled while pending", () => {
  it("disabled while pending", () => {
    const html = renderPanel({ pending: true });
    expect(isButtonDisabled(html, "Rotate")).toBe(true);
  });

  it("enabled when not pending", () => {
    const html = renderPanel({ pending: false });
    expect(isButtonDisabled(html, "Rotate")).toBe(false);
  });
});
