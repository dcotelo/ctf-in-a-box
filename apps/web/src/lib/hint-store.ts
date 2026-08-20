import "server-only";
import { getAdminSettings } from "@/lib/admin-store";
import { HINT_DEFAULT_ENABLED } from "@/lib/hint-defaults";
import { apps, appsById, type AppId } from "@/lib/apps";
import { isModuleEnabled } from "@/lib/modules";
import { upstashEval, upstashPipeline } from "@/lib/upstash";

/**
 * Paid hints. Hint text lives in the scorer-owned hashes `hints:<app>`
 * (field = challenge catalogue id, value = hint text) — this module only ever
 * READS those. Purchases are recorded under the site's ctf: namespace, which
 * the scorer never rewrites, so penalties survive re-scores:
 *   SADD ctf:user:<login>:hints "<app>/<challengeId>"   (what the user bought)
 *   HINCRBY ctf:hints:spent <login> HINT_COST           (running penalty total)
 * Displayed scores subtract the penalty as an overlay (see
 * leaderboard/hint-penalties.ts) — the scorer's leaderboard ZSET is never
 * decremented.
 *
 * Callers (the /api/hints route handlers) are responsible for authenticating
 * the session and deriving `login` server-side — nothing here trusts
 * client-supplied identity.
 */

/** Points deducted per revealed hint. The stored penalty is points (not a
 *  count), so purchases made before a price change keep their old price. */
export const HINT_COST = 10;

/** CAPABILITY, not policy: whether hints *can* work at all here. Hint text
 *  lives only in Upstash, so without credentials there is nothing to read and
 *  nothing to charge for — no organizer setting can make hints function.
 *  (Read/write is needed, since revealing writes to Redis; that is already
 *  required for TEAM_WRITES_ENABLED.)
 *
 *  Policy — whether an organizer WANTS hints on — is a separate question,
 *  answered by `/admin` on top of `HINT_DEFAULT_ENABLED`. Keeping the two
 *  apart is what lets every read path below ask one question and get the same
 *  answer. Check this first where it saves a Redis round-trip: a deployment
 *  with no credentials can never have hints, so there is no point reading
 *  settings to find that out. */
export const HINTS_AVAILABLE = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

/** Default anti-burner gate: you must have solved at least this many
 *  challenges ON THE TARGET before you may buy that target's hints.
 *
 *  Why: a hint's PRICE lands on the account that reveals it, but the hint
 *  TEXT is trivially relayed — so a throwaway account can buy hints, eat a
 *  penalty nobody cares about, and pass the text to the real team. Pricing
 *  alone cannot stop that. Requiring earned progress can: a fresh account has
 *  no solves, so it can never reveal anything, and farming hints costs the
 *  same real work the event is scored on. 0 disables the gate. */
export const HINT_MIN_SOLVES = 1;

/** Default minutes after `scoringStartsAt` before ANY hint may be bought.
 *  0 = no time phase (the schedule is opt-in per event). Inert when no
 *  `scoringStartsAt` is configured — there is no phase without a start. */
export const HINT_UNLOCK_AFTER_MIN = 0;

const SPENT_KEY = "ctf:hints:spent";
const userHintsKey = (login: string) => `ctf:user:${login}:hints`;
const hintHashKey = (app: AppId) => `hints:${app}`;

/** Catalogue ids look like "Challenge-5-Admin-Section" — reject anything
 *  weirder before it reaches Redis. */
const CHALLENGE_ID_RE = /^[\w.-]{1,128}$/;

export function isAppId(value: string): value is AppId {
  return value in appsById;
}

// Charge-if-new + return the hint in one atomic script: SADD's return value
// is the idempotency guard, so a double-click (or a race across two tabs)
// can never charge twice. `hint` is re-checked inside the script — a stale
// availability cache can't charge for a hint that no longer exists.
const REVEAL_SCRIPT = `
local hint = redis.call('HGET', KEYS[3], ARGV[1])
if not hint then return {'missing'} end
if redis.call('SADD', KEYS[1], ARGV[2]) == 1 then
  local spent = redis.call('HINCRBY', KEYS[2], ARGV[3], ARGV[4])
  return {'charged', hint, spent}
end
return {'owned', hint, redis.call('HGET', KEYS[2], ARGV[3]) or '0'}`;

export type RevealResult =
  | { ok: true; hint: string; alreadyOwned: boolean; spent: number }
  | { ok: false; error: string; missing?: boolean; forbidden?: boolean };

/** Resolves the effective hint config for this request: an admin override
 *  (Task 1's `getAdminSettings`) wins when set, else the baked default.
 *  `??` (not `||`) so an explicit `false`/`0` override beats an "on" default.
 *
 *  This is the SINGLE answer to "are hints on right now". Every read path
 *  goes through it — purchase, page furniture, and leaderboard penalties
 *  alike — so the /admin toggle cannot be true for one and false for another.
 *  It previously governed purchasing only, while three other paths consulted
 *  a module-level env constant, so turning hints off blocked buying but left
 *  the buttons and the penalty column on screen. */
