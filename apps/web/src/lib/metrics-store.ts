import "server-only";
import { upstashPipeline } from "@/lib/upstash";
import { userKey, HINTS_SPENT_KEY } from "@/lib/team-keys";
import { QUIZ_POINTS_KEY, quizAnswersKey, quizAttemptsKey } from "@/lib/quiz-keys";
import { CLASSIC_POINTS_KEY, classicAttemptsKey, classicSolvesKey } from "@/lib/classic-keys";
import { listTeams } from "@/lib/team-store";

/**
 * Event engagement metrics (issue #169), computed ENTIRELY from data the box
 * already stores.
 *
 * There is no collection step and no new write path. Every number below is a
 * read over keys the modules already maintain: quiz answers and classic solves
 * carry `{points, at}` per item per login, Secure Development solves are
 * timestamped in `ctf:solves:<target>`, attempts are counted per login, and
 * `firstTeamAt` (ADR 49) supplies the funnel's conversion moment.
 *
 * WHY NOT COLLECT FROM FORKS. A fork could report far more — pages opened,
 * time on a challenge, when someone gave up. It cannot report it *credibly*.
 * Authenticating a fork means a credential every contestant can read, so any
 * ingest endpoint is forgeable by every contestant, and engagement numbers
 * that a participant can inflate are worse than numbers that are merely
 * incomplete. ADR 46's rule for `/api/public/scoring` is the read-side of the
 * same boundary: that endpoint is read-only and policy-only, and metrics does
 * not touch it in either direction.
 *
 * COST. This is O(contestants) in round trips, batched. It is an on-demand
 * admin read — one per click, not one per page view — and deliberately not
 * cached, because an organizer refreshing it mid-event wants the current
 * number, not one from a minute ago.
 */

/** Solves-over-time bucket width. Ten minutes is the resolution at which a
 *  room going quiet is visible without the series becoming noise. */
const BUCKET_MS = 10 * 60 * 1000;

/** Hard ceiling on contestants folded in one pass. An event this size is far
 *  beyond what the kit targets; the cap exists so a runaway key space cannot
 *  turn an admin click into an unbounded read. Reported in `caveats` when it
 *  bites, because a silently truncated metric reads as a complete one. */
const MAX_CONTESTANTS = 2000;

/** Commands per pipeline round trip. */
const BATCH = 200;

export type ChallengeStat = {
  module: "quiz" | "classic";
  id: string;
  /** Distinct contestants who earned it. */
  solves: number;
  /** Total submissions against it, successful or not. */
  attempts: number;
  /** solves / distinct attempters, or null when nobody tried it. */
  solveRate: number | null;
  /** Mean attempts taken by the contestants who did earn it. The real
   *  difficulty signal — a challenge solved by everyone on the fourth try is
   *  harder than its solve rate suggests. */
  avgAttemptsToSolve: number | null;
};

export type EventMetrics = {
  generatedAt: string;
  funnel: {
    /** Distinct logins on a team right now. */
    onATeam: number;
    /** Distinct logins that have EVER been on a team — the conversion count,
     *  which survives leaving and switching (ADR 49). */
    everOnATeam: number;
    /** Made at least one submission in any module. */
    attempted: number;
    /** Earned at least one point-bearing item in any module. */
    scored: number;
    /** Attempted and never scored — the contestants who got stuck. */
    stuck: number;
  };
  challenges: ChallengeStat[];
  /** Solves per 10-minute bucket, ascending. Quiz + classic only; see caveats. */
  timeline: { at: string; solves: number }[];
  teams: { slug: string; name: string; size: number; points: number }[];
  modules: { quiz: number; classic: number; secureDevelopment: number };
  hints: { buyers: number; totalSpend: number };
  /** What these numbers do NOT measure, in the payload rather than only in the
   *  docs — a metric whose limits travel separately from it gets quoted
   *  without them. */
  caveats: string[];
};

type Earned = { points: number; at: string };

function parseEarned(raw: unknown): Earned | null {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v.points !== "number" || typeof v.at !== "string") return null;
    return { points: v.points, at: v.at };
  } catch {
    return null;
  }
}

function parseAttempts(raw: unknown): number {
  if (typeof raw !== "string") return 0;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    return typeof v.attempts === "number" ? v.attempts : 0;
  } catch {
    return 0;
  }
}

/** Upstash returns a hash as a flat [field, value, ...] array. */
function hashEntries(result: unknown): [string, unknown][] {
  if (!Array.isArray(result)) return [];
  const out: [string, unknown][] = [];
  for (let i = 0; i + 1 < result.length; i += 2) out.push([String(result[i]), result[i + 1]]);
  return out;
}

async function batched(commands: (string | number)[][]): Promise<{ result?: unknown }[]> {
  const out: { result?: unknown }[] = [];
  for (let i = 0; i < commands.length; i += BATCH) {
    out.push(...(await upstashPipeline(commands.slice(i, i + BATCH))));
  }
  return out;
}

/** Every `ctf:solves:<target>` hash, as target -> [field, at]. Fields are
 *  `<login>:<challengeId>`. */
