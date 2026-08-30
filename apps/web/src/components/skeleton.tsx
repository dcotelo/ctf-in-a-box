// Route-level loading placeholders.
//
// Every `loading.tsx` in this app composes these three pieces rather than
// hand-rolling its own grey boxes, so a slow Redis read looks like one
// product on every route. The visual atom is `.ds-skeleton` in globals.css.
//
// Accessibility: the boxes themselves are decorative and are hidden from
// assistive tech; `SkeletonPage` carries the single announcement. A route
// transition in the App Router moves no focus and prints nothing a screen
// reader would notice, so without that live region a contestant on a screen
// reader gets silence between the click and the page — the same dead air a
// sighted contestant used to get, only permanent.

/** One shimmering block. Decorative — the announcement lives on the page
 *  wrapper, so this is hidden rather than announced 40 times over. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`ds-skeleton ${className}`} />;
}

/** The `PageHeader` silhouette: eyebrow, title, lede, gradient divider. Kept
 *  dimensionally close to the real header (`page-header.tsx`) so the swap
 *  from skeleton to content doesn't shove the page down — the placeholder
 *  exists to reserve the space, and one that reserves the wrong amount trades
 *  a blank screen for a layout shift. */
export function SkeletonHeader() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-10 w-2/3 max-w-md sm:h-12" />
      <Skeleton className="h-4 w-full max-w-2xl" />
      <div
        aria-hidden="true"
        className="mt-2 h-px w-full bg-gradient-to-r from-[#2563eb]/40 via-white/[0.06] to-transparent"
      />
    </div>
  );
}

/** The wrapper every `loading.tsx` returns: the shared column rhythm plus the
 *  one live region that tells a screen reader something is on its way.
 *
 *  `role="status"` (an implicit `aria-live="polite"`) rather than `alert`:
 *  a pending page is not an error, and polite lets the announcement wait for
 *  a pause in speech instead of cutting the user off mid-sentence. */
export function SkeletonPage({
  label,
  children,
}: {
  /** What is loading, in the contestant's words — "leaderboard", not
   *  "leaderboard route segment". Announced as "Loading <label>…". */
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-8">
      <span className="sr-only">Loading {label}…</span>
      {children}
    </div>
  );
}
