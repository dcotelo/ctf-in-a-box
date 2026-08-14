import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { HINT_COST, revealHint } from "@/lib/hint-store";

/** Buys (or re-views) one hint. Charging is atomic and idempotent in Redis —
 *  repeat calls for an owned hint return it for free. Purchases are final;
 *  there is no refund route. */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const login = (session.user as { login?: string }).login;
  if (!login) return NextResponse.json({ error: "session has no GitHub login" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const result = await revealHint(
    login,
    typeof body.app === "string" ? body.app : "",
    typeof body.id === "string" ? body.id : "",
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.missing ? 404 : 400 });
  }
  return NextResponse.json({
    hint: result.hint,
    alreadyOwned: result.alreadyOwned,
    spent: result.spent,
    cost: HINT_COST,
  });
}
