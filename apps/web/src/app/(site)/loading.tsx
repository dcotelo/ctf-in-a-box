// The fallback for every content route that doesn't ship a closer-fitting one.
//
// Why this exists at all: every page under `(site)` resolves its data from
// Redis at request time (`connection()` keeps them out of the build), so a
// nav click used to sit on the previous page with no acknowledgement until
// the read came back — on a loaded box mid-event, long enough to look broken
// and get clicked again.
//
// Note this fallback is only reached on a CLIENT navigation, which is the
// case that needed fixing. The shared layouts above it (the root layout's nav
// groups, this group's phase line and footer) also read at runtime, and per
// the vendored loading.js docs a `loading.js` does not cover a layout's own
// data — but those layouts are preserved across a client-side navigation and
// re-render only on a hard load, where the browser's own progress UI covers
// the wait.

import { Skeleton, SkeletonHeader, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="page">
      <SkeletonHeader />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </SkeletonPage>
  );
}