export async function resolveHintConfig(): Promise<{
  enabled: boolean;
  cost: number;
  minSolves: number;
  unlockAfterMin: number;
  scoringStartsAt: string | null;
}> {
  const s = await getAdminSettings();
  return {
    // Capability AND policy. An organizer can turn hints off; no organizer
    // setting can turn them on without the credentials that store the text.
    enabled: HINTS_AVAILABLE && (s.hintsEnabled ?? HINT_DEFAULT_ENABLED),
    cost: s.hintCost ?? HINT_COST,
    minSolves: s.hintsMinSolves ?? HINT_MIN_SOLVES,
    unlockAfterMin: s.hintsUnlockAfterMin ?? HINT_UNLOCK_AFTER_MIN,
    scoringStartsAt: s.scoringStartsAt,
  };
}

/** Solves `login` has recorded for `app`, counted straight off the scorer's
 *  `ctf:solves:<target>` hash (fields are `<author>:<challengeId>`). Compared
 *  case-insensitively because GitHub logins are, while the stored field keeps
 *  whatever casing the PR author used. */
async function countSolves(login: string, app: AppId): Promise<number> {
  const [res] = await upstashPipeline([["HKEYS", `ctf:solves:${app}`]]);
  const fields = Array.isArray(res.result) ? (res.result as string[]) : [];
  const prefix = `${login.toLowerCase()}:`;
  return fields.filter((f) => f.toLowerCase().startsWith(prefix)).length;
}

export type HintGate =
  | { allowed: true }
  | { allowed: false; reason: "disabled" }
  /** The event's hint phase hasn't opened yet. */
  | { allowed: false; reason: "locked"; unlocksAt: string }
  /** Caller hasn't earned enough on this target yet (the anti-burner gate). */
  | { allowed: false; reason: "no-progress"; needed: number; have: number };

/** Decides whether `login` may buy a hint on `app` right now. Both gates are
 *  evaluated at READ time (no scheduler on the box), matching how the freeze
 *  and registration windows work. */
export async function hintGate(login: string, app: AppId): Promise<HintGate> {
  // Hints are a Secure Development concept — the keys are per-challenge and a
  // quiz has nothing to hint. Fail closed, consistent with the rest of this file.
  if (!isModuleEnabled("secure-development")) return { allowed: false, reason: "disabled" };

  const { enabled, minSolves, unlockAfterMin, scoringStartsAt } = await resolveHintConfig();
  if (!enabled) return { allowed: false, reason: "disabled" };

  // Time phase: only meaningful once the organizer has set a scoring start.
  if (unlockAfterMin > 0 && scoringStartsAt) {
    const startMs = Date.parse(scoringStartsAt);
    if (Number.isFinite(startMs)) {
      const opensMs = startMs + unlockAfterMin * 60_000;
      if (Date.now() < opensMs) {
        return { allowed: false, reason: "locked", unlocksAt: new Date(opensMs).toISOString() };
      }
    }
  }

  // Progress gate. Redis trouble fails CLOSED here (unlike the scoring freeze,
  // which must never drop live submissions): a hint is a paid reveal, so the
  // safe failure is "no hint", not "free hint for an unverified account".
  if (minSolves > 0) {
    let have: number;
    try {
      have = await countSolves(login, app);
    } catch (err) {
      console.error("hint gate: solve lookup failed:", err);
      return { allowed: false, reason: "no-progress", needed: minSolves, have: 0 };
    }
    if (have < minSolves) return { allowed: false, reason: "no-progress", needed: minSolves, have };
  }

  return { allowed: true };
}

export async function revealHint(login: string, app: string, id: string): Promise<RevealResult> {
  const { enabled, cost } = await resolveHintConfig();
  if (!enabled) return { ok: false, error: "Hints are not enabled" };
  if (!isAppId(app)) return { ok: false, error: "Unknown app" };
  if (!CHALLENGE_ID_RE.test(id)) return { ok: false, error: "Invalid challenge id" };

  // Gate BEFORE the charge script. Enforced here (not just in the route) so
  // every caller goes through it — the UI hides locked hints, but the API is
  // the boundary that actually decides.
  const gate = await hintGate(login, app);
  if (!gate.allowed) {
    if (gate.reason === "locked") {
      return { ok: false, forbidden: true, error: `Hints unlock at ${gate.unlocksAt}` };
    }
    if (gate.reason === "no-progress") {
      return {
        ok: false,
        forbidden: true,
        error: `Solve ${gate.needed} challenge${gate.needed === 1 ? "" : "s"} on this target before buying its hints (you have ${gate.have})`,
      };
    }
    return { ok: false, error: "Hints are not enabled" };
  }

  let verdict: unknown;
  try {
    verdict = await upstashEval(
      REVEAL_SCRIPT,
      [userHintsKey(login), SPENT_KEY, hintHashKey(app)],
      [id, `${app}/${id}`, login, cost],
    );
  } catch (err) {
    console.error("Hint reveal failed:", err);
    return { ok: false, error: "Hint reveal failed. Try again" };
  }

  const [status, hint, spent] = Array.isArray(verdict) ? (verdict as unknown[]) : [];
  if (status === "missing") {
    return { ok: false, missing: true, error: "No hint available for this challenge" };
  }
  if ((status === "charged" || status === "owned") && typeof hint === "string") {
    return { ok: true, hint, alreadyOwned: status === "owned", spent: Number(spent) || 0 };
  }
  return { ok: false, error: "Hint reveal failed. Try again" };
}

