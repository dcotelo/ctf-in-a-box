// Layout for all content routes (everything except the bespoke home hero).
// Route groups `(site)` don't add a URL segment — this just shares the header,
// a centered content column, and the footer across the grouped pages.

import PhaseLine from "@/components/phase-line";
import SiteFooter from "@/components/site-footer";
import { getNavLinks } from "@/lib/resolved-modules";

// The shared header lives in the root layout, so it's already rendered above
// this content. Here we just provide the centered column and the footer.
//
// The footer's links are resolved from the SAME accessor the root layout uses
// for the header, so an organizer's module rename reaches both. The read is
// memoized per request, so this costs nothing on top of the header's.
export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Awaited here rather than mounted as <PhaseLine />: an async child inside
  // renderToStaticMarkup suspends (the not-found pages hit this same trap),
  // and the nav-parity test renders this layout statically.
  const phaseLine = await PhaseLine();
  return (
    <>
      {/* The event's state, on every content page — see phase-line.tsx. */}
      {phaseLine}
      <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        {children}
      </main>
      <SiteFooter navLinks={await getNavLinks()} />
    </>
  );
}
