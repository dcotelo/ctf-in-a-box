import "server-only";
import {
  getClassicTotals,
  getTeamClassicTotalsBatch,
  listChallenges,
  type ClassicTotal,
} from "@/lib/classic-store";
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
 * double count. The quiz and classic modules score APP-SIDE: the scorer never
 * sees a quiz answer or a captured flag, so their points are NOT already inside
 * `entry.points` — they are ADDED on top (`entry.points += quizPoints +
 * classicPoints`). The two verbs are not interchangeable in either direction:
 * attributing an app-side module would show zero, adding secure-development's
 * would double count.
 *
 * Runs AFTER withHintPenalties (see the pipeline comment in
 * `app/(site)/leaderboard/page.tsx`) so the attributed figure is the row's net,
 * post-penalty score — otherwise an expanded row shows a module total larger
 * than the header it sits under. This re-ranks UNCONDITIONALLY, so being last
 * in the pipeline is what makes the final order deterministic: withHintPenalties
 * returns early when hints are disabled and can't be relied on to produce it.
 *
 * Individuals read each app-side module's aggregate counters (`getQuizTotals`
 * / `getClassicTotals` — two `HGETALL`s each, cost independent of board size,
 * mirroring `getHintPenalties`). Teams CANNOT: a team's total is the UNION of
 * the questions its members answered correctly (spec D6) / the challenges they
 * solved, and the aggregates have no memory of WHICH items contributed to a
 * login's total, so summing them would double count anything two teammates
 * both hold. Teams are handled by `getTeamQuizTotalsBatch` /
 * `getTeamClassicTotalsBatch`, which read every member's item hash directly —
 * all of them in ONE pipeline for the whole board — and dedupe per team
 * through the shared fold in `team-fold.ts`; see its doc comment.
 *
 * The board's login set is the UNION of the source's logins and the logins
 * holding module points, so a contestant with quiz or classic points but no
 * scored submission — every contestant on a quiz-only or classic-only event,
 * where the source is `emptySource` and carries no rows at all — gets a row
 * CREATED for them here rather than being invisible until their first scored
 * PR. The union is taken case-insensitively (the scorer records the PR
 * author's login, the app-side modules the session's; a case disagreement must
 * not split one contestant into two rows), and a created row is the only kind
 * with no scoring entry behind it — so there is nothing on it to double count,
 * and every scorer-supplied field (`patched`/`failed`/`total`/`apps`) stays
 * zero-valued on it. A login holding BOTH quiz and classic points gets ONE
 * created row carrying both blocks, never one row per module.
 *
 * Rows are only ever created from totals actually read: a failed
 * `getQuizTotals`/`getClassicTotals` degrades to that module's absence from
 * the board, never to invented or zero-point rows.
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
 * Team quiz/classic points are added HERE only when `data.capabilities.teams`
 * is already true, i.e. the source (mock/lambda) already provides deduped team
 * rows with real per-flag points — the same gate `secureDev` uses for
 * `capabilities.apps`. On the upstash and empty paths `capabilities.teams` is
 * false at this point (team membership hasn't been overlaid yet), so there is
 * nothing here to attach a team total to: `withTeamStandings` runs AFTER this
 * and SYNTHESISES the team rows from membership, then calls
 * `withTeamQuizPoints`/`withTeamClassicPoints` below on the rows it just
 * created. Same fold, same dedupe, applied where the rows actually exist
 * rather than by moving a pipeline stage.
 */
export async function withModuleContributions(data: LeaderboardData): Promise<LeaderboardData> {
  const secureDev = isModuleEnabled("secure-development") && data.capabilities.apps;
  const quizEnabled = isModuleEnabled("quiz");
  const classicEnabled = isModuleEnabled("classic");

  // Both modules' reads are KICKED OFF before either is awaited, so a
  // two-module event overlaps them instead of paying for them back to back —
  // they hit disjoint key spaces and nothing orders one against the other.
  // Each module still settles its OWN two reads independently; see below.
  const quizReads = quizEnabled ? Promise.allSettled([getQuizTotals(), listQuestions()]) : null;
  const classicReads = classicEnabled ? Promise.allSettled([getClassicTotals(), listChallenges()]) : null;

  let quizTotals = new Map<string, QuizTotal>();
  let quizTotalQuestions = 0;
  if (quizReads) {
    // Settled INDEPENDENTLY, not under one shared `try`/`Promise.all`. The
    // two reads carry very different weight: `getQuizTotals` supplies the
    // POINTS (which change the board's totals and its ranking), while
    // `listQuestions` supplies only the "answered / total" DENOMINATOR. Under
    // a shared catch, a blip on the cosmetic read silently deleted everyone's
    // quiz points and re-ranked the board on wrong totals — while /profile,
    // which fetches totals on its own, still showed the real number. A failed
    // `listQuestions` must degrade to a missing denominator (clamped below),
    // never to lost points.
    const [totalsResult, questionsResult] = await quizReads;
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

  let classicTotals = new Map<string, ClassicTotal>();
  let classicTotalChallenges = 0;
  if (classicReads) {
    // Settled INDEPENDENTLY for exactly the reason spelled out above the quiz
    // pair, which this mirrors: `getClassicTotals` carries the POINTS and the
    // ranking they drive, `listChallenges` only the "solved / total"
    // DENOMINATOR. Never collapse these two into one shared try/Promise.all —
    // that is the shape that once deleted everyone's points on a blip in a
    // purely cosmetic read.
    const [totalsResult, challengesResult] = await classicReads;
    if (totalsResult.status === "fulfilled") {
      classicTotals = totalsResult.value;
    } else {
      console.error("classic totals unavailable for leaderboard:", totalsResult.reason);
    }
    if (challengesResult.status === "fulfilled") {
      classicTotalChallenges = challengesResult.value.length;
    } else {
      console.error("classic challenge list unavailable for leaderboard denominator:", challengesResult.reason);
    }
  }

  // Logins are matched case-insensitively throughout (see the doc comment).
  // Two keys in a totals map colliding on case cannot happen — a login is
  // unique case-insensitively on GitHub and every writer stores the one the
  // session reports — but the folds below are what make the lookup and the
  // union agree on a single rule either way.
  const quizByLogin = new Map<string, QuizTotal>();
  for (const [login, total] of quizTotals) quizByLogin.set(login.toLowerCase(), total);
  const classicByLogin = new Map<string, ClassicTotal>();
  for (const [login, total] of classicTotals) classicByLogin.set(login.toLowerCase(), total);

  const overlay: Overlay = { quizByLogin, quizTotalQuestions, classicByLogin, classicTotalChallenges };

  const entries = rankByStanding([
    ...data.entries.map((entry) => attributeEntry(entry, secureDev, overlay)),
    ...createdEntries(data.entries, quizTotals, classicTotals, quizTotalQuestions, classicTotalChallenges),
  ]);

  // Each enabled module is applied in turn, and each re-ranks on the running
  // totals — so a team's final order reflects BOTH modules' points, and a
  // module whose batch read fails leaves the rows it would have touched
  // exactly as the previous step left them (missing points, never wrong ones).
  let teams = data.teams;
  if (data.capabilities.teams && data.teams.length > 0) {
    if (quizEnabled) {
      try {
        teams = attributeTeams(teams, quizContributions(await teamQuizTotals(teams), quizTotalQuestions));
      } catch (err) {
        console.error("quiz team totals unavailable for leaderboard:", err);
      }
    }
    if (classicEnabled) {
      try {
        teams = attributeTeams(teams, classicContributions(await teamClassicTotals(teams), classicTotalChallenges));
      } catch (err) {
        console.error("classic team totals unavailable for leaderboard:", err);
      }
    }
  }

  return { ...data, entries, teams };
}

/** The app-side module totals for one render, threaded through the per-entry
 *  helpers below. Both `*ByLogin` maps are keyed by LOWERCASED login — see the
 *  union rule in the doc comment. The two counts are the modules' raw item
 *  totals; the clamp against a row's own numerator happens per row, in
 *  `quizModule`/`classicModule`. */
type Overlay = {
  quizByLogin: Map<string, QuizTotal>;
  quizTotalQuestions: number;
  classicByLogin: Map<string, ClassicTotal>;
  classicTotalChallenges: number;
};

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
    quizContributions(totalsResult.value, questionsResult.status === "fulfilled" ? questionsResult.value.length : 0),
  );
}