export type ViewerHints = {
  /** Bought hints with their texts, grouped by app and keyed by challenge id. */
  purchased: Partial<Record<AppId, Record<string, string>>>;
  /** Total penalty points. */
  spent: number;
  /** Hints bought. */
  count: number;
};

const NO_HINTS: ViewerHints = { purchased: {}, spent: 0, count: 0 };

export async function getViewerHints(login: string): Promise<ViewerHints> {
  // Cheap capability check first — no credentials means no settings read.
  if (!HINTS_AVAILABLE) return NO_HINTS;
  if (!(await resolveHintConfig()).enabled) return NO_HINTS;

  const [members, spentRes] = await upstashPipeline([
    ["SMEMBERS", userHintsKey(login)],
    ["HGET", SPENT_KEY, login],
  ]);
  const owned = (Array.isArray(members.result) ? (members.result as string[]) : []).flatMap((member) => {
    const slash = member.indexOf("/");
    if (slash === -1) return [];
    const app = member.slice(0, slash);
    return isAppId(app) ? [{ app, id: member.slice(slash + 1) }] : [];
  });
  const spent = Number(spentRes.result) || 0;

  const purchased: ViewerHints["purchased"] = {};
  if (owned.length > 0) {
    const texts = (await upstashPipeline(owned.map(({ app, id }) => ["HGET", hintHashKey(app), id]))).map(
      ({ result }) => (typeof result === "string" && result ? result : null),
    );
    owned.forEach(({ app, id }, i) => {
      const text = texts[i];
      // A hint deleted after purchase just drops out of the reveal list.
      if (text) (purchased[app] ??= {})[id] = text;
    });
  }

  return {
    purchased,
    spent,
    count: owned.length,
  };
}

/** Penalty points per login — one HGETALL serves the whole leaderboard. */
export async function getHintPenalties(): Promise<Map<string, number>> {
  if (!HINTS_AVAILABLE) return new Map();
  // Hints off => no penalty column. Already-spent points stay recorded in
  // Redis, so re-enabling restores them rather than forgiving them.
  if (!(await resolveHintConfig()).enabled) return new Map();

  const [res] = await upstashPipeline([["HGETALL", SPENT_KEY]]);
  const flat = Array.isArray(res.result) ? (res.result as string[]) : [];
  const penalties = new Map<string, number>();
  for (let i = 0; i < flat.length; i += 2) {
    const points = Number(flat[i + 1]);
    if (Number.isFinite(points) && points > 0) penalties.set(flat[i], points);
  }
  return penalties;
}

// Availability is fetched with Next's ISR cache instead of upstashPipeline —
// the pipeline client is `cache: "no-store"`, which would flip the statically
// rendered challenges page to per-request dynamic rendering.
async function cachedHkeys(key: string): Promise<string[]> {
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  const res = await fetch(`${url.replace(/\/$/, "")}/hkeys/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Upstash HKEYS ${key}: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error(`Upstash HKEYS ${key}: ${body.error}`);
  return Array.isArray(body.result) ? (body.result as string[]) : [];
}

/** Which challenge ids have a hint, per app — public shape (no hint text),
 *  safe to bake into the static challenges page. Degrades to {} on any
 *  failure so the page renders without the hint layer. */
export async function getHintAvailability(): Promise<Partial<Record<AppId, string[]>>> {
  if (!HINTS_AVAILABLE) return {};
  if (!(await resolveHintConfig()).enabled) return {};
  try {
    const ids = await Promise.all(apps.map((app) => cachedHkeys(hintHashKey(app.id))));
    const availability: Partial<Record<AppId, string[]>> = {};
    apps.forEach((app, i) => {
      if (ids[i].length > 0) availability[app.id] = ids[i];
    });
    return availability;
  } catch (err) {
    console.error("Hint availability fetch failed:", err);
    return {};
  }
}
