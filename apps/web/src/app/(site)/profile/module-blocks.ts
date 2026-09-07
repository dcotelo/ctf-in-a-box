// The profile's per-module numbers, lifted out of the page so that file stays
// a data-fetching Server Component rather than a fetcher plus four modules'
// worth of arithmetic. Pure functions over what the page has already read —
// no store access of their own.
//
// Every list item is built FIELD BY FIELD from the public records, never a
// spread of a store row: a classic record's siblings include the flag, a quiz
// record's the answer key.

import type { AppId } from "@/lib/apps";
import type { AppProgress, ModuleProgress, UserProfile } from "@/lib/leaderboard/types";
import type { ModuleId, ResolvedModule } from "@/lib/modules";
import { moduleUnit } from "@/components/progress/progress-row";
import type { ProgressItem } from "@/components/progress/challenge-list";
import type { RemainingModule } from "@/components/progress/remaining-line";
import type { AiChallenge, AiTotal, ViewerAi } from "@/lib/ai-store";
import type { Challenge, ClassicTotal, ViewerClassic } from "@/lib/classic-store";
import type { Question, QuizTotal, ViewerQuiz } from "@/lib/quiz-store";

/** Everything the builders below read, gathered by the page. One module's
 *  slice is `undefined` exactly when that module is disabled. */
export type ProfileModuleInput = {
  profile: UserProfile | null;
  appsRecord: Partial<Record<AppId, AppProgress>>;
  /** The event's completable secure-development challenges, already resolved
   *  through the same helper the public board uses. */
  challengeCount: number;
  secureDev: boolean;
  quiz?: { total?: QuizTotal; questions: Question[]; maxPoints: number; viewer: ViewerQuiz };
  classic?: { total?: ClassicTotal; challenges: Challenge[]; maxPoints: number; viewer: ViewerClassic };
  ai?: { total?: AiTotal; challenges: AiChallenge[]; maxPoints: number; viewer: ViewerAi };
};

/** Each enabled module's contribution, keyed the way `withModuleContributions`
 *  keys `LeaderboardEntry.modules` — which is what drives the page's block loop
 *  off the enabled-module LIST rather than a per-module branch. A module with
 *  nothing to show contributes no entry and so renders no block, mirroring the
 *  leaderboard's own gate.
 *
 *  Every denominator is clamped to its own numerator, mirroring
 *  module-contributions.ts: a deleted item deliberately leaves banked points
 *  and the aggregate counter alone, so the list can shrink while the count
 *  does not, and "1 / 0 answered" is worse than an imprecise "1 / 1". */
export function buildModuleProgress(input: ProfileModuleInput): Partial<Record<ModuleId, ModuleProgress>> {
  const { profile } = input;
  const blocks: Partial<Record<ModuleId, ModuleProgress>> = {};
  if (input.secureDev && Object.keys(input.appsRecord).length > 0) {
    blocks["secure-development"] = {
      // GROSS scorer points, same as the leaderboard's own module block — the
      // hint penalty nets the TOTAL exactly once (headline + the −spent tile),
      // never a module's block, matching the board's fold order.
      points: profile?.points ?? 0,
      completed: profile?.patched ?? 0,
      lastActivityAt: profile?.updatedAt ?? null,
      detail: { kind: "secure-development", apps: input.appsRecord },
    };
  }
  const quiz = input.quiz?.total;
  if (quiz && quiz.answered > 0) {
    blocks.quiz = {
      points: quiz.points,
      completed: quiz.answered,
      lastActivityAt: quiz.lastAt,
      detail: {
        kind: "quiz",
        answered: quiz.answered,
        total: Math.max(input.quiz!.questions.length, quiz.answered),
        points: quiz.points,
      },
    };
  }
  const classic = input.classic?.total;
  if (classic && classic.solved > 0) {
    blocks.classic = {
      points: classic.points,
      completed: classic.solved,
      lastActivityAt: classic.lastAt,
      detail: {
        kind: "classic",
        solved: classic.solved,
        total: Math.max(input.classic!.challenges.length, classic.solved),
        points: classic.points,
      },
    };
  }
  const ai = input.ai?.total;
  if (ai && ai.solved > 0) {
    blocks.ai = {
      points: ai.points,
      completed: ai.solved,
      lastActivityAt: ai.lastAt,
      detail: {
        kind: "ai",
        solved: ai.solved,
        total: Math.max(input.ai!.challenges.length, ai.solved),
        points: ai.points,
      },
    };
  }
  return blocks;
}

export type ModuleRow = { done: number; total: number; unit: string; earned: number; max: number };

/** One module's row numbers: its own unit word, its clamped done/total pair,
 *  and its earned/available points.
 *
 *  Exhaustive switch, closed with a `never` guard — this was once an
 *  if/if/unconditional-return, which silently rendered any new module's block
 *  with secure-development's numbers and no compiler complaint. */
/** A denominator that can never be smaller than its own numerator.
 *
 *  The two halves of a progress row come from different places: the numerator
 *  from the contestant's SOLVE RECORDS, which survive a challenge being deleted
 *  (the delete dialog promises exactly that — "points already banked for it stay
 *  on the leaderboard"), and the denominator from the LIVE CATALOGUE, which no
 *  longer contains it. Every deleted-but-solved challenge splits them, and the
 *  row renders "5 / 5 cleared, 870 / 850 pts" with a bar filled past its own end
 *  (issue #330).
 *
 *  Widening the denominator to the union is the option that keeps a
 *  contestant's history visible — the points are genuinely banked and the
 *  leaderboard genuinely counts them — rather than hiding solves that no longer
 *  have a live challenge behind them. secure-development's `total` has clamped
 *  this way since the "8 / 0 patched" fix; this is the same rule applied to
 *  both halves of every module's row. */
