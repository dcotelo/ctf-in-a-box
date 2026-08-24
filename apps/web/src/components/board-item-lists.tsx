"use client";

// The quiz/classic Show-N item lists for an EXPANDED leaderboard row —
// which questions a contestant answered, which flags a team has solved.
// Per-item data isn't in the board payload (embedding it for every row
// would bloat a no-store page nobody has expanded), so this fetches from
// /api/board/items on mount — i.e. on expand — and renders the same
// ModuleItemList the profile blocks use. Renders nothing until the data
// lands and nothing at all on failure: this is detail, never a gate.

import { useEffect, useState } from "react";
import ModuleItemList, { type ModuleItem } from "@/components/module-item-list";

type ItemsResponse = { quiz: ModuleItem[] | null; classic: ModuleItem[] | null };

export default function BoardItemLists({ logins }: { logins: string[] }) {
  const [data, setData] = useState<ItemsResponse | null>(null);
  const key = logins.join(",");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetch(`/api/board/items?logins=${encodeURIComponent(key)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d: ItemsResponse | null) => {
        if (!cancelled && d) setData(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!data) return null;
  const quiz = data.quiz ?? [];
  const classic = data.classic ?? [];
  if (quiz.length === 0 && classic.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      {quiz.length > 0 && (
        <ModuleItemList items={quiz} noun={quiz.length === 1 ? "question" : "questions"} doneLabel="Answered" />
      )}
      {classic.length > 0 && (
        <ModuleItemList items={classic} noun={classic.length === 1 ? "flag" : "flags"} doneLabel="Solved" />
      )}
    </div>
  );
}
