// Custom 404. Lives at the app root rather than inside the `(site)` group so
// it also covers URLs that never matched a route group at all. The header comes
// from the root layout; the centered column and footer are re-created here the
// same way `src/app/page.tsx` does, since neither is inherited outside `(site)`.
//
// Note: `not-found.tsx` is not a route segment, so it can't export `metadata` —
// the browser tab keeps the site-wide default title from the root layout.

import Link from "next/link";
import SiteFooter from "@/components/site-footer";
import PageHeader from "@/components/page-header";
import { event } from "@/lib/site";

const routes = [
  { href: "/challenges", label: "Challenges", body: "Every challenge across the six targets." },
  { href: "/how-to-play", label: "How to Play", body: "The full loop, with a worked example." },
  { href: "/leaderboard", label: "Leaderboard", body: "Live standings for contestants and teams." },
  { href: "/faq", label: "FAQ", body: "Answers to what contestants ask most." },
];

export default function NotFound() {
  return (
    <>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-10">
          <PageHeader
            eyebrow="404"
            title="No such route"
            description="That page doesn't exist. Nothing is broken on your end. The link is just wrong or out of date."
          />

          <div className="rounded-lg border border-white/[0.06] bg-[#12121e] px-6 py-3.5 font-mono text-sm text-muted">
            <span className="text-[#22c55e]">$</span> owasp-ctf goto{" "}
            <span className="text-zinc-400">--route</span> <span>not_found</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {routes.map((r) => (
              <Link
                key={r.href}
                href={r.href}
                className="ds-card rounded-lg border border-white/[0.06] bg-[#16162a] p-5 transition-colors hover:border-[#2563eb]/40"
              >
                <h2 className="font-semibold text-white">{r.label}</h2>
                <p className="mt-1 text-sm leading-relaxed text-zinc-400">{r.body}</p>
              </Link>
            ))}
          </div>

          <p className="text-sm leading-relaxed text-zinc-400">
            Landed here from a link on this site? Tell an organizer, or say so in the{" "}
            <a
              href={event.discordUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ds-link"
            >
              CTF Discord
            </a>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
