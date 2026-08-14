// Footer shared by content routes. Plain Server Component — no interactivity.

import Link from "next/link";
import { event, navLinks, legalLinks } from "@/lib/site";

export default function SiteFooter() {
  return (
    <footer className="relative mt-auto border-t border-white/[0.06]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#2563eb]/20 to-transparent" />
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-mono text-sm text-white">
              <span className="text-[#22c55e]">$</span> owasp-ctf
            </p>
            {(event.dates || event.location) && (
              <p className="mt-1 text-sm text-muted">
                {[event.dates, event.location].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-zinc-400 transition-colors hover:text-[#2563eb]"
              >
                {link.label}
              </Link>
            ))}
            {event.discordUrl && (
              <a
                href={event.discordUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-zinc-400 transition-colors hover:text-[#2563eb]"
              >
                Discord
              </a>
            )}
          </nav>
        </div>

        {/* Policy routes sit in their own quieter row rather than in navLinks,
            which drives the header. The contact address rides along here so
            there is a way to reach the organizers from every page. */}
        <nav
          aria-label="Policies and contact"
          className="flex flex-wrap gap-x-5 gap-y-2 border-t border-white/[0.06] pt-5"
        >
          {legalLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-xs text-muted transition-colors hover:text-zinc-300"
            >
              {link.label}
            </Link>
          ))}
          {event.contactEmail && (
            <a
              href={`mailto:${event.contactEmail}`}
              className="text-xs text-muted transition-colors hover:text-zinc-300"
            >
              Contact
            </a>
          )}
        </nav>
      </div>
    </footer>
  );
}
