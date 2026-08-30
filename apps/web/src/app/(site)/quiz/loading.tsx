// Quiz fallback. Question cards: a prompt line and a short stack of choice
// rows, which is what quiz-board.tsx renders once the viewer's per-question
// status has been resolved.

import { Skeleton, SkeletonHeader, SkeletonPage } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="quiz">
      <SkeletonHeader />
      <div className="flex flex-col gap-5">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="rounded-lg border border-white/[0.06] bg-[#16162a] p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-5 w-3/5" />
              <Skeleton className="h-5 w-16 flex-none" />
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
