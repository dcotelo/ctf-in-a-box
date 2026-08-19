import { describe, expect, it } from "vitest";
import { parseMarkdown, safeHref } from "@/lib/markdown";

describe("safeHref", () => {
  it("allows http, https and mailto", () => {
    expect(safeHref("https://owasp.org/x")).toBe("https://owasp.org/x");
    expect(safeHref("http://example.com/")).toBe("http://example.com/");
    expect(safeHref("mailto:ctf@example.com")).toBe("mailto:ctf@example.com");
  });

  // Each of these is a real, catalogued XSS vector. They must return null so
  // the caller renders the label as plain text with no anchor at all.
  it("rejects every non-allowlisted scheme, including obfuscated ones", () => {
    for (const hostile of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "  javascript:alert(1)",
      "java\nscript:alert(1)",
      "java\tscript:alert(1)",
      "java script:alert(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "//evil.example.com/x",
      "/leaderboard",
      "#anchor",
      "not a url at all",
    ]) {
      expect(safeHref(hostile), hostile).toBeNull();
    }
  });
});

describe("parseMarkdown", () => {
  it("splits paragraphs on blank lines", () => {
    expect(parseMarkdown("one\n\ntwo")).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "one" }] },
      { kind: "paragraph", children: [{ kind: "text", text: "two" }] },
    ]);
  });

  it("parses bold, italic and inline code", () => {
    expect(parseMarkdown("a **b** *c* `d`")).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "a " },
          { kind: "strong", children: [{ kind: "text", text: "b" }] },
          { kind: "text", text: " " },
          { kind: "em", children: [{ kind: "text", text: "c" }] },
          { kind: "text", text: " " },
          { kind: "code", text: "d" },
        ],
      },
    ]);
  });

  it("parses a fenced code block with its language", () => {
    expect(parseMarkdown("```js\nlet x = 1;\n```")).toEqual([
      { kind: "codeblock", lang: "js", text: "let x = 1;" },
    ]);
  });

  it("never treats content inside a fenced block as markup", () => {
    expect(parseMarkdown("```\n**not bold** <script>\n```")).toEqual([
      { kind: "codeblock", lang: null, text: "**not bold** <script>" },
    ]);
  });

  it("parses unordered and ordered lists", () => {
    expect(parseMarkdown("- a\n- b")).toEqual([
      { kind: "list", ordered: false, items: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]] },
    ]);
    expect(parseMarkdown("1. a\n2. b")).toEqual([
      { kind: "list", ordered: true, items: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]] },
    ]);
  });

  it("keeps a safe link and degrades an unsafe one to plain text", () => {
    expect(parseMarkdown("[ok](https://owasp.org)")).toEqual([
      {
        kind: "paragraph",
        children: [{ kind: "link", href: "https://owasp.org/", children: [{ kind: "text", text: "ok" }] }],
      },
    ]);
    // The LABEL survives; the anchor does not. Dropping the text entirely
    // would silently delete organizer copy.
    expect(parseMarkdown("[bad](javascript:evil)")).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "bad" }] },
    ]);
  });

  it("treats raw HTML as literal text, never as markup", () => {
    const blocks = parseMarkdown("<script>alert(1)</script>");
    expect(blocks).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "<script>alert(1)</script>" }] },
    ]);
  });

  it("truncates past MARKDOWN_MAX rather than parsing unbounded input", () => {
    const blocks = parseMarkdown("x".repeat(5000));
    const [block] = blocks;
    if (block.kind !== "paragraph" || block.children[0].kind !== "text") throw new Error("shape");
    expect(block.children[0].text.length).toBe(4000);
  });
});
