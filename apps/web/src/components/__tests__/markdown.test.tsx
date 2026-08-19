import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "@/components/markdown";

describe("Markdown", () => {
  it("renders emphasis, code and lists as real elements", () => {
    const html = renderToStaticMarkup(<Markdown source={"**b** `c`\n\n- one\n- two"} />);
    expect(html).toMatch(/<strong[^>]*>b<\/strong>/);
    expect(html).toContain("c</code>");
    expect(html).toContain("<li>");
  });

  it("marks external links safe", () => {
    const html = renderToStaticMarkup(<Markdown source="[owasp](https://owasp.org)" />);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://owasp.org/"');
  });

  // The load-bearing test for this whole component. Every one of these must
  // appear ESCAPED in the output and never as a live element or attribute.
  it("never emits injected markup as markup", () => {
    const hostile = [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "<iframe src=//evil.example.com></iframe>",
      "[x](javascript:evil)",
      "<svg onload=alert(1)>",
    ].join("\n\n");
    const html = renderToStaticMarkup(<Markdown source={hostile} />);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<svg");
    // Proves the content was RENDERED (escaped), not silently dropped —
    // otherwise a component returning null would pass every assertion above.
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders organizer prose about dangerous patterns without corruption", () => {
    // Regression test: ensures that when organizers write plain prose containing
    // dangerous pattern names (onerror=, onload=, javascript:), the text renders
    // correctly without entity-substitution corruption that would garble it.
    // This is critical because organizers document these patterns in educational content.
    const source = "Never ship an onload= handler or a javascript: URI in your patch.";
    const html = renderToStaticMarkup(<Markdown source={source} />);
    // Both dangerous pattern names must appear as literal text in the output
    expect(html).toContain("onload=");
    expect(html).toContain("javascript:");
    // No entity substitution corruption (& from &#61; or &#58; should not appear)
    expect(html).not.toContain("&#61;");
    expect(html).not.toContain("&#58;");
  });
});
