import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getViewerHints, HINT_COST, HINTS_ENABLED } from "@/lib/hint-store";

/** The signed-in viewer's full hint state (all apps) — lets the challenges
 *  page pre-reveal everything already bought with a single fetch. */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const login = (session.user as { login?: string }).login;
  if (!login) return NextResponse.json({ error: "session has no GitHub login" }, { status: 400 });

  const hints = await getViewerHints(login);
  return NextResponse.json({
    enabled: HINTS_ENABLED,
    cost: HINT_COST,
    purchased: hints.purchased,
    spent: hints.spent,
    count: hints.count,
  });
}
