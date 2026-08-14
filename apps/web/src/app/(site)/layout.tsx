// Layout for all content routes (everything except the bespoke home hero).
// Route groups `(site)` don't add a URL segment — this just shares the header,
// a centered content column, and the footer across the grouped pages.

import SiteFooter from "@/components/site-footer";

// The shared header lives in the root layout, so it's already rendered above
// this content. Here we just provide the centered column and the footer.
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
