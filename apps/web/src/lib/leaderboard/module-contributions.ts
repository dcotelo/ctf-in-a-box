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
 * The board's login set is the UNION of the source's logins and the logins
 * holding module points, so a contestant with quiz points but no scored
 * submission — every contestant on a quiz-only event, where the source is
 * `emptySource` and carries no rows at all — gets a row CREATED for them here
 * rather than being invisible until their first scored PR. The union is taken
 * case-insensitively (the scorer records the PR author's login, the quiz the
 * session's; a case disagreement must not split one contestant into two rows),
 * and a created row is the only kind with no scoring entry behind it — so
 * there is nothing on it to double count, and every scorer-supplied field
 * (`patched`/`failed`/`total`/`apps`) stays zero-valued on it.
 *
 * Rows are only ever created from totals actually read: a failed `getQuizTotals`
 * degrades to the quiz-less board, never to invented or zero-point rows.
 *
 * Hint penalties are applied by `withHintPenalties`, which runs BEFORE this and
 * so only ever sees the source's rows — a created row is never passed through
 * it. This has NO NUMERIC EFFECT and is not a gap: the penalty is subtracted
 * from SCORER points and floored at 0 (`Math.max(0, points - penalty)`), and a
 * created row has 0 scorer points, so the deduction would be
 * `max(0, 0 - penalty) === 0` either way — quiz points are ADDED after it in
 * both paths, so the same login lands on the same total whether or not it has
 * a scored row. The only difference is cosmetic: a created row shows no
 * "−N hints" transparency chip. It is also all but unreachable, since
 * `hintGate` requires solves that would have put the login on the scored
 * source in the first place (unless an organizer sets `hintsMinSolves: 0`).
 * The pipeline order is load-bearing and stays as it is.
 *
 * Team quiz points are added HERE only when `data.capabilities.teams` is
 * already true, i.e. the source (mock/lambda) already provides deduped team
 * rows with real per-flag points — the same gate `secureDev` uses for
 * `capabilities.apps`. On the upstash and empty paths `capabilities.teams` is
 * false at this point (team membership hasn't been overlaid yet), so there is
 * nothing here to attach a quiz total to: `withTeamStandings` runs AFTER this
 * and SYNTHESISES the team rows from membership, then calls
 * `withTeamQuizPoints` below on the rows it just created. Same fold, same
 * dedupe, applied where the rows actually exist rather than by moving a
 * pipeline stage.
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

  // Logins are matched case-insensitively throughout (see the doc comment).
  // Two keys in `quizTotals` colliding on case cannot happen — a login is
  // unique case-insensitively on GitHub and every writer stores the one the
  // session reports — but the fold below is what makes the lookup and the
  // union agree on a single rule either way.
  const quizByLogin = new Map<string, QuizTotal>();
  for (const [login, total] of quizTotals) quizByLogin.set(login.toLowerCase(), total);

  const entries = rankByStanding([
    ...data.entries.map((entry) => attributeEntry(entry, secureDev, quizByLogin, quizTotalQuestions)),
    ...createdEntries(data.entries, quizTotals, quizTotalQuestions),
  ]);

  let teams = data.teams;
  if (quizEnabled && data.capabilities.teams && data.teams.length > 0) {
    try {
      teams = attributeTeams(data.teams, await teamQuizTotals(data.teams), quizTotalQuestions);
    } catch (err) {
      console.error("quiz team totals unavailable for leaderboard:", err);
    }
  }

  return { ...data, entries, teams };
}

/**
 * The team half of this overlay, for team rows that did NOT exist when
 * `withModuleContributions` ran: the membership-only rows `withTeamStandings`
 * synthesises on a source with no team concept of its own (upstash, and the
 * empty source a quiz-only event uses). Those rows arrive with `points: 0`
 * because there is no per-flag data to dedupe secure-development points from
 * — but their quiz points ARE dedupable, and leaving them at zero put every
 * team on a quiz-only event's DEFAULT board (teams, whenever teams exist) on
 * an all-zero scoreboard while the individual view showed real points.
 *
 * Lives here, and is CALLED by `withTeamStandings`, so that all quiz
 * attribution keeps one owner and one dedupe rule — the union-by-question fold
 * in `getTeamQuizTotalsBatch`, never a sum of member aggregates. Calling it
 * from there rather than moving a pipeline stage is deliberate: the
 * `withHintPenalties → withModuleContributions → withTeamStandings` order is
 * load-bearing (see the page's pipeline comment), and these rows simply do not
 * exist until the last of those runs.
 *
 * Degrades like every other overlay: a failed totals read returns the teams
 * untouched (their quiz points are missing, never wrong), and a failed
 * question list costs only the "answered / total" denominator — the same split
 * that `withModuleContributions` keeps for individuals, and for the same
 * reason.
 */
export async function withTeamQuizPoints(teams: TeamStanding[]): Promise<TeamStanding[]> {
  if (!isModuleEnabled("quiz") || teams.length === 0) return teams;

  // Settled INDEPENDENTLY — see the note in `withModuleContributions`: the
  // totals carry POINTS (and with them the team board's order), the question
  // list only the DENOMINATOR.
  const [totalsResult, questionsResult] = await Promise.allSettled([teamQuizTotals(teams), listQuestions()]);

  if (totalsResult.status !== "fulfilled") {
    console.error("quiz team totals unavailable for leaderboard:", totalsResult.reason);
    return teams;
  }
  if (questionsResult.status !== "fulfilled") {
    console.error("quiz question list unavailable for leaderboard denominator:", questionsResult.reason);
  }

  return attributeTeams(
    teams,
    totalsResult.value,
    questionsResult.status === "fulfilled" ? questionsResult.value.length : 0,
  );
}

/** ONE pipeline for the whole board, never one call per team — see
 *  `getTeamQuizTotalsBatch`'s doc comment (a per-team form billed a 25-team
 *  event 25 Upstash round trips on every render of a `no-store` page). */
function teamQuizTotals(teams: readonly TeamStanding[]): Promise<QuizTotal[]> {
  return getTeamQuizTotalsBatch(teams.map((team) => team.members));
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

/** The rows the board is MISSING: one per login that holds quiz points and has
 *  no entry from the scoring source. Scored rows come first in the ranked list,
 *  so a created row never displaces one it is fully tied with.
 *
 *  `quizTotals` is iterated in its original casing (that spelling is all a
 *  created row has to display), while membership is decided on the lowercased
 *  form — a login already on the board keeps its scored row, which
 *  `attributeEntry` has already added the same quiz points to. Empty whenever
 *  the quiz module is off or its totals read failed: both leave `quizTotals`
 *  empty, so this creates nothing without inspecting either condition again. */
function createdEntries(
  scored: readonly LeaderboardEntry[],
  quizTotals: Map<string, QuizTotal>,
  quizTotalQuestions: number,
): LeaderboardEntry[] {
  const seen = new Set(scored.map((entry) => entry.login.toLowerCase()));
  const created: LeaderboardEntry[] = [];

  for (const [login, total] of quizTotals) {
    const key = login.toLowerCase();
    // `answered > 0` is the same gate `attributeEntry` uses to stamp a quiz
    // block: a login with no correct answer has no module progress to show and
    // must not become a row.
    if (seen.has(key) || total.answered <= 0) continue;
    seen.add(key);
    created.push({
      rank: 0, // stamped by rankByStanding below
      login,
      // Membership is withTeamStandings' to overlay, one step later.
      team: null,
      points: total.points,
      // Everything the scorer would have supplied. There is no scoring entry
      // behind this row, so these are genuinely zero rather than unknown.
      patched: 0,
      failed: 0,
      total: 0,
      apps: {},
      // The module's own activity time is the only honest value for both
      // (`getQuizTotals` has none to give today, so it is null in practice).
      updatedAt: total.lastAt,
      lastSolveAt: total.lastAt,
      modules: { quiz: quizModule(total, quizTotalQuestions) },
    });
  }

  return created;
}

/** `quizTotals` here is keyed by LOWERCASED login — see the fold in
 *  `withModuleContributions`. */
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

  const quizTotal = quizTotals.get(entry.login.toLowerCase());
  if (quizTotal && quizTotal.answered > 0) {
    modules["quiz"] = quizModule(quizTotal, quizTotalQuestions);
    points += quizTotal.points;
  }

  return { ...entry, points, modules };
}

/** Adds each team's already-deduped quiz total (`totals[i]` belongs to
 *  `teams[i]`) to its points and stamps a `quiz` module block, then re-ranks
 *  the teams on the new totals — mirroring `withHintPenalties`'s team sort
 *  (points descending, original position breaking ties). Shared verbatim by
 *  both callers, so a source-provided team row and a synthesised one are
 *  attributed by exactly the same rule; it is the last step to touch team
 *  points either way. */
function attributeTeams(
  teams: TeamStanding[],
  totals: readonly QuizTotal[],
  quizTotalQuestions: number,
): TeamStanding[] {
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
