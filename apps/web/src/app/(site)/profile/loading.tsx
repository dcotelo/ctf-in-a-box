// Profile fallback. The real page stacks the team card over the run/progress
// panels, so the placeholder reserves one wide card and a two-up panel row.

import { Skeleton, SkeletonHeader, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="profile">
      <SkeletonHeader />
      <div className="rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 flex-none rounded-full" />
          <div className="flex w-full flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className="rounded-lg border border-white/[0.06] bg-[#16162a] p-5"
          >
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-4 h-8 w-20" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