/**
 * classic's exact counterpart to `withTeamQuizPoints` above — same contract,
 * same degradation, same single owner for the union rule. Read that function's
 * doc comment; everything in it applies here with "challenge solved" in place
 * of "question answered".
 *
 * Kept as its OWN function rather than folded into one multi-module helper so
 * each module's enablement, its two reads, and its failure handling stay
 * independent: a classic-only event must never pay for a quiz read, and a
 * classic outage must never cost a team its quiz points.
 */
export async function withTeamClassicPoints(teams: TeamStanding[]): Promise<TeamStanding[]> {
  if (!isModuleEnabled("classic") || teams.length === 0) return teams;

  // Settled INDEPENDENTLY — see the note in `withModuleContributions`: the
  // totals carry POINTS (and with them the team board's order), the challenge
  // list only the DENOMINATOR.
  const [totalsResult, challengesResult] = await Promise.allSettled([teamClassicTotals(teams), listChallenges()]);

  if (totalsResult.status !== "fulfilled") {
    console.error("classic team totals unavailable for leaderboard:", totalsResult.reason);
    return teams;
  }
  if (challengesResult.status !== "fulfilled") {
    console.error("classic challenge list unavailable for leaderboard denominator:", challengesResult.reason);
  }

  return attributeTeams(
    teams,
    classicContributions(
      totalsResult.value,
      challengesResult.status === "fulfilled" ? challengesResult.value.length : 0,
    ),
  );
}

