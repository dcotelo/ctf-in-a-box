// A deliberately small markdown subset for organizer-authored challenge
// descriptions. It parses to a NODE TREE and never to an HTML string — the
// renderer (components/markdown.tsx) turns nodes into React elements, so
// `dangerouslySetInnerHTML` is never involved and injected markup is
// structurally impossible rather than filtered out. `<` is just a character
// here with no special handling anywhere in the pipeline.
//
// Keep it that way. Any future feature that needs raw HTML needs a different
// design, not a hole in this one.

export type MdInline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: MdInline[] }
  | { kind: "em"; children: MdInline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: MdInline[] };

export type MdBlock =
  | { kind: "paragraph"; children: MdInline[] }
  | { kind: "codeblock"; lang: string | null; text: string }
  | { kind: "list"; ordered: boolean; items: MdInline[][] };

/** Cap on a stored description. Bounds both parse work and payload size. */
export const MARKDOWN_MAX = 4000;

const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** Returns the href to render, or `null` when the target is not one this
 *  renderer will link to — in which case the caller renders the label as
 *  plain text.
 *
 *  Control characters and whitespace are stripped BEFORE parsing: `java\nscript:`,
 *  `java\tscript:` and `java script:` are historic browser-normalization
 *  bypasses, and a check on the raw string sees a scheme `new URL` never will.
 *  Scheme-relative `//host` is rejected explicitly because `new URL` cannot
 *  parse it standalone and it inherits the page's scheme in an `href` — the
 *  one case where "unparseable" and "harmless" diverge.
 *
 *  Relative and fragment targets are rejected too. The allowlist is the
 *  whole contract: three absolute schemes, nothing else. */
export function safeHref(raw: string): string | null {
  const cleaned = raw.replace(/[\u0000-\u001f\u007f\s]/g, "");
  if (cleaned.startsWith("//")) return null;
  try {
    const url = new URL(cleaned);
    return ALLOWED_SCHEMES.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Inline pass. Ordered so `code` wins over emphasis — backticks in markdown
 *  suppress other markup inside them, and a payload written as `` `**x**` ``
 *  must render literally. */
function parseInline(src: string): MdInline[] {
  const out: MdInline[] = [];
  let rest = src;

  const PATTERNS: { re: RegExp; build: (m: RegExpExecArray) => MdInline | null }[] = [
    { re: /^`([^`]+)`/, build: (m) => ({ kind: "code", text: m[1] }) },
    { re: /^\*\*([^*]+)\*\*/, build: (m) => ({ kind: "strong", children: parseInline(m[1]) }) },
    { re: /^\*([^*]+)\*/, build: (m) => ({ kind: "em", children: parseInline(m[1]) }) },
    {
      re: /^\[([^\]]*)\]\(([^)]*)\)/,
      build: (m) => {
        const href = safeHref(m[2]);
        // No href we will link to: keep the LABEL as text. Dropping it would
        // silently delete organizer copy over a link problem.
        if (!href) return m[1] ? { kind: "text", text: m[1] } : null;
        return { kind: "link", href, children: parseInline(m[1]) };
      },
    },
  ];

  let buffer = "";
  const flush = () => {
    if (buffer) {
      out.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  while (rest.length > 0) {
    let matched = false;
    for (const { re, build } of PATTERNS) {
      const m = re.exec(rest);
      if (!m) continue;
      flush();
      const node = build(m);
      if (node) out.push(node);
      rest = rest.slice(m[0].length);
      matched = true;
      break;
    }
    if (!matched) {
      buffer += rest[0];
      rest = rest.slice(1);
    }
  }
  flush();
  return out;
}

const UL_RE = /^[-*]\s+(.*)$/;
const OL_RE = /^\d+\.\s+(.*)$/;

/** Block pass: fenced code first (its contents are never re-parsed), then
 *  lists, then paragraphs. */
export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.slice(0, MARKDOWN_MAX).split(/\r?\n/);
  const blocks: MdBlock[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push({ kind: "paragraph", children: parseInline(para.join(" ").trim()) });
    para = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (line.startsWith("```")) {
      flushPara();
      const lang = line.slice(3).trim() || null;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      blocks.push({ kind: "codeblock", lang, text: body.join("\n") });
      continue;
    }

    const ul = UL_RE.exec(line);
    const ol = OL_RE.exec(line);
    if (ul || ol) {
      flushPara();
      const ordered = Boolean(ol);
      const items: MdInline[][] = [];
      while (i < lines.length) {
        const m = ordered ? OL_RE.exec(lines[i]) : UL_RE.exec(lines[i]);
        if (!m) break;
        items.push(parseInline(m[1]));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    if (line.trim() === "") {
      flushPara();
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}
