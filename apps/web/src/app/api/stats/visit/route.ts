import { NextResponse, type NextRequest } from "next/server";
import { recordCountryVisit } from "@/lib/stats-store";

/**
 * Bumps the aggregate per-country reach counter by one.
 *
 * The country is read from a geo header (`cf-ipcountry`, as set by
 * Cloudflare, or the generic `x-geo-country` some other front door might
 * set) and never from the request body. That header is only as trustworthy
 * as whatever sits in front of this app: a real edge/CDN that overwrites it
 * on every request makes the value reliable, but the kit's own Caddy config
 * does not set, strip, or validate either header — so on a bare self-hosted
 * deployment a client can simply send one directly and the tally can be
 * gamed. That is an accepted trade-off for an approximate, unauthenticated,
 * no-PII reach counter (see README.md), not a security boundary. Regardless
 * of where the value came from, it is validated as ISO-3166 alpha-2 before
 * it goes anywhere near a sort key, and no IP is ever read, logged, or
 * stored here.
 *
 * Always answers 204, whether or not anything was counted. There is nothing
 * useful to tell the caller, and a uniform response means the endpoint can't
 * be used to probe what geo header value was actually received.
 */
export async function POST(request: NextRequest) {
  const country = request.headers.get("cf-ipcountry") ?? request.headers.get("x-geo-country");
  if (country) await recordCountryVisit(country);
  return new NextResponse(null, { status: 204 });
}
