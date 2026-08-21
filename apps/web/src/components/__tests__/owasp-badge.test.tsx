// The badge's whole job is to tell a reader which category codes open an
// OWASP page and which are inert. It failed at that for as long as it existed:
// both cases rendered the same `text-muted` chip and every link cue was behind
// `hover:` / `focus-visible:`, so the distinction only appeared under a
// pointer — never for a touch user, and never at a glance.
//
// These tests pin the INVARIANT (the two look different at rest, with a
// non-colour cue) rather than any particular class name, so a restyle is free
// to change the treatment and is not free to collapse the distinction again.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OwaspBadge from "@/components/owasp-badge";

/** The class list as rendered, minus everything scoped to an interaction
 *  state. What remains is what a reader sees before touching anything. */
function restingClasses(html: string): string {
  const match = /class="([^"]*)"/.exec(html);
  return (match?.[1] ?? "")
    .split(/\s+/)
    .filter((c) => !/^(hover|focus|focus-visible|active|group-hover):/.test(c))
    .join(" ");
}

describe("OwaspBadge", () => {
  it("links a known Top 10 code to its OWASP page, in a new tab", () => {
    const html = renderToStaticMarkup(<OwaspBadge code="A03" />);
    expect(html).toContain('href="https://owasp.org/Top10/A03_2021-Injection/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("noopener");
  });

  it("links a known API Top 10 code too", () => {
    const html = renderToStaticMarkup(<OwaspBadge code="API3" />);
    expect(html).toContain("API-Security/editions/2023/en/");
  });

  it("renders an unmapped code as plain text, never as a dead anchor", () => {
    const html = renderToStaticMarkup(<OwaspBadge code="A99" />);
    expect(html).not.toContain("<a ");
    expect(html).toContain("A99");
  });

  // --- the reason this issue was filed -------------------------------------

  it("does NOT render the linked and unlinked badges alike at rest", () => {
    const linked = restingClasses(renderToStaticMarkup(<OwaspBadge code="A03" />));
    const inert = restingClasses(renderToStaticMarkup(<OwaspBadge code="A99" />));
    expect(linked).not.toEqual(inert);
  });

  it("carries a NON-COLOUR resting cue on the link (WCAG 1.4.1)", () => {
    // Colour alone is not an acceptable link affordance — the same rule
    // globals.css cites for `.ds-link`. Underline is the cue here; if a
    // restyle drops it, it has to bring another non-colour one.
    const html = renderToStaticMarkup(<OwaspBadge code="A03" />);
    expect(restingClasses(html)).toContain("underline");
  });

  it("keeps the resting cue OFF the inert badge, so the contrast survives", () => {
    // Decorating both would technically differ from the old code and still
    // leave a reader unable to tell them apart.
    expect(restingClasses(renderToStaticMarkup(<OwaspBadge code="A99" />))).not.toContain("underline");
  });

  it("gives the link the WCAG 2.5.8 pointer target the chip is too small for", () => {
    // ~23x15 rendered; ds-tap-24 grows the target without growing the box.
    expect(renderToStaticMarkup(<OwaspBadge code="A03" />)).toContain("ds-tap-24");
  });

  // --- titles ---------------------------------------------------------------

  it("names the category and says the link leaves the site", () => {
    const html = renderToStaticMarkup(<OwaspBadge code="A03" />);
    expect(html).toContain("Injection");
    expect(html).toContain("owasp.org");
  });

  it("omits a title that would only repeat the visible code", () => {
    // An unrecognised code is labelled with itself, and title="A99" on text
    // reading "A99" is noise a screen reader still announces.
    expect(renderToStaticMarkup(<OwaspBadge code="A99" />)).not.toContain("title=");
  });

  it("normalizes a lowercase or padded code the way lib/owasp does", () => {
    const html = renderToStaticMarkup(<OwaspBadge code=" a03 " />);
    expect(html).toContain(">A03<");
    expect(html).toContain("A03_2021-Injection");
  });

  it("renders nothing at all for an empty code", () => {
    expect(renderToStaticMarkup(<OwaspBadge code="  " />)).toBe("");
  });
});
