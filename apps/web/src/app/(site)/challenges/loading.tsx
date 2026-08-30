// Challenge browser fallback. The real page is a stack of collapsible target
// cards (see challenge-grid.tsx), so the placeholder is card-shaped rather
// than row-shaped: a contestant who sees three tall cards and then gets three
// tall cards has watched the page fill in, not jump.

import { Skeleton, SkeletonHeader, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="challenges">
      <SkeletonHeader />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="rounded-lg border border-white/[0.06] bg-[#16162a] p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-5 w-24 flex-none" />
            </div>
            <Skeleton className="mt-4 h-1.5 w-full" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
