// Renders the node tree from lib/markdown.ts as React elements.
//
// There is deliberately no `dangerouslySetInnerHTML` here and there must
// never be one: React escapes every text node it renders, so organizer copy
// containing `<script>` is displayed as those literal characters. That is
// what makes stored XSS structurally impossible in this path rather than a
// thing a sanitizer is trusted to catch.

import type { MdBlock, MdInline } from "@/lib/markdown";
import { parseMarkdown } from "@/lib/markdown";

function Inline({ nodes }: { nodes: MdInline[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.kind) {
          case "text":
            return node.text;
          case "strong":
            return (
              <strong key={i} className="font-semibold text-white">
                <Inline nodes={node.children} />
              </strong>
            );
          case "em":
            return (
              <em key={i} className="italic text-zinc-200">
                <Inline nodes={node.children} />
              </em>
            );
          case "code":
            return (
              <code key={i} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.9em]">
                {node.text}
              </code>
            );
          case "link":
            // href is already allowlisted by safeHref — an unsafe target
            // never reaches this branch, it becomes a text node upstream.
            return (
              <a
                key={i}
                href={node.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
              >
                <Inline nodes={node.children} />
              </a>
            );
        }
      })}
    </>
  );
}

function Block({ block }: { block: MdBlock }) {
  if (block.kind === "codeblock") {
    return (
      <pre className="overflow-x-auto rounded-md border border-white/10 bg-[#0e1220] p-3 font-mono text-xs text-zinc-200">
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.kind === "list") {
    const List = block.ordered ? "ol" : "ul";
    return (
      <List className={`ml-5 space-y-1 ${block.ordered ? "list-decimal" : "list-disc"}`}>
        {block.items.map((item, i) => (
          <li key={i}>
            <Inline nodes={item} />
          </li>
        ))}
      </List>
    );
  }
  return (
    <p className="leading-relaxed text-zinc-300">
      <Inline nodes={block.children} />
    </p>
  );
}

export default function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="space-y-3 text-sm">
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}