function atLeast(total: number, done: number): number {
  return Math.max(total, done);
}

export function moduleRow(progress: ModuleProgress, input: ProfileModuleInput): ModuleRow {
  const detail = progress.detail;
  switch (detail.kind) {
    case "quiz":
      return {
        done: detail.answered,
        total: atLeast(detail.total, detail.answered),
        unit: moduleUnit("quiz"),
        earned: progress.points,
        max: atLeast(input.quiz?.maxPoints ?? 0, progress.points),
      };
    case "classic":
      return {
        done: detail.solved,
        total: atLeast(detail.total, detail.solved),
        unit: moduleUnit("classic"),
        earned: progress.points,
        max: atLeast(input.classic?.maxPoints ?? 0, progress.points),
      };
    case "ai":
      return {
        done: detail.solved,
        total: atLeast(detail.total, detail.solved),
        unit: moduleUnit("ai"),
        earned: progress.points,
        max: atLeast(input.ai?.maxPoints ?? 0, progress.points),
      };
    case "secure-development":
      // `profile.maxPoints` is the sum of the targets' own ceilings (see
      // lambda/mock getUser) — it used to arrive as a hardcoded 0 from the
      // live source, which is what rendered "8 / 0 pts" here.
      return {
        done: progress.completed,
        // Clamped like every other denominator here: a target removed from
        // the event shrinks the catalogue while the banked patch count stays,
        // and "8 / 0 patched" is the same nonsense this PR set out to end.
        total: atLeast(input.challengeCount, progress.completed),
        unit: moduleUnit("secure-development"),
        earned: progress.points,
        // Clamped for the same reason as the count above: dropping a target
        // from the event shrinks the ceiling while its banked points stay.
        max: atLeast(input.profile?.maxPoints ?? 0, progress.points),
      };
    default: {
      const unhandled: never = detail;
      return unhandled;
    }
  }
}

/** Per-item rows for a module's expanded list: which questions are answered,
 *  which flags are solved. Classic groups by the category an organizer
 *  authored (Web, Crypto…); quiz and ai have no grouping of their own and
 *  render one flat bucket. secure-development has its own per-target rows via
 *  AppBreakdown and returns nothing here. */
export function moduleItemsFor(id: ModuleId, input: ProfileModuleInput): { items: ProgressItem[]; doneWord: string } | null {
  if (id === "quiz" && input.quiz && input.quiz.questions.length > 0) {
    const { questions, viewer } = input.quiz;
    return {
      doneWord: "answered",
      items: questions.map((qn) => {
        const done = Boolean(viewer.answered[qn.id]);
        return {
          key: qn.id,
          name: qn.prompt,
          points: viewer.answered[qn.id]?.points ?? qn.points,
          done,
          status: done ? "Answered" : "Open",
          tone: done ? "done" : "open",
        };
      }),
    };
  }
  if (id === "classic" && input.classic && input.classic.challenges.length > 0) {
    const { challenges, viewer } = input.classic;
    return {
      doneWord: "solved",
      items: challenges.map((c) => {
        const done = Boolean(viewer.solved[c.id]);
        return {
          key: c.id,
          name: c.title,
          points: viewer.solved[c.id]?.points ?? c.points,
          group: c.category,
          done,
          status: done ? "Solved" : "Open",
          tone: done ? "done" : "open",
        };
      }),
    };
  }
  if (id === "ai" && input.ai && input.ai.challenges.length > 0) {
    const { challenges, viewer } = input.ai;
    return {
      doneWord: "cleared",
      items: challenges.map((c) => {
        const done = Boolean(viewer.solved[c.id]);
        return {
          key: c.id,
          name: c.title,
          points: viewer.solved[c.id]?.points ?? c.points,
          done,
          status: done ? "Cleared" : "Open",
          tone: done ? "done" : "open",
        };
      }),
    };
  }
  return null;
}

/** What is still winnable, per ENABLED module rather than per module already
 *  played: the contestant who has not opened Classic yet is exactly the one
 *  who needs telling that most of the board's points are sitting in it. */
export function remainingFor(modules: readonly ResolvedModule[], input: ProfileModuleInput): RemainingModule[] {
  const pairs: Partial<Record<ModuleId, { earned: number; max: number }>> = {
    "secure-development": input.secureDev
      ? { earned: input.profile?.points ?? 0, max: input.profile?.maxPoints ?? 0 }
      : undefined,
    quiz: input.quiz ? { earned: input.quiz.total?.points ?? 0, max: input.quiz.maxPoints } : undefined,
    classic: input.classic ? { earned: input.classic.total?.points ?? 0, max: input.classic.maxPoints } : undefined,
    ai: input.ai ? { earned: input.ai.total?.points ?? 0, max: input.ai.maxPoints } : undefined,
  };
  return modules
    .map((m) => ({ title: m.title, ...pairs[m.id] }))
    .filter((m): m is RemainingModule => m.earned != null && m.max != null);
}
