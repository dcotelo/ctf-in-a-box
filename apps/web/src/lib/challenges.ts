import "server-only";
import type { AppId } from "@/lib/apps";

// Live challenge catalogue served by the scoring API at
// `${LEADERBOARD_API_URL}/challenges`:
// { challenges: [{ app, id, description, owasp: { code, label, url } }],
//   counts: { "juice-shop": 38, ... }, total: 338 }
// No points data in this feed — difficulty/points stay a scorer concern.

export type OwaspCategory = {
  /** "A01" … "A10" (Web Top 10) or "API1" … "API10" (API Security Top 10). */
  code: string;
  label: string;
  url: string;
};

export type CatalogChallenge = {
  app: AppId;
  /** Stable catalogue id, e.g. "Challenge-1-Password-Hash-Leak". */
  id: string;
  description: string;
  owasp: OwaspCategory;
};

export type ChallengeCatalog = {
  byApp: Partial<Record<AppId, CatalogChallenge[]>>;
  total: number;
};

type ChallengesResponse = {
  challenges: CatalogChallenge[];
  counts: Partial<Record<AppId, number>>;
  total: number;
};

/** Groups the flat challenge list by app. Counts and total are re-derived
 *  from the list itself so the page can't disagree with what it renders. */
export function groupCatalog(data: ChallengesResponse): ChallengeCatalog {
  const byApp: ChallengeCatalog["byApp"] = {};
  for (const challenge of data.challenges) {
    (byApp[challenge.app] ??= []).push(challenge);
  }
  return { byApp, total: data.challenges.length };
}

/** Fetches the live catalogue; returns null (and logs) on any failure so the
 *  challenges page can degrade to its static per-app cards. */
export async function getChallengeCatalog(): Promise<ChallengeCatalog | null> {
  const base = process.env.LEADERBOARD_API_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/challenges`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as ChallengesResponse;
    if (!Array.isArray(data.challenges) || data.challenges.length === 0) {
      throw new Error("empty or malformed challenge list");
    }
    return groupCatalog(data);
  } catch (err) {
    console.error("Challenge catalogue fetch failed:", err);
    return null;
  }
}
