import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { leaveTeam } from "@/lib/team-store";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const login = (session.user as { login?: string }).login;
  if (!login) return NextResponse.json({ error: "session has no GitHub login" }, { status: 400 });

  const result = await leaveTeam(login);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ team: result.team });
}
