// Classic flag-board fallback. The board is a tile grid by category with the
// "Your run" rail beside it (classic-board.tsx), so the placeholder reserves
// a rail plus a tile grid rather than the generic prose block.

import { Skeleton, SkeletonHeader, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="flag board">
      <SkeletonHeader />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }, (_, row) => (
          <div key={row} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }, (_, col) => (
                <Skeleton key={col} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
