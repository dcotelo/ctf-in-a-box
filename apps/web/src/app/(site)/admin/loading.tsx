// Admin fallback. The panel is a tab strip over a settings surface, and its
// reads are the heaviest in the app (settings, activity, metrics), so it is
// the route where an unacknowledged click is most likely.

import { Skeleton, SkeletonHeader, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="admin panel">
      <SkeletonHeader />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>
      <div className="rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
        <div className="flex flex-col gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-8 w-24 flex-none" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}
