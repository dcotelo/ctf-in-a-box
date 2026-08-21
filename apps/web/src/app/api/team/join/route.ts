import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { joinTeam } from "@/lib/team-store";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit-store";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const login = (session.user as { login?: string }).login;
  if (!login) return NextResponse.json({ error: "session has no GitHub login" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";
  if (!code) return NextResponse.json({ error: "Join code is required" }, { status: 400 });

  // Charged AFTER the shape checks and BEFORE joinTeam, so a malformed body
  // costs nothing and no code is ever tested without being charged for.
  const limit = await consumeRateLimit(
    RATE_LIMITS.teamJoin.bucket,
    login,
    RATE_LIMITS.teamJoin.limit,
    RATE_LIMITS.teamJoin.windowSeconds,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many join attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const result = await joinTeam(login, code);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ team: result.team });
}
