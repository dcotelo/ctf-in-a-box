import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, GATE_COOKIE_MAX_AGE, isGateActive, signGateCookie, verifyGatePassword } from "@/lib/gate";
import { clearGateThrottle, consumeGateAttempt } from "@/lib/dynamo-gate-store";

/** Unlocks the pre-event challenges gate. The password only ever exists
 *  server-side; one attempt is CHARGED against the per-IP budget before the
 *  compare happens, so a burst of concurrent requests cannot all slip past the
 *  same pre-burst counter. Success answers with the signed unlock cookie the
 *  proxy checks. */
export async function POST(request: NextRequest) {
  if (!isGateActive()) return NextResponse.json({ error: "not found" }, { status: 404 });

  // The leftmost x-forwarded-for value is client-controlled, not trustworthy:
  // the kit's Caddy config appends the real client IP to whatever XFF a
  // request already carries (like nginx's proxy_add_x_forwarded_for) rather
  // than replacing it, and no trusted_proxies is configured — so a caller can
  // prepend an arbitrary IP and get a fresh throttle bucket on every attempt.
  // This makes the 5-attempts/24h throttle best-effort against casual
  // guessing, not a hard rate limit; header-spoofing bypasses it. Accepted
  // risk: the gate protects pre-event visibility of the challenge board, not
  // accounts or funds. Without any proxy in front at all, the header is
  // simply absent and everyone shares the "unknown" bucket.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) return NextResponse.json({ error: "Password is required" }, { status: 400 });

  const now = Date.now();
  let verdict;
  try {
    verdict = await consumeGateAttempt(ip, now);
  } catch (err) {
    // Fail closed: if the budget cannot be charged, nobody gets to guess. This
    // is also why the charge cannot be made best-effort — a swallowed write
    // error would hand back an unmetered compare.
    console.error(`[gate] throttle charge failed: ${(err as Error).message}`);
    return NextResponse.json({ error: "Try again later" }, { status: 500 });
  }

  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } },
    );
  }

  if (!verifyGatePassword(password)) {
    // Already charged above; nothing left to record.
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  // Refund the budget this attempt just spent. Best-effort by contract: the
  // unlock cookie below is what the caller actually needs, and it is issued
  // whether or not the refund lands.
  if (!(await clearGateThrottle(ip))) {
    console.error("[gate] unlocked but budget not refunded; a second unlock from this IP may 429");
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, signGateCookie(now + GATE_COOKIE_MAX_AGE * 1000), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: GATE_COOKIE_MAX_AGE,
  });
  return res;
}
