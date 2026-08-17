import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { resetEvent } from "@/lib/admin-store";
import { eventConfig } from "@/lib/event-config";

// Master reset: wipe all event data. Admin-gated + type-to-confirm, both
// enforced server-side (never trust the client). The confirm value must match
// the event name or the literal "RESET".
export async function POST(request: Request) {
  const gate = await requireAdmin(request.headers);
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  const body = (await request.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== eventConfig.name && body.confirm !== "RESET") {
    return NextResponse.json({ error: "confirmation does not match the event name" }, { status: 400 });
  }

  try {
    const result = await resetEvent(gate.login);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[admin/reset] reset failed", err);
    return NextResponse.json({ error: "reset failed" }, { status: 503 });
  }
}
