// Custom 404. Lives at the app root rather than inside the `(site)` group so
// it also covers URLs that never matched a route group at all. The header comes
// from the root layout; the centered column and footer are re-created here the
// same way `src/app/page.tsx` does, since neither is inherited outside `(site)`.
//
// The body — heading, terminal line, route directory — is shared with the
// per-module 404 boundaries under `(site)`, which say something truer than
// "the link is wrong" when a module has simply been switched off. See
// `components/not-found-body.tsx`.
//
// Note: `not-found.tsx` is not a route segment, so it can't export `metadata` —
// the browser tab keeps the site-wide default title from the root layout.

import SiteFooter from "@/components/site-footer";
import NotFoundBody, { getNotFoundRoutes } from "@/components/not-found-body";
import { getNavLinks } from "@/lib/resolved-modules";
import { event } from "@/lib/site";

// `async` because it re-creates the footer, whose links are resolved
// per-request (`not-found.js` may be a Server Component and may be async —
// see the vendored not-found docs' "Data Fetching" example).
export default async function NotFound() {
  const routes = await getNotFoundRoutes();
  return (
    <>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-10">
          <NotFoundBody
            routes={routes}
            title="No such route"
            description="That page doesn't exist. Nothing is broken on your end. The link is just wrong or out of date."
          />

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
