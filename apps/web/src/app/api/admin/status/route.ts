import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminSettings, getSyncStatus } from "@/lib/admin-store";
import { getLeaderboardSource } from "@/lib/leaderboard/source";

type LeaderboardFreshness = { players: number; lastUpdatedAt: string | null } | null;

// Best-effort only: a leaderboard-read failure must degrade this field to
// `null`, not fail the whole status route — settings/sync are the core
// payload the admin panel needs to render.
async function readLeaderboardFreshness(): Promise<LeaderboardFreshness> {
  try {
    const { entries } = await getLeaderboardSource().getLeaderboard();
    let lastUpdatedAt: string | null = null;
    for (const entry of entries) {
      if (entry.updatedAt && (lastUpdatedAt === null || entry.updatedAt > lastUpdatedAt)) {
        lastUpdatedAt = entry.updatedAt;
      }
    }
    return { players: entries.length, lastUpdatedAt };
  } catch (err) {
    console.error("[admin/status] leaderboard freshness read failed", err);
    return null;
  }
}

export async function GET(request: Request) {
  const gate = await requireAdmin(request.headers);
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });
  const [settings, sync, leaderboard] = await Promise.all([
    getAdminSettings(),
    getSyncStatus(),
    readLeaderboardFreshness(),
  ]);
  return NextResponse.json({ settings, sync, leaderboard });
}
