import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { ADMIN_AUDIT_KEY, AUDIT_CAP } from "@/lib/admin-store";
import { getAiLaunchKeys, getAiSigningKey, listAiChallenges } from "@/lib/ai-store";
import { signEventBody, signLaunchToken, type AiTokenClaims } from "@/lib/ai-token";
// The REAL event handler — invoked in-process, never over the network. See
// the header comment below: this route relays its verdict verbatim rather
// than re-implementing any of its verification.
import { POST as eventPost } from "@/app/api/ai/event/route";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rate-limit-store";
import { upstashPipeline } from "@/lib/upstash";

/**
 * The organizer's "Send test" button for one ai-module challenge (spec §8.2).
 *
 * Mints a 15-minute demo launch token for the ADMIN'S OWN login, signs a demo
 * solve-event body with the challenge's real signing key, and calls the REAL
 * `/api/ai/event` handler in-process — the exact code path a live integration
 * exercises — with `dryRun: true`. A dry run writes nothing (see
 * `event/route.ts`'s own doc comment), which is what makes this safe to click
 * against a live event: no nonce is claimed, no points are awarded.
 *
 * This route deliberately does NOT re-implement any of `/api/ai/event`'s
 * checks (signature, token, mode, rate limit, team, schedule). It relays that
 * handler's status and JSON body verbatim, including a refusal — a
 * flag-mode challenge's `wrong-mode`, say — so the admin panel always shows
 * the same verdict a real integration would get, never a synthetic one this
 * route invented.
 *
 * `requireAdmin` runs FIRST, before any store read, mint or invocation:
 * exactly `admin/ai/route.ts`'s idiom, because minting a token — even a
 * throwaway demo one — is a write-shaped operation that must never run for
 * an unauthenticated caller.
 *
 * The launch PRIVATE key (from `getAiLaunchKeys`) and the challenge's event
 * signing key are used only to produce signatures; neither is ever placed in
 * the response body or handed to `console.error`.
 */

const RESULT_ERROR = "unavailable";

function errorLabel(err: unknown): string {
  if (!(err instanceof Error)) return "non-Error throw";
  return `${err.name}: ${err.message}`.slice(0, 200);
}

/** Same LPUSH+LTRIM idiom as `admin/ai/route.ts`'s own `writeAudit`. Detail
 *  carries the challenge id only — never the minted token or any key. */
async function writeAudit(actor: string, action: string, detail: Record<string, unknown>): Promise<void> {
  const audit = JSON.stringify({ at: new Date().toISOString(), by: actor, action, ...detail });
  try {
    await upstashPipeline([
      ["LPUSH", ADMIN_AUDIT_KEY, audit],
      ["LTRIM", ADMIN_AUDIT_KEY, 0, AUDIT_CAP - 1],
    ]);
  } catch (err) {
    console.error("[admin/ai/test] audit write failed:", errorLabel(err));
  }
}

/** Same choice `ai/[id]/page.tsx`'s `resolveOrigin` makes: normalize
 *  `BETTER_AUTH_URL` to its origin, falling back to `http://localhost` for a
 *  local/dev box that never set it. A malformed value is a config error, not
 *  a reason to fail the request. */
function resolveOrigin(): string {
  const configured = process.env.BETTER_AUTH_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to the dev default below.
    }
  }
  return "http://localhost";
}

export async function POST(request: Request) {
  const gate = await requireAdmin(request.headers);
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  const { bucket, limit, windowSeconds } = RATE_LIMITS.aiAdminTest;
  const budget = await consumeRateLimit(bucket, gate.login, limit, windowSeconds);
  if (!budget.allowed) return NextResponse.json({ error: "rate-limited" }, { status: 429 });

  const body = await request.json().catch(() => null);
  const challengeId =
    body !== null && typeof body === "object" && typeof (body as { challengeId?: unknown }).challengeId === "string"
      ? (body as { challengeId: string }).challengeId
      : "";

  const challenge = (await listAiChallenges()).find((c) => c.id === challengeId);
  if (!challenge) return NextResponse.json({ error: "unknown-challenge" }, { status: 400 });

  // A challenge can exist with no signing key yet minted (a legacy row — see
  // `AdminAiChallenge`'s doc comment). That is functionally the same as an
  // unknown challenge from this route's point of view: there is nothing to
  // sign a demo event with, and `/api/ai/event` would itself 404
  // `unknown-challenge` on the same `getAiSigningKey` miss.
  const signingKey = await getAiSigningKey(challengeId);
  if (!signingKey) return NextResponse.json({ error: "unknown-challenge" }, { status: 400 });

  let launchPrivateKey: string;
  try {
    launchPrivateKey = (await getAiLaunchKeys()).privateKey;
  } catch (err) {
    console.error("[admin/ai/test] launch key read failed:", errorLabel(err));
    return NextResponse.json({ error: RESULT_ERROR }, { status: 503 });
  }

  const now = Math.floor(Date.now() / 1000);
  const claims: AiTokenClaims = {
    iss: resolveOrigin(),
    sub: gate.login,
    aud: challengeId,
    iat: now,
    exp: now + 900,
    jti: randomBytes(16).toString("base64url"),
    ctf: {
      module: "ai",
      challenge: { id: challenge.id, title: challenge.title, points: challenge.points },
      points: 0,
      progress: [],
    },
  };
  const token = signLaunchToken(claims, launchPrivateKey);

  const eventBody = JSON.stringify({
    token,
    challengeId,
    solvedAt: new Date().toISOString(),
    dryRun: true,
  });
  const ts = Math.floor(Date.now() / 1000);
  const sig = signEventBody(signingKey, ts, eventBody);

  const eventRequest = new Request("http://internal/api/ai/event", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-CTF-Timestamp": String(ts),
      "X-CTF-Signature": sig,
    },
    body: eventBody,
  });

  const eventResponse = await eventPost(eventRequest);
  const eventJson = await eventResponse.json().catch(() => null);

  await writeAudit(gate.login, "ai-send-test", { id: challengeId });

  return NextResponse.json({ status: eventResponse.status, body: eventJson });
}
