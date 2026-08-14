import "server-only";
import { apps, appsById, type AppId } from "@/lib/apps";
import { upstashEval, upstashPipeline } from "@/lib/upstash";
import { DATA_BACKEND } from "@/lib/dynamo";
import {
  dynamoChargeHint,
  dynamoGetHintAvailability,
  dynamoGetHintPenalties,
  dynamoGetHintText,
  dynamoGetHintTexts,
  dynamoGetViewerPurchases,
  mirrorHintCharge,
} from "@/lib/dynamo-hint-store";

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
 * CTF_DATA_BACKEND (see lib/dynamo.ts) picks where purchases are recorded:
 * "dual" (default) keeps the Upstash Lua verdict authoritative and mirrors each
 * fresh charge into DynamoDB best-effort; "dynamo" stores purchases and reads
 * penalties, hint text, and availability from DynamoDB instead (pk=HINTS, kept
 * in sync from the scorer-seeded Upstash hashes by the backfill — re-run it
 * after any hint re-seeding). Upstash creds are therefore only required for
 * hints in the upstash/dual modes; dynamo mode is fully Upstash-free.
 *
 * Callers (the /api/hints route handlers) are responsible for authenticating
 * the session and deriving `login` server-side — nothing here trusts
 * client-supplied identity.
 */

/** Points deducted per revealed hint. The stored penalty is points (not a
 *  count), so purchases made before a price change keep their old price. */
export const HINT_COST = 10;

/** Master switch for paid hints: HINTS_ENABLED=true opts in explicitly (so
 *  hints stay hidden until the event even where the backend is configured).
 *  In upstash/dual modes the hint text lives only in Upstash, so credentials
 *  must also be present (read/write — revealing writes to Redis, already
 *  required for TEAM_WRITES_ENABLED); in dynamo mode everything comes from
 *  DynamoDB, whose credentials are ambient (Vercel OIDC / the SDK chain). */
export const HINTS_ENABLED =
  process.env.HINTS_ENABLED === "true" &&
  (DATA_BACKEND === "dynamo" ||
    Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN));

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
  | { ok: false; error: string; missing?: boolean };

export async function revealHint(login: string, app: string, id: string): Promise<RevealResult> {
  if (!HINTS_ENABLED) return { ok: false, error: "Hints are not enabled" };
  if (!isAppId(app)) return { ok: false, error: "Unknown app" };
  if (!CHALLENGE_ID_RE.test(id)) return { ok: false, error: "Invalid challenge id" };

  if (DATA_BACKEND === "dynamo") {
    // Text from pk=HINTS, charge in DynamoDB. The text lookup isn't atomic
    // with the charge (unlike the Lua re-check), which is fine: hint items
    // change rarely and the charge-once guard is what matters — a hint deleted
    // mid-flight just can't be charged for twice.
    let text: string | null = null;
    try {
      text = await dynamoGetHintText(app, id);
    } catch (err) {
      console.error("Hint text lookup failed:", err);
      return { ok: false, error: "Hint reveal failed. Try again" };
    }
    if (!text) return { ok: false, missing: true, error: "No hint available for this challenge" };

    const charge = await dynamoChargeHint(login, app, id, HINT_COST);
    if (charge.status === "error") return { ok: false, error: "Hint reveal failed. Try again" };
    return { ok: true, hint: text, alreadyOwned: charge.status === "owned", spent: charge.spent };
  }

  let verdict: unknown;
  try {
    verdict = await upstashEval(
      REVEAL_SCRIPT,
      [userHintsKey(login), SPENT_KEY, hintHashKey(app)],
      [id, `${app}/${id}`, login, HINT_COST],
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
    // Only a fresh purchase ("charged") is a real write worth mirroring.
    if (status === "charged" && DATA_BACKEND === "dual") await mirrorHintCharge(login, app, id, HINT_COST);
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
  if (!HINTS_ENABLED) return NO_HINTS;

  let owned: { app: AppId; id: string }[];
  let spent: number;
  if (DATA_BACKEND === "dynamo") {
    const viewer = await dynamoGetViewerPurchases(login);
    owned = viewer.purchases.flatMap(({ app, id }) => (isAppId(app) ? [{ app, id }] : []));
    spent = viewer.spent;
  } else {
    const [members, spentRes] = await upstashPipeline([
      ["SMEMBERS", userHintsKey(login)],
      ["HGET", SPENT_KEY, login],
    ]);
    owned = (Array.isArray(members.result) ? (members.result as string[]) : []).flatMap((member) => {
      const slash = member.indexOf("/");
      if (slash === -1) return [];
      const app = member.slice(0, slash);
      return isAppId(app) ? [{ app, id: member.slice(slash + 1) }] : [];
    });
    spent = Number(spentRes.result) || 0;
  }

  const purchased: ViewerHints["purchased"] = {};
  if (owned.length > 0) {
    const texts =
      DATA_BACKEND === "dynamo"
        ? await dynamoGetHintTexts(owned)
        : (await upstashPipeline(owned.map(({ app, id }) => ["HGET", hintHashKey(app), id]))).map(({ result }) =>
            typeof result === "string" && result ? result : null,
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
  if (!HINTS_ENABLED) return new Map();
  if (DATA_BACKEND === "dynamo") return dynamoGetHintPenalties();

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
  if (!HINTS_ENABLED) return {};
  try {
    if (DATA_BACKEND === "dynamo") {
      // Unlike the no-store pipeline client, an AWS SDK call isn't a fetch and
      // can't flip the challenges page to dynamic rendering — it simply runs
      // each time the (still static) page revalidates.
      const byApp = await dynamoGetHintAvailability();
      const availability: Partial<Record<AppId, string[]>> = {};
      for (const app of apps) {
        const ids = byApp[app.id];
        if (ids && ids.length > 0) availability[app.id] = ids;
      }
      return availability;
    }
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
