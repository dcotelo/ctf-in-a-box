// Leaderboard fallback. The real board is a filter row over a rank list, and
// it is the page most likely to be slow: it reads every team's score plus the
// scoring window on every request, and it is the page contestants refresh
// hardest during a live event.

import { Skeleton, SkeletonHeader, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="leaderboard">
      <SkeletonHeader />

      {/* The search field + toggles row. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-9 w-full sm:max-w-xs" />
        <Skeleton className="h-9 w-40" />
      </div>

      {/* Rank rows. Ten is roughly a first screenful — enough to fill the
          viewport so the swap to real rows doesn't jump, few enough that the
          placeholder never outlives its usefulness on a short board. */}
      <div className="flex flex-col gap-2">
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-lg border border-white/[0.06] bg-[#16162a] px-4 py-3.5"
          >
            <Skeleton className="h-5 w-6 flex-none" />
            <Skeleton className="h-5 w-full max-w-[14rem]" />
            <Skeleton className="ml-auto h-5 w-16 flex-none" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
