// The three endpoint demos. These pin the CONTRACT the samples claim, not
// their prose: every request shape, header name and response body here is
// something an integrator codes against, and a demo that drifts from
// docs/ai-module.md is worse than no demo — it is a wrong answer with the
// authority of the admin panel behind it.
//
// @testing-library/react is not a dependency of this repo and must not be
// added for a test. The renderer is pure props inside a native <details>, so
// `renderToStaticMarkup` sees exactly what an organizer sees once it is open.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AiEndpointDemo, { ENDPOINT_DEMOS, writesState } from "@/components/admin-ai-endpoint-demos";

const ORIGIN = "https://event.example";
const demoFor = (label: string) => ENDPOINT_DEMOS.find((d) => d.label === label)!;
const render = (label: string) => renderToStaticMarkup(<AiEndpointDemo demo={demoFor(label)} origin={ORIGIN} />);

describe("ENDPOINT_DEMOS", () => {
  it("covers all three module-wide routes, in the order the block lists them", () => {
    expect(ENDPOINT_DEMOS.map((d) => d.label)).toEqual(["Submit", "Event", "State"]);
    expect(ENDPOINT_DEMOS.map((d) => d.path)).toEqual(["/api/ai/submit", "/api/ai/event", "/api/ai/state"]);
  });

  it("gives every route a send, a receive, and refusals worth designing for", () => {
    for (const demo of ENDPOINT_DEMOS) {
      expect(demo.request(ORIGIN)).toContain(`${ORIGIN}${demo.path}`);
      expect(demo.success.status).toBe("200");
      expect(demo.success.body.length).toBeGreaterThan(0);
      expect(demo.others.length).toBeGreaterThan(0);
    }
  });

  it("never puts a real-looking key or token in a sample", () => {
    for (const demo of ENDPOINT_DEMOS) {
      const text = [demo.request(ORIGIN), demo.success.body, ...demo.others.map((o) => o.body)].join("\n");
      // The only key-shaped string allowed is the same elided placeholder the
      // per-challenge panel shows; tokens are always the elided form too.
      expect(text).not.toMatch(/aik_[A-Za-z0-9+/=]{8,}/);
      expect(text).not.toMatch(/eyJ[A-Za-z0-9._-]{8,}/);
    }
  });
});

describe("Submit demo", () => {
  it("posts the documented body and shows both a correct and an incorrect answer", () => {
    const demo = demoFor("Submit");
    expect(demo.request(ORIGIN)).toContain('"token"');
    expect(demo.request(ORIGIN)).toContain('"flag"');
    expect(demo.success.body).toContain('"correct": true');
    expect(demo.others.some((o) => o.body.includes('"correct": false'))).toBe(true);
    // The cooldown is the flag path's own limiter, and the demo says so.
    expect(demo.others.some((o) => o.status === "429" && o.body.includes("cooldown"))).toBe(true);
  });
});

describe("Event demo", () => {
  it("signs the exact bytes and sends both headers", () => {
    const req = demoFor("Event").request(ORIGIN);
    expect(req).toContain("X-CTF-Timestamp");
    expect(req).toContain("X-CTF-Signature: sha256=");
    // The signature covers "<timestamp>.<raw body>", computed at run time — a
    // pre-signed snippet would be expired before anyone pasted it.
    expect(req).toContain(`printf '%s.%s' "$TS" "$BODY"`);
    expect(req).toContain("TS=$(date +%s)");
  });

  it("demonstrates the dry run, and names the refusals that look like a wrong key", () => {
    const demo = demoFor("Event");
    expect(demo.request(ORIGIN)).toContain('"dryRun":true');
    expect(demo.success.body).toContain('"wouldAward"');
    expect(demo.success.meaning).toContain("nothing is written");
    expect(demo.others.some((o) => o.body.includes("invalid-signature"))).toBe(true);
    expect(demo.others.some((o) => o.body.includes("stale-request"))).toBe(true);
    expect(demo.others.some((o) => o.body.includes("replay"))).toBe(true);
  });
});

describe("State demo", () => {
  it("offers both documented ways to carry the token, and warns against caching", () => {
    const demo = demoFor("State");
    expect(demo.request(ORIGIN)).toContain("?t=");
    expect(demo.request(ORIGIN)).toContain("Authorization: Bearer");
    expect(demo.success.body).toContain('"progress"');
    expect(demo.success.meaning).toContain("no-store");
  });

  it("is the only read-only route of the three", () => {
    expect(writesState("Submit")).toBe(true);
    expect(writesState("Event")).toBe(true);
    expect(writesState("State")).toBe(false);
  });
});

describe("AiEndpointDemo", () => {
  it("is collapsed, and labels each section send / receive / also expect", () => {
    const html = render("Submit");
    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]*open=/);
    expect(html).toContain("Send");
    expect(html).toContain("Receive");
    expect(html).toContain("Also expect");
  });

  it("marks the read-only route, so nobody fears trying it against a live event", () => {
    expect(render("State")).toContain("read-only");
    expect(render("Event")).not.toContain("read-only");
  });

  it("renders the request against the given origin, not a hard-coded host", () => {
    const html = renderToStaticMarkup(<AiEndpointDemo demo={demoFor("Event")} origin="http://localhost:3000" />);
    expect(html).toContain("http://localhost:3000/api/ai/event");
    expect(html).not.toContain(ORIGIN);
  });

  it("shows every refusal's body and what to do about it", () => {
    const html = render("Event");
    for (const other of demoFor("Event").others) {
      expect(html).toContain(other.status);
      // React escapes apostrophes in text nodes (`token&#x27;s`), so the
      // comparison is against the escaped form rather than the source string.
      expect(html).toContain(other.meaning.replaceAll("'", "&#x27;"));
    }
  });
});
