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
import { enabledApps, joinAppNames } from "@/lib/apps";
import type { RulesContext } from "@/lib/modules";
import { getModuleRouteCard, getNavLinks, getResolvedModules } from "@/lib/resolved-modules";
import { event } from "@/lib/site";

// Where a lost visitor is offered to go next. Platform routes only — the
// module ones are spliced in ahead of these, per module, so the 404 can never
// again offer a card to /challenges on an event that has no such route (it
// 404'd straight back, from the 404 page, while the footer directly beneath it
// listed the module route that DID exist).
const platformRoutes = [
  { href: "/how-to-play", label: "How to Play", body: "The full loop, with a worked example." },
  { href: "/leaderboard", label: "Leaderboard", body: "Live standings for contestants and teams." },
  { href: "/faq", label: "FAQ", body: "Answers to what contestants ask most." },
];

// `async` because it re-creates the footer, whose links are resolved
// per-request (`not-found.js` may be a Server Component and may be async —
// see the vendored not-found docs' "Data Fetching" example), and because the
// module cards are resolved the same way.
export default async function NotFound() {
  const ctx: RulesContext = {
    appCount: enabledApps.length,
    appList: joinAppNames(enabledApps.map((a) => a.name)),
  };
  // Label and href off the resolved module (so an organizer's rename shows up
  // here exactly as it does in the nav — `titleOverride`, not `title`, for the
  // reason spelled out on ResolvedModule); the body off the registry's
  // server-only `routeCard`, which is a function and therefore never rides on
  // the resolved object. A module with no route, or no card, contributes none.
  const moduleRoutes = (await getResolvedModules()).flatMap((module) => {
    const card = getModuleRouteCard(module.id);
    if (!module.nav || !card) return [];
    return [
      {
        href: module.nav.href,
        label: module.titleOverride || module.nav.label,
        body: card(ctx),
      },
    ];
  });
  const routes = [...moduleRoutes, ...platformRoutes];

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
            Landed here from a link on this site? Tell an organizer
            {event.discordUrl && (
              <>
                , or say so in the{" "}
                <a
                  href={event.discordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ds-link"
                >
                  CTF Discord
                </a>
              </>
            )}
            .
          </p>
        </div>
      </main>
      <SiteFooter navLinks={await getNavLinks()} />
    </>
  );
}
