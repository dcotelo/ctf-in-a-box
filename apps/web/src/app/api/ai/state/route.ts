import { aiJson, aiPreflight, aiRoute } from "@/lib/ai-http";
import { AI_ID_RE } from "@/lib/ai-keys";
import { getAiLaunchPublicKey, getViewerAi, listAiChallenges } from "@/lib/ai-store";
import { type AiTokenProgress, decodeTokenUnverified, verifyLaunchToken } from "@/lib/ai-token";
import { RATE_LIMITS, consumeRateLimit } from "@/lib/rate-limit-store";

/**
 * The live progress snapshot for an externally hosted challenge.
 *
 * The same data rides inside the launch token's `ctf.progress`, but that is a
 * snapshot taken at mint time; a challenge whose session outlives it re-reads
 * here instead of showing stale progress. The two shapes MUST stay identical —
 * an external integrator writes one parser.
 *
 * READ ONLY. Nothing on this path writes: no nonce, no attempt row, no solve.
 *
 * The token may also arrive as `?t=` because a pure static SPA cannot always
 * set an Authorization header. That adds no exposure the launcher did not
 * already have — the token is in the launch URL by construction — but it does
 * mean this route must never log its query string.
 *
 * Wrapped in `aiRoute`, so a store read that THROWS (an Upstash blip) leaves
 * here as a CORS-readable 503 `{error:"unavailable"}` rather than a bare 500
 * an external caller cannot even see the status of.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return aiPreflight("GET, OPTIONS");
}

export const GET = aiRoute(async (request: Request): Promise<Response> => {
  const header = request.headers.get("authorization") ?? "";
  const fromHeader = /^bearer /i.test(header) ? header.slice(7).trim() : "";
  const token = fromHeader || (new URL(request.url).searchParams.get("t") ?? "").trim();
  if (!token) return aiJson({ error: "invalid-token" }, 401);

  const challengeId = decodeTokenUnverified(token)?.aud ?? "";
  if (!AI_ID_RE.test(challengeId)) return aiJson({ error: "invalid-token" }, 401);

  const verified = verifyLaunchToken(token, await getAiLaunchPublicKey(), { audience: challengeId });
  if (!verified.ok) {
    return aiJson({ error: verified.error === "expired" ? "expired" : "invalid-token" }, 401);
  }
  const login = verified.claims.sub;

  const { bucket, limit, windowSeconds } = RATE_LIMITS.aiState;
  const budget = await consumeRateLimit(bucket, login, limit, windowSeconds);
  if (!budget.allowed) {
    return aiJson({ error: "rate-limited" }, 429, { "Retry-After": String(budget.retryAfterSeconds) });
  }

  const [challenges, viewer] = await Promise.all([listAiChallenges(), getViewerAi(login)]);

  // Built field by field, never spread from the stored record: a poisoned
  // record must not be able to carry a flag or a key into this payload.
  //
  // Typed as `AiTokenProgress[]` on purpose: this payload and the launch
  // token's `ctf.progress` MUST stay identical (see the file header — an
  // integrator writes ONE parser), so drift is a compile error rather than a
  // discrepancy someone finds at runtime.
  const progress: AiTokenProgress[] = challenges.map((c) => {
    const solve = viewer.solved[c.id];
    return {
      id: c.id,
      points: c.points,
      solved: Boolean(solve),
      solvedAt: solve?.at ?? null,
    };
  });
  const points = Object.values(viewer.solved).reduce((sum, solve) => sum + solve.points, 0);

  return aiJson({ sub: login, points, progress }, 200, { "Cache-Control": "no-store" });
});
