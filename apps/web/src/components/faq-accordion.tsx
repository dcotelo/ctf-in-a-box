"use client";

// Accordion: client state tracks which question is open. Each item is a real
// <button> so it's keyboard-operable, with aria-expanded/aria-controls driving
// assistive tech. Question and answer live inside ONE card so an open answer
// reads as part of its question instead of floating on the page background.

import { useEffect, useId, useRef, useState } from "react";
import { indexForHash } from "@/lib/faq-anchor";

/** `id` is optional and only set on questions worth deep linking to — it becomes
 *  the <li> anchor, so /faq#<id> opens that panel. */
export type QA = { q: string; a: React.ReactNode; id?: string };

export default function FaqAccordion({ items }: { items: QA[] }) {
  const [open, setOpen] = useState<number | null>(0);
  const base = useId();
  const listRef = useRef<HTMLUListElement>(null);

  // Deep links like /faq#<id>. The hash is never sent to the server, so
  // the matching panel can only be opened after hydration — by which point the
  // browser has already done its native scroll to a still-collapsed <li>. Open
  // the panel, then re-scroll now that it has its expanded height.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function openFromHash() {
      const index = indexForHash(items, window.location.hash);
      if (index === null) return;
      setOpen(index);
      // Cancel any scroll still pending from a previous hashchange before
      // scheduling this one, so they can't land out of order.
      clearTimeout(timer);
      // The panel's grid-rows transition runs 200ms (duration-200 on the grid
      // div below); scrolling before it finishes centres the still-collapsed
      // row. Wait it out, then centre.
      timer = setTimeout(() => {
        listRef.current?.children[index]?.scrollIntoView({ block: "center" });
      }, 200);
    }
    openFromHash();
    // Same-page anchor clicks fire hashchange without a remount.
    window.addEventListener("hashchange", openFromHash);
    return () => {
      window.removeEventListener("hashchange", openFromHash);
      clearTimeout(timer);
    };
  }, [items]);

  return (
    <ul ref={listRef} className="flex flex-col gap-2.5">
      {items.map((item, i) => {
        const isOpen = open === i;
        const buttonId = `${base}-q${i}`;
        const panelId = `${base}-a${i}`;
        return (
          <li
            key={i}
            id={item.id}
            className={`ds-card overflow-hidden rounded-lg border bg-[#131826] transition-colors ${
              isOpen ? "border-[#e6edf3]/40" : "border-white/[0.06] hover:border-[#e6edf3]/40"
            }`}
          >
            <button
              type="button"
              id={buttonId}
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d29922]"
            >
              <span className="font-medium text-white">{item.q}</span>
              <svg
                className={`flex-none transition-transform ${isOpen ? "rotate-45 text-[#e6edf3]" : "text-zinc-400"}`}
                width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            {/* grid-rows 0fr -> 1fr animates height without measuring content.
                `inert` keeps the collapsed answer out of tab order and the
                accessibility tree while it stays in the DOM for the transition. */}
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="overflow-hidden">
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  inert={!isOpen}
                  className="max-w-[68ch] px-5 pb-5 text-[0.9375rem] leading-relaxed text-zinc-300"
                >
                  {item.a}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
