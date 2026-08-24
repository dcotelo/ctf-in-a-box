"use client";

// Sticky top nav shared across every route. It's a Client Component because it
// reads the current pathname to highlight the active link and toggles a mobile
// menu — both need browser-side state the server can't provide.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { event, isNavGroup, type NavEntry } from "@/lib/site";
import AuthNav from "@/components/auth-nav";
import NavDropdown from "@/components/nav-dropdown";

export default function SiteHeader({ navLinks }: { navLinks: NavEntry[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#0e1220]/80 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="font-mono text-sm font-semibold tracking-tight text-white transition-colors hover:text-[#e6edf3]"
        >
          <span className="text-[#3fb950]">$</span> owasp-ctf
        </Link>

        {/* Desktop nav */}
        <ul className="hidden items-center gap-1 md:flex">
          {navLinks.map((entry) =>
            isNavGroup(entry) ? (
              <li key={entry.label}>
                <NavDropdown label={entry.label} items={entry.items} isActive={isActive} />
              </li>
            ) : (
              <li key={entry.href}>
                <Link
                  href={entry.href}
                  aria-current={isActive(entry.href) ? "page" : undefined}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d29922] ${
                    isActive(entry.href)
                      ? "bg-white/[0.06] font-medium text-white"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {entry.label}
                </Link>
              </li>
            ),
          )}
          {/* External, so it can't come from navLinks — those are internal
              routes and drive the active-link state. */}
          {event.discordUrl && (
            <li>
              <a
                href={event.discordUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d29922]"
              >
                Discord
              </a>
            </li>
          )}
        </ul>

        <div className="flex items-center gap-2">
          <AuthNav />

          {/* Mobile toggle */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="Toggle navigation menu"
            className="rounded-md p-2 text-zinc-400 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d29922] md:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {open ? (
                <path d="M18 6 6 18M6 6l12 12" />
              ) : (
                <path d="M3 12h18M3 6h18M3 18h18" />
              )}
            </svg>
          </button>
        </div>
      </nav>

      {/* Mobile menu. The whole panel is already a disclosure toggled by the
          button above, so a group renders as a plain label over its
          indented children rather than a second, nested interactive menu —
          there's nothing for a mobile menu-button pattern to add here. */}
      {open && (
        <ul className="flex flex-col gap-1 border-t border-white/[0.06] px-4 pb-4 pt-2 md:hidden">
          {navLinks.map((entry) =>
            isNavGroup(entry) ? (
              <li key={entry.label}>
                <span className="block px-3 pt-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {entry.label}
                </span>
                <ul className="flex flex-col gap-1">
                  {entry.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={isActive(item.href) ? "page" : undefined}
                        className={`block rounded-md px-5 py-2 text-sm transition-colors ${
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
              </li>
            ) : (
              <li key={entry.href}>
                <Link
                  href={entry.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(entry.href) ? "page" : undefined}
                  className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive(entry.href)
                      ? "bg-white/[0.06] font-medium text-white"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {entry.label}
                </Link>
              </li>
            ),
          )}
          {event.discordUrl && (
            <li>
              <a
                href={event.discordUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="block rounded-md px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-white"
              >
                Discord
              </a>
            </li>
          )}
        </ul>
      )}
    </header>
  );
}
