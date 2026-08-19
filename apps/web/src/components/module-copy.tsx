// Renders a module's registry copy — see `Copy`/`CopySegment` in
// `@/lib/modules`.
//
// The registry deliberately holds no JSX (it has to stay importable either
// side of the server boundary), but a few contestant-facing sentences do need
// inline markup: an emphasised challenge name, the bold lead-in on a rule, the
// Secure Agent Playbook link mid-clause. This is the one place those segments
// become elements, so every page renders them the same way — and so the markup
// stays byte-identical to the hand-written JSX these strings were moved out of.
//
// Plain data in, elements out: no state, no client boundary. Both `/rules` and
// `/how-to-play` render it inside their own paragraph or list item, so this
// emits a fragment and never a block element of its own.
import { Fragment } from "react";
import type { Copy, CopySegment } from "@/lib/modules";

function renderSegment(segment: CopySegment) {
  if (typeof segment === "string") return segment;
  if ("em" in segment) return <span className="text-zinc-200">{segment.em}</span>;
  if ("strong" in segment) return <span className="text-white">{segment.strong}</span>;
  return (
    <a
      href={segment.link.href}
      target="_blank"
      rel="noopener noreferrer"
      className="ds-link"
    >
      {segment.link.label}
    </a>
  );
}

export default function ModuleCopy({ copy }: { copy: Copy }) {
  if (typeof copy === "string") return <>{copy}</>;
  return (
    <>
      {copy.map((segment, i) => (
        // Index keys: a copy array is a fixed, ordered run of text that is
        // never reordered or filtered — there is no identity to preserve.
        <Fragment key={i}>{renderSegment(segment)}</Fragment>
      ))}
    </>
  );
}
