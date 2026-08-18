import "server-only";
import { isModuleEnabled } from "@/lib/modules";
import { getQuizTotals, getTeamQuizTotalsBatch, listQuestions, type QuizTotal } from "@/lib/quiz-store";
import { rankByStanding } from "./rank";
import type { AppProgress, LeaderboardData, LeaderboardEntry, ModuleProgress, TeamStanding } from "./types";
import type { AppId } from "@/lib/apps";
import type { ModuleId } from "@/lib/modules";

/**
 * Builds each contestant row's per-module breakdown and re-ranks on the
 * combined result.
 *
 * The source's `points` already holds secure-development's score (it comes from
 * the scorer), so that module is ATTRIBUTED rather than added — adding it would
 * double count. The quiz scores app-side, so its points are NOT already inside
 * `entry.points` — they are ADDED on top (`entry.points += quizPoints`).
 *
 * Runs AFTER withHintPenalties (see the pipeline comment in
 * `app/(site)/leaderboard/page.tsx`) so the attributed figure is the row's net,
 * post-penalty score — otherwise an expanded row shows a module total larger
 * than the header it sits under. This re-ranks UNCONDITIONALLY, so being last
 * in the pipeline is what makes the final order deterministic: withHintPenalties
 * returns early when hints are disabled and can't be relied on to produce it.
 *
 * Individuals read the quiz's aggregate counters (`getQuizTotals` — two
 * `HGETALL`s, cost independent of board size, mirroring `getHintPenalties`).
 * Teams CANNOT: a team's quiz points are the UNION of questions its members
 * answered correctly (spec D6), and the aggregates have no memory of WHICH
 * questions contributed to a login's total, so summing them would double
 * count any question two teammates both answered. Teams are handled by
 * `getTeamQuizTotalsBatch`, which reads every member's answer hash directly
 * — all of them in ONE pipeline for the whole board — and dedupes per team;
 * see its doc comment in quiz-store.ts.
 *
 * A contestant with quiz points but no scored submission yet has no row to
 * attribute: this maps over `data.entries` and never invents one, and both
 * real sources only carry logins with at least one scored PR. Their points
 * are real and visible on `/profile`; they join the board with their first
 * scored submission. Documented in docs/operations.md's Quiz section.
 *
 * Team quiz points are only added when `data.capabilities.teams` is already
 * true, i.e. the source (mock/lambda) already provides deduped team rows with
 * real per-flag points — the same gate `secureDev` uses for
 * `capabilities.apps`. On the upstash path `capabilities.teams` is false here
 * (team membership hasn't been overlaid yet — `withTeamStandings` runs
 * AFTER this in the real pipeline and replaces `data.teams` wholesale with
 * membership-only, zero-point rows), so there is nothing yet to attach a
 * quiz total to; team quiz points on that path arrive whenever
 * `withTeamStandings` itself grows real per-flag dedup.
 */
export async function withModuleContributions(data: LeaderboardData): Promise<LeaderboardData> {
  const secureDev = isModuleEnabled("secure-development") && data.capabilities.apps;
  const quizEnabled = isModuleEnabled("quiz");

  let quizTotals = new Map<string, QuizTotal>();
  let quizTotalQuestions = 0;
  if (quizEnabled) {
    // Settled INDEPENDENTLY, not under one shared `try`/`Promise.all`. The
    // two reads carry very different weight: `getQuizTotals` supplies the
    // POINTS (which change the board's totals and its ranking), while
    // `listQuestions` supplies only the "answered / total" DENOMINATOR. Under
    // a shared catch, a blip on the cosmetic read silently deleted everyone's
    // quiz points and re-ranked the board on wrong totals — while /profile,
    // which fetches totals on its own, still showed the real number. A failed
    // `listQuestions` must degrade to a missing denominator (clamped below),
    // never to lost points.
    const [totalsResult, questionsResult] = await Promise.allSettled([getQuizTotals(), listQuestions()]);
    if (totalsResult.status === "fulfilled") {
      quizTotals = totalsResult.value;
    } else {
      // Degrade to the quiz-less view rather than failing the whole board —
      // same pattern as withHintPenalties/withTeamStandings.
      console.error("quiz totals unavailable for leaderboard:", totalsResult.reason);
    }
    if (questionsResult.status === "fulfilled") {
      quizTotalQuestions = questionsResult.value.length;
    } else {
      console.error("quiz question list unavailable for leaderboard denominator:", questionsResult.reason);
    }
  }

  const entries = rankByStanding(
    data.entries.map((entry) => attributeEntry(entry, secureDev, quizTotals, quizTotalQuestions)),
  );

  let teams = data.teams;
  if (quizEnabled && data.capabilities.teams && data.teams.length > 0) {
    try {
      teams = await attributeTeams(data.teams, quizTotalQuestions);
    } catch (err) {
      console.error("quiz team totals unavailable for leaderboard:", err);
    }
  }

  return { ...data, entries, teams };
}