async function readSecureDevSolves(): Promise<[string, unknown][]> {
  let cursor = "0";
  const keys: string[] = [];
  do {
    const [scan] = await upstashPipeline([["SCAN", cursor, "MATCH", "ctf:solves:*", "COUNT", 1000]]);
    const [next, found] = Array.isArray(scan.result) ? (scan.result as [string, string[]]) : ["0", []];
    cursor = next;
    keys.push(...found);
  } while (cursor !== "0");
  if (!keys.length) return [];
  const replies = await batched(keys.map((k) => ["HGETALL", k]));
  return replies.flatMap((r) => hashEntries(r.result));
}

export async function computeEventMetrics(): Promise<EventMetrics> {
  const caveats: string[] = [];

  const teams = await listTeams();
  const onATeam = new Set<string>();
  for (const t of teams) for (const m of t.members) onATeam.add(m.toLowerCase());

  // Only the point totals and the hint spend are read as aggregates. The
  // per-challenge counts deliberately are NOT: `ctf:classic:solvecount` would
  // be a free classic-only shortcut, but folding each contestant's own solve
  // rows produces the same figure for BOTH modules from one source. Reading
  // both would invite the two to disagree and leave no way to tell which was
  // right.
  const [quizPointsRes, classicPointsRes, hintsSpentRes] = await upstashPipeline([
    ["HGETALL", QUIZ_POINTS_KEY],
    ["HGETALL", CLASSIC_POINTS_KEY],
    ["HGETALL", HINTS_SPENT_KEY],
  ]);

  const quizPoints = new Map(hashEntries(quizPointsRes.result).map(([k, v]) => [k.toLowerCase(), Number(v) || 0]));
  const classicPoints = new Map(
    hashEntries(classicPointsRes.result).map(([k, v]) => [k.toLowerCase(), Number(v) || 0]),
  );
  const hintsSpent = hashEntries(hintsSpentRes.result).map(([k, v]) => [k.toLowerCase(), Number(v) || 0] as const);

  const sdEntries = await readSecureDevSolves();
  const sdLogins = new Set<string>();
  for (const [field] of sdEntries) {
    const sep = field.indexOf(":");
    if (sep > 0) sdLogins.add(field.slice(0, sep).toLowerCase());
  }

  // The contestant set: anyone on a team, anyone who has scored in any module.
  // Cheaper than SCANning `ctf:user:*`, which also matches
  // `ctf:user:<login>:hints` and would need filtering.
  //
  // TEAM MEMBERSHIP IS WHAT FINDS THE STUCK. Someone who attempted everything
  // and solved nothing has no points row, so the aggregate keys do not know
  // they exist — only their team does. That is sound because ADR 47 makes a
  // team mandatory before anything scores, which is exactly why `stuck` is
  // measurable at all. An event running with TEAM_WRITES_ENABLED unset has no
  // real teams, and would see only contestants who scored.
  const contestants = new Set<string>([
    ...onATeam,
    ...quizPoints.keys(),
    ...classicPoints.keys(),
    ...sdLogins,
  ]);
  let logins = [...contestants].sort();
  if (logins.length > MAX_CONTESTANTS) {
    caveats.push(
      `Only the first ${MAX_CONTESTANTS} of ${logins.length} contestants were folded in — every figure below undercounts.`,
    );
    logins = logins.slice(0, MAX_CONTESTANTS);
  }

  // Five reads per contestant: their earned items, their attempt rows, and the
  // firstTeamAt that anchors the funnel.
  const perLogin = await batched(
    logins.flatMap((l) => [
      ["HGETALL", quizAnswersKey(l)],
      ["HGETALL", classicSolvesKey(l)],
      ["HGETALL", quizAttemptsKey(l)],
      ["HGETALL", classicAttemptsKey(l)],
      ["HMGET", userKey(l), "firstTeamAt"],
    ]),
  );

  let everOnATeam = 0;
  let attempted = 0;
  let scored = 0;
  const buckets = new Map<number, number>();
  const solvesById = new Map<string, { module: "quiz" | "classic"; solvers: number; attemptSum: number }>();
  const attemptsById = new Map<string, { module: "quiz" | "classic"; attempts: number; attempters: number }>();
  const pointsByLogin = new Map<string, number>();

  logins.forEach((login, i) => {
    const quizAnswers = hashEntries(perLogin[i * 5]?.result);
    const classicSolves = hashEntries(perLogin[i * 5 + 1]?.result);
    const quizAttempts = hashEntries(perLogin[i * 5 + 2]?.result);
    const classicAttempts = hashEntries(perLogin[i * 5 + 3]?.result);
    const userFields = perLogin[i * 5 + 4]?.result;
    const firstTeamAt = Array.isArray(userFields) ? userFields[0] : null;

    if (typeof firstTeamAt === "string" && firstTeamAt) everOnATeam += 1;

    const hasAttempt = quizAttempts.length > 0 || classicAttempts.length > 0;
    const earnedRows: [("quiz" | "classic"), [string, unknown][]][] = [
      ["quiz", quizAnswers],
      ["classic", classicSolves],
    ];
    const hasEarned = earnedRows.some(([, rows]) => rows.length > 0) || sdLogins.has(login);

    if (hasAttempt || hasEarned) attempted += 1;
    if (hasEarned) scored += 1;

    pointsByLogin.set(login, (quizPoints.get(login) ?? 0) + (classicPoints.get(login) ?? 0));

    for (const [mod, rows] of earnedRows) {
      for (const [id, raw] of rows) {
        const earned = parseEarned(raw);
        if (!earned) continue;
        const ms = Date.parse(earned.at);
        if (!Number.isNaN(ms)) {
          const bucket = Math.floor(ms / BUCKET_MS) * BUCKET_MS;
          buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
        }
        const key = `${mod}:${id}`;
        const stat = solvesById.get(key) ?? { module: mod, solvers: 0, attemptSum: 0 };
        stat.solvers += 1;
        // How many tries THIS contestant took to earn it. The attempt row
        // survives the solve, so this is available after the fact.
        const attemptRow = (mod === "quiz" ? quizAttempts : classicAttempts).find(([aid]) => aid === id);
        stat.attemptSum += Math.max(1, parseAttempts(attemptRow?.[1]));
        solvesById.set(key, stat);
      }
    }

    for (const [mod, rows] of [["quiz", quizAttempts], ["classic", classicAttempts]] as const) {
      for (const [id, raw] of rows) {
        const key = `${mod}:${id}`;
        const stat = attemptsById.get(key) ?? { module: mod, attempts: 0, attempters: 0 };
        stat.attempts += parseAttempts(raw);
        stat.attempters += 1;
        attemptsById.set(key, stat);
      }
    }
  });

  const challenges: ChallengeStat[] = [...new Set([...solvesById.keys(), ...attemptsById.keys()])]
    .map((key) => {
      const solved = solvesById.get(key);
      const tried = attemptsById.get(key);
      const [mod, ...rest] = key.split(":");
      const solves = solved?.solvers ?? 0;
      const attempters = tried?.attempters ?? 0;
      return {
        module: mod as "quiz" | "classic",
        id: rest.join(":"),
        solves,
        attempts: tried?.attempts ?? 0,
        solveRate: attempters > 0 ? solves / attempters : null,
        avgAttemptsToSolve: solves > 0 ? (solved as { attemptSum: number }).attemptSum / solves : null,
      };
    })
    .sort((a, b) => a.solves - b.solves || a.id.localeCompare(b.id));

  const timeline = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ms, solves]) => ({ at: new Date(ms).toISOString(), solves }));

  const teamRows = teams
    .map((t) => ({
      slug: t.slug,
      name: t.name,
      size: t.members.length,
      // The team's own leaderboard total is a UNION fold over its members'
      // items; summing per-login aggregates would double count a challenge two
      // teammates both solved. This is a rough per-team sum and is labelled as
      // such, not presented as the leaderboard figure.
      points: t.members.reduce((sum, m) => sum + (pointsByLogin.get(m.toLowerCase()) ?? 0), 0),
    }))
    .sort((a, b) => b.points - a.points);

  caveats.push(
    "Team points here SUM each member's own totals; the leaderboard folds the UNION of their solves, so a challenge two teammates both solved counts once there and twice here.",
    "Attempt rows record a count and the LAST attempt time, so the timeline is solves over time, not submissions over time.",
    "Hint purchases carry no timestamp, so whether a hint preceded a solve is not knowable — only that the contestant bought one.",
    "Signing in leaves no record; the funnel starts at 'ever on a team'.",
    "Secure Development items have no per-challenge attempt data — its scores arrive from GitHub already judged, so it contributes to participation and points only.",
  );

  return {
    generatedAt: new Date().toISOString(),
    funnel: {
      onATeam: onATeam.size,
      everOnATeam,
      attempted,
      scored,
      stuck: Math.max(0, attempted - scored),
    },
    challenges,
    timeline,
    teams: teamRows,
    modules: {
      quiz: [...quizPoints.values()].filter((p) => p > 0).length,
      classic: [...classicPoints.values()].filter((p) => p > 0).length,
      secureDevelopment: sdLogins.size,
    },
    hints: {
      buyers: hintsSpent.filter(([, spent]) => spent > 0).length,
      totalSpend: hintsSpent.reduce((sum, [, spent]) => sum + spent, 0),
    },
    caveats,
  };
}

/** CSV of the per-challenge table — the sheet an organizer actually wants
 *  after an event. Deliberately the challenge table and not the whole payload:
 *  the funnel is five numbers that belong on screen, and a CSV of nested
 *  objects is a CSV nobody opens twice. */
export function challengesToCsv(metrics: EventMetrics): string {
  const esc = (v: string | number | null) => {
    if (v === null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    ["module", "id", "solves", "attempts", "solve_rate", "avg_attempts_to_solve"],
    ...metrics.challenges.map((c) => [
      c.module,
      c.id,
      c.solves,
      c.attempts,
      c.solveRate === null ? null : c.solveRate.toFixed(4),
      c.avgAttemptsToSolve === null ? null : c.avgAttemptsToSolve.toFixed(2),
    ]),
  ];
  return rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
}
