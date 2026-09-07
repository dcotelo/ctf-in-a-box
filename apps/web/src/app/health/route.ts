import { NextResponse } from "next/server";
import { appVersion } from "@/lib/app-version";

/**
 * `GET /health` — is the app up, and which build is it?
 *
 * WHY THIS EXISTS. "Did my fix reach the box?" had no answer from outside the
 * container. The only signals were `fly status`'s machine version (which
 * counts deploys, not commits, and needs Fly credentials) and guessing from
 * whether a bug still reproduced — which is how issue #312 stayed live in
 * production after it was already fixed on `main`. `revision` answers it in
 * one request, from anywhere.
 *
 * WHY IT IS PUBLIC AND UNAUTHENTICATED. Same reasoning as
 * `/api/public/scoring`: an uptime check, a load balancer or an organizer on
 * their phone has no credential to present, and the payload discloses nothing
 * that is not already public. This repo is open source — the commit sha names
 * a commit anyone can read on GitHub, and the release version is on the tag
 * list. Neither tells an attacker anything `git log` would not.
 *
 * KEEP IT THAT WAY. Anything added here is world-readable by definition, and
 * a health endpoint is the classic place that rule gets forgotten. In
 * particular this must never grow: environment variables, configured
 * hostnames or URLs, the admin list, Redis or GitHub reachability, queue
 * depths, or counts of teams/contestants/solves. "Is the dependency up" is a
 * different question with a different audience, and on this kit that answer
 * is already on the admin Overview, behind `requireAdmin`.
 *
 * IT ALSO MUST NOT FAIL. Liveness only — no Redis read, no session read, no
 * `await` on anything that can be down. A dependency check here would report
 * the app as unhealthy when the app is fine, which is backwards for something
 * a restart policy might act on. Every field degrades to "unknown"/null
 * rather than throwing (see `lib/app-version.ts`), so a 200 here means "the
 * Node process is serving requests" and nothing more — which is what a
 * liveness probe should mean.
 */

// Never prerendered and never cached: a cached build stamp is worse than no
// build stamp, because it reports the PREVIOUS deploy with total confidence.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { status: "ok", ...appVersion() },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