function secureDevelopmentModule(
  points: number,
  patched: number,
  lastActivityAt: string | null,
  apps: Partial<Record<AppId, AppProgress>>,
): ModuleProgress {
  return { points, completed: patched, lastActivityAt, detail: { kind: "secure-development", apps } };
}

/** `total` is CLAMPED to at least `answered` so the "answered / total"
 *  denominator can never fall below its own numerator. Two real ways it
 *  otherwise does: (1) a deleted question — `deleteQuestion` retires the
 *  question but deliberately leaves banked points and the aggregate
 *  `answered` counter alone (see its doc comment), so the list shrinks while
 *  the count doesn't, rendering "1 / 0 answered"; (2) a failed
 *  `listQuestions` above, which degrades the denominator to 0 while the
 *  points and answered counts survive intact. Clamping shows "1 / 1" —
 *  imprecise, but never nonsense. */
function quizModule(total: QuizTotal, totalQuestions: number): ModuleProgress {
  return {
    points: total.points,
    completed: total.answered,
    lastActivityAt: total.lastAt,
    detail: {
      kind: "quiz",
      answered: total.answered,
      total: Math.max(totalQuestions, total.answered),
      points: total.points,
    },
  };
}

function attributeEntry(
  entry: LeaderboardEntry,
  secureDev: boolean,
  quizTotals: Map<string, QuizTotal>,
  quizTotalQuestions: number,
): LeaderboardEntry {
  const modules: Partial<Record<ModuleId, ModuleProgress>> = {};
  let points = entry.points;

  if (secureDev && Object.keys(entry.apps).length > 0) {
    modules["secure-development"] = secureDevelopmentModule(
      entry.points,
      entry.patched,
      entry.lastSolveAt ?? null,
      entry.apps,
    );
  }

  const quizTotal = quizTotals.get(entry.login);
  if (quizTotal && quizTotal.answered > 0) {
    modules["quiz"] = quizModule(quizTotal, quizTotalQuestions);
    points += quizTotal.points;
  }

  return { ...entry, points, modules };
}

/** Adds each team's deduped quiz total to its points and stamps a `quiz`
 *  module block, then re-ranks the teams on the new totals — mirroring
 *  `withHintPenalties`'s team sort (points descending, original position
 *  breaking ties) since this is the last step to touch team points before
 *  `withTeamStandings`'s no-op pass-through on this path. */
async function attributeTeams(teams: TeamStanding[], quizTotalQuestions: number): Promise<TeamStanding[]> {
  // ONE pipeline for the whole board, not one per team: `/leaderboard` is
  // dynamic and fetched `no-store`, so the per-team form billed a 25-team
  // event 25 Upstash REST round trips on every page view. The dedupe rule is
  // unchanged — `getTeamQuizTotalsBatch` runs the same union-by-question fold
  // per team, it just fetches every member's answers in one go.
  const totals = await getTeamQuizTotalsBatch(teams.map((team) => team.members));

  return teams
    .map((team, i) => {
      const total = totals[i];
      if (total.answered === 0) return { i, team };
      return {
        i,
        team: {
          ...team,
          points: team.points + total.points,
          modules: { ...(team.modules ?? {}), quiz: quizModule(total, quizTotalQuestions) },
        },
      };
    })
    .sort((a, b) => b.team.points - a.team.points || a.i - b.i)
    .map(({ team }, i) => ({ ...team, rank: i + 1 }));
}