/** ONE pipeline for the whole board, never one call per team — see
 *  `getTeamQuizTotalsBatch`'s doc comment (a per-team form billed a 25-team
 *  event 25 Upstash round trips on every render of a `no-store` page). */
function teamQuizTotals(teams: readonly TeamStanding[]): Promise<QuizTotal[]> {
  return getTeamQuizTotalsBatch(teams.map((team) => team.members));
}

/** classic's counterpart, and ONE pipeline for the whole board for the same
 *  reason — see `getTeamClassicTotalsBatch`'s doc comment. */
function teamClassicTotals(teams: readonly TeamStanding[]): Promise<ClassicTotal[]> {
  return getTeamClassicTotalsBatch(teams.map((team) => team.members));
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

/** classic's counterpart to `quizModule`, clamped for exactly the same two
 *  reasons: (1) `deleteChallenge` retires a challenge but deliberately leaves
 *  banked points and the aggregate `solved` counter alone, so the challenge
 *  list can be SHORTER than a login's solve count and would render "1 / 0
 *  flags"; (2) a failed `listChallenges` degrades the denominator to 0 while
 *  the points and solve counts survive intact. Clamping shows "1 / 1" —
 *  imprecise, but never nonsense. */
function classicModule(total: ClassicTotal, totalChallenges: number): ModuleProgress {
  return {
    points: total.points,
    completed: total.solved,
    lastActivityAt: total.lastAt,
    detail: {
      kind: "classic",
      solved: total.solved,
      total: Math.max(totalChallenges, total.solved),
      points: total.points,
    },
  };
}

/** The rows the board is MISSING: one per login that holds app-side module
 *  points (quiz, classic, or both) and has no entry from the scoring source.
 *  Scored rows come first in the ranked list, so a created row never displaces
 *  one it is fully tied with.
 *
 *  The totals maps are iterated in their ORIGINAL casing (that spelling is all
 *  a created row has to display), while membership is decided on the
 *  lowercased form — a login already on the board keeps its scored row, which
 *  `attributeEntry` has already added the same module points to. Two modules
 *  reporting the same login (in whatever casing) therefore produce exactly ONE
 *  row carrying both blocks and both modules' points, never one row each.
 *
 *  Empty whenever both modules are off or their totals reads failed: either
 *  leaves the corresponding map empty, so this creates nothing without
 *  inspecting those conditions again. */
function createdEntries(
  scored: readonly LeaderboardEntry[],
  quizTotals: Map<string, QuizTotal>,
  classicTotals: Map<string, ClassicTotal>,
  quizTotalQuestions: number,
  classicTotalChallenges: number,
): LeaderboardEntry[] {
  const seen = new Set(scored.map((entry) => entry.login.toLowerCase()));
  // Keyed by lowercased login so the two modules union onto one row; `login`
  // keeps the spelling of whichever module reported it first.
  const pending = new Map<string, { login: string; quiz?: QuizTotal; classic?: ClassicTotal }>();

  // `answered`/`solved` > 0 is the same gate `attributeEntry` uses to stamp a
  // block: a login with no completed item has no module progress to show and
  // must not become a row.
  for (const [login, total] of quizTotals) {
    const key = login.toLowerCase();
    if (seen.has(key) || total.answered <= 0) continue;
    pending.set(key, { ...(pending.get(key) ?? { login }), quiz: total });
  }
  for (const [login, total] of classicTotals) {
    const key = login.toLowerCase();
    if (seen.has(key) || total.solved <= 0) continue;
    pending.set(key, { ...(pending.get(key) ?? { login }), classic: total });
  }

  const created: LeaderboardEntry[] = [];
  for (const { login, quiz, classic } of pending.values()) {
    const modules: Partial<Record<ModuleId, ModuleProgress>> = {};
    if (quiz) modules["quiz"] = quizModule(quiz, quizTotalQuestions);
    if (classic) modules["classic"] = classicModule(classic, classicTotalChallenges);
    // The modules' own activity time is the only honest value for both
    // (neither aggregate read has one to give today, so it is null in
    // practice — see getQuizTotals/getClassicTotals).
    const lastAt = laterOf(quiz?.lastAt ?? null, classic?.lastAt ?? null);
    created.push({
      rank: 0, // stamped by rankByStanding below
      login,
      // Membership is withTeamStandings' to overlay, one step later.
      team: null,
      points: (quiz?.points ?? 0) + (classic?.points ?? 0),
      // Everything the scorer would have supplied. There is no scoring entry
      // behind this row, so these are genuinely zero rather than unknown.
      patched: 0,
      failed: 0,
      total: 0,
      apps: {},
      updatedAt: lastAt,
      lastSolveAt: lastAt,
      modules,
    });
  }

  return created;
}

/** The later of two possibly-null ISO timestamps, or null when both are. */
function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** The `*ByLogin` maps on `overlay` are keyed by LOWERCASED login — see the
 *  folds in `withModuleContributions`.
 *
 *  secure-development is ATTRIBUTED (its points are already inside
 *  `entry.points`); quiz and classic are ADDED. Getting either verb wrong is
 *  silent: attributing an app-side module shows zero, adding the scorer's
 *  doubles it. */
function attributeEntry(entry: LeaderboardEntry, secureDev: boolean, overlay: Overlay): LeaderboardEntry {
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

  const key = entry.login.toLowerCase();

  const quizTotal = overlay.quizByLogin.get(key);
  if (quizTotal && quizTotal.answered > 0) {
    modules["quiz"] = quizModule(quizTotal, overlay.quizTotalQuestions);
    points += quizTotal.points;
  }

  const classicTotal = overlay.classicByLogin.get(key);
  if (classicTotal && classicTotal.solved > 0) {
    modules["classic"] = classicModule(classicTotal, overlay.classicTotalChallenges);
    points += classicTotal.points;
  }

  return { ...entry, points, modules };
}

/** One module's contribution to ONE team, already normalised out of that
 *  module's own vocabulary: `completed` is the gate (nothing completed means
 *  no block and no points) and `progress` the block to stamp. */
type TeamContribution = { points: number; completed: number; progress: ModuleProgress };

/** A whole board's worth of one module's contributions, WITH the module id
 *  they belong under. The id travels with the data rather than as a second
 *  argument to `attributeTeams`, so it is not expressible to stamp one
 *  module's key over another module's numbers — a mistake the previous
 *  `(teams, moduleId, contributions)` signature type-checked happily. Only
 *  the two builders below construct this, and each hard-codes its own id. */
type TeamContributions = { moduleId: ModuleId; contributions: readonly TeamContribution[] };

function quizContributions(totals: readonly QuizTotal[], totalQuestions: number): TeamContributions {
  return {
    moduleId: "quiz",
    contributions: totals.map((t) => ({
      points: t.points,
      completed: t.answered,
      progress: quizModule(t, totalQuestions),
    })),
  };
}

function classicContributions(totals: readonly ClassicTotal[], totalChallenges: number): TeamContributions {
  return {
    moduleId: "classic",
    contributions: totals.map((t) => ({
      points: t.points,
      completed: t.solved,
      progress: classicModule(t, totalChallenges),
    })),
  };
}

/** Adds each team's already-deduped module total (`contributions[i]` belongs
 *  to `teams[i]`) to its points and stamps that module's block, then re-ranks
 *  the teams on the new totals — mirroring `withHintPenalties`'s team sort
 *  (points descending, original position breaking ties). Shared verbatim by
 *  every caller and every module, so a source-provided team row and a
 *  synthesised one are attributed by exactly the same rule.
 *
 *  Applying it once per module is safe to chain: each pass adds only its own
 *  module's points and stamps only its own key, and the sort is stable on the
 *  positions the previous pass produced. */
function attributeTeams(teams: TeamStanding[], { moduleId, contributions }: TeamContributions): TeamStanding[] {
  return teams
    .map((team, i) => {
      const contribution = contributions[i];
      if (!contribution || contribution.completed === 0) return { i, team };
      return {
        i,
        team: {
          ...team,
          points: team.points + contribution.points,
          modules: { ...(team.modules ?? {}), [moduleId]: contribution.progress },
        },
      };
    })
    .sort((a, b) => b.team.points - a.team.points || a.i - b.i)
    .map(({ team }, i) => ({ ...team, rank: i + 1 }));
}
