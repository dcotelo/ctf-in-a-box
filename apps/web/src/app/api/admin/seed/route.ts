import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { seedDemoData } from "@/lib/admin-store";

// Populate a demo leaderboard. DEMO_MODE-only (404 otherwise, so it doesn't
// exist in a real event) AND admin-gated. Injects fake scores/teams — never a
// production operation.
export async function POST(request: Request) {
  if (process.env.DEMO_MODE !== "1") {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }
  const gate = await requireAdmin(request.headers);
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  try {
    const result = await seedDemoData(gate.login);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[admin/seed] seed failed", err);
    return NextResponse.json({ error: "seed failed" }, { status: 503 });
  }
}
