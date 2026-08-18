import "server-only";
import { isModuleEnabled } from "@/lib/modules";
import { getQuizTotals, getTeamQuizTotals, listQuestions, type QuizTotal } from "@/lib/quiz-store";
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
 * `getTeamQuizTotals`, which reads each member's answer hash directly — see
 * its doc comment in quiz-store.ts.
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
    try {
      const [totals, questions] = await Promise.all([getQuizTotals(), listQuestions()]);
      quizTotals = totals;
      quizTotalQuestions = questions.length;
    } catch (err) {
      // Degrade to the quiz-less view rather than failing the whole board —
      // same pattern as withHintPenalties/withTeamStandings.
      console.error("quiz totals unavailable for leaderboard:", err);
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

function quizModule(total: QuizTotal, totalQuestions: number): ModuleProgress {
  return {
    points: total.points,
    completed: total.answered,
    lastActivityAt: total.lastAt,
    detail: { kind: "quiz", answered: total.answered, total: totalQuestions, points: total.points },
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
  const totals = await Promise.all(teams.map((team) => getTeamQuizTotals(team.members)));

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
