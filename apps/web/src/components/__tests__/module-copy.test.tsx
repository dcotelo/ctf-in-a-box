// The one renderer for the registry's `Copy` segments.
//
// Every module-composed page (/rules, /how-to-play, /faq, /terms) funnels its
// segmented sentences through here, and each page suite asserts the SENTENCE
// is present — which is satisfied by the text alone. Nothing asserted the
// markup: the `code` and `route` branches could both be deleted, or collapsed
// into the external-link branch, and every suite stayed green while a `main`
// branch name rendered as prose and an in-site link turned into a
// `target="_blank"` anchor out of the app.
//
// So this pins each branch's ELEMENT, not just its text. The markup is
// load-bearing twice over: these strings were moved out of hand-written JSX
// and must render byte-identically to it, and the internal/external split is
// the difference between a client-side route and a new browser tab.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ModuleCopy from "@/components/module-copy";
import type { Copy } from "@/lib/modules";

const render = (copy: Copy) => renderToStaticMarkup(<ModuleCopy copy={copy} />);

describe("ModuleCopy", () => {
  it("renders a plain string as bare text", () => {
    expect(render("Just a sentence.")).toBe("Just a sentence.");
  });

  it("renders an emphasised phrase in a text-zinc-200 span", () => {
    expect(render([{ em: "Login Admin" }])).toBe(
      '<span class="text-zinc-200">Login Admin</span>',
    );
  });

  it("renders a bullet lead-in in a text-white span", () => {
    expect(render([{ strong: "Please use AI." }])).toBe(
      '<span class="text-white">Please use AI.</span>',
    );
  });

  it("renders an inline literal as a <code> element, not as prose", () => {
    const html = render([{ code: "main" }]);
    expect(html).toBe('<code class="font-mono text-zinc-200">main</code>');
  });

  it("renders an in-site link as an anchor that stays in the tab", () => {
    const html = render([{ route: { href: "/how-to-play", label: "How to Play" } }]);
    expect(html).toContain('href="/how-to-play"');
    expect(html).toContain('class="ds-link"');
    expect(html).toContain(">How to Play</a>");
    // The whole point of the `route` branch: next/link, so no new tab and no
    // rel="noopener" — that is the EXTERNAL branch's markup.
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toContain("noopener");
  });

  it("renders an external link as a new-tab anchor", () => {
    const html = render([{ link: { href: "https://example.test/x", label: "Playbook" } }]);
    expect(html).toContain('href="https://example.test/x"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders a mixed sentence in order, with the text uninterrupted", () => {
    const html = render([
      "open a pull request against ",
      { code: "main" },
      ", then see ",
      { route: { href: "/how-to-play", label: "How to Play" } },
      ".",
    ]);
    expect(html).toContain("open a pull request against ");
    expect(html.indexOf("<code")).toBeLessThan(html.indexOf("<a"));
    expect(html.endsWith(".")).toBe(true);
  });
});
