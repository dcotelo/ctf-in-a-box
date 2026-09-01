import { aiJson, aiPreflight, aiRoute } from "@/lib/ai-http";
import { getAiLaunchPublicKey } from "@/lib/ai-store";
import { launchKeyId } from "@/lib/ai-token";

/**
 * The ai module's launch-token public key.
 *
 * PUBLIC AND UNAUTHENTICATED ON PURPOSE, and the reasoning is the same shape
 * as `/api/public/scoring`'s: an external challenge has to verify the launch
 * token it was handed, and it cannot hold a secret to do that with — a pure
 * static SPA has nowhere to put one. A public key is the one credential that
 * is safe to hand to everybody, which is exactly why launch tokens stopped
 * being symmetric (ADR 53).
 *
 * KEEP IT THAT WAY. Anything added to this payload is world-readable by
 * definition. The public key, its `kid` and the algorithm belong here; the
 * private half, any per-challenge signing key, and the challenge catalogue do
 * not. This route calls `getAiLaunchPublicKey()` — never `getAiLaunchKeys()`,
 * which returns both halves.
 *
 * Cacheable for a few minutes: the key changes only on an explicit rotation,
 * and a short TTL means a rotation reaches integrators without a stampede on
 * every token verification.
 *
 * FAILS CLOSED via `aiRoute`: if the store read throws, the answer is 503
 * `{error:"unavailable"}`, never an empty or partial key. Handing one back
 * would have every integrator cache a value that verifies nothing, and the
 * failure would surface later as "all tokens are invalid" with no obvious
 * cause. The wrapper is also what keeps the CORS headers on that 503, so a
 * browser-side integrator can read the status at all.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return aiPreflight("GET, OPTIONS");
}

export const GET = aiRoute(async (): Promise<Response> => {
  const publicKey = await getAiLaunchPublicKey();

  return aiJson(
    { alg: "Ed25519", kid: launchKeyId(publicKey), publicKey },
    200,
    { "Cache-Control": "public, max-age=300" },
  );
});
