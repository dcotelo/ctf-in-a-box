"use client";

// The "Challenges" header dropdown that collapses 2+ module nav entries into
// one menu, per the WAI-ARIA MENU BUTTON pattern — deliberately not the tabs
// pattern admin-controls.tsx uses. A menu button's trigger is a <button> with
// aria-haspopup="menu"/aria-expanded, the popup carries role="menu" with
// role="menuitem" children, and only one thing is ever focused at a time
// (Escape returns focus to the trigger, arrows move within the open menu) —
// unlike tabs, there is no roving tabIndex across a strip of always-visible,
// always-focusable controls. See:
// https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
//
// Isolated from SiteHeader's own state (pathname, mobile toggle) so this
// component's own contract — open/closed, keyboard, click-outside — is
// self-contained and can be reasoned about (and tested) on its own.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { NavLink } from "@/lib/site";
import { itemKeyAction, triggerKeyAction } from "@/lib/nav-menu-keys";

export default function NavDropdown({
  label,
  items,
  isActive,
}: {
  label: string;
  items: NavLink[];
  /** Same active-link test the header applies to its plain links, so the
   *  current page's module is discoverable: the trigger picks up the active
   *  treatment when any child is the current page, and that child itself
   *  gets `aria-current="page"` inside the open menu. */
  isActive: (href: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  // Index to focus once the menu is (re-)opened, so a keyboard open always
  // lands focus on a specific item (first, or last for ArrowUp) rather than
  // leaving it on the trigger.
  const [pendingFocus, setPendingFocus] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const active = items.some((item) => isActive(item.href));

  useEffect(() => {
    if (open && pendingFocus !== null) {
      itemRefs.current[pendingFocus]?.focus();
      setPendingFocus(null);
    }
  }, [open, pendingFocus]);

  // Click outside the trigger+menu closes it, per the menu button pattern.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const openTo = (index: number) => {
    setOpen(true);
    setPendingFocus(index);
  };

  const focusItem = (index: number) => {
    itemRefs.current[index]?.focus();
  };

  const onTriggerClick = () => {
    if (open) {
      setOpen(false);
    } else {
      openTo(0);
    }
  };

  // Both handlers below are a thin binding of the pure decision in
  // `@/lib/nav-menu-keys` to real DOM effects (focus(), setOpen,
  // preventDefault) — see that module for the actual keyboard contract and
  // its tests, and nav-dropdown.test.tsx for why this file only covers the
  // closed static render.
  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const action = triggerKeyAction(e.key, items.length);
    if (action.type === "open") {
      e.preventDefault();
      openTo(action.focusIndex);
    } else if (action.type === "close") {
      setOpen(false);
    }
  };

  const onItemKeyDown = (e: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    const action = itemKeyAction(e.key, index, items.length);
    if (action.type === "focus") {
      e.preventDefault();
      focusItem(action.index);
    } else if (action.type === "close-refocus-trigger") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (action.type === "close") {
      // Tab: don't preventDefault — focus is about to move on natively.
      setOpen(false);
    }
  };

  const onItemClick = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    void e;
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
        className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb] ${
          active ? "bg-white/[0.06] font-medium text-white" : "text-zinc-400 hover:text-white"
        }`}
      >
        {label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          role="menu"
          aria-label={label}
          className="absolute left-0 top-full z-10 mt-1 min-w-[10rem] rounded-md border border-white/[0.06] bg-[#1a1a2a] py-1 shadow-lg"
        >
          {items.map((item, index) => (
            <li key={item.href} role="none">
              <Link
                href={item.href}
                role="menuitem"
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                aria-current={isActive(item.href) ? "page" : undefined}
                onClick={onItemClick}
                onKeyDown={(e) => onItemKeyDown(e, index)}
                className={`block px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563eb] ${
                  isActive(item.href)
                    ? "bg-white/[0.06] font-medium text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
