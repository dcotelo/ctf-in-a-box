import { NextResponse, type NextRequest } from "next/server";
import { recordCountryVisit } from "@/lib/dynamo-stats";

/**
 * Bumps the aggregate per-country reach counter by one.
 *
 * The country is read from an edge/reverse-proxy-supplied geo header (e.g.
 * Cloudflare's `cf-ipcountry`, or an equivalent header your front door sets)
 * and NEVER from the request body — the client has no say in what gets
 * counted, and the value is validated as ISO-3166 alpha-2 before it goes
 * anywhere near a sort key. Whatever IP the header's country was derived from
 * is not read here, not logged, and not stored.
 *
 * A bare self-hosted deployment with no such proxy in front simply never
 * populates this header, so the counter stays at zero — that's expected, not
 * a bug; see README.md for how to wire one up if you want the counter live.
 *
 * Always answers 204, whether or not anything was counted. There is nothing
 * useful to tell the caller, and a uniform response means the endpoint can't
 * be used to probe what geo your edge assigned you.
 */
export async function POST(request: NextRequest) {
  const country = request.headers.get("cf-ipcountry") ?? request.headers.get("x-geo-country");
  if (country) await recordCountryVisit(country);
  return new NextResponse(null, { status: 204 });
}
