import { NextResponse, type NextRequest } from "next/server";
import { recordCountryVisit } from "@/lib/dynamo-stats";

/**
 * Bumps the aggregate per-country reach counter by one.
 *
 * The country is read from Vercel's edge geo header and NEVER from the request
 * body — the client has no say in what gets counted, and the value is
 * validated as ISO-3166 alpha-2 before it goes anywhere near a sort key. The
 * IP that Vercel derived the country from is not read here, not logged, and
 * not stored.
 *
 * Always answers 204, whether or not anything was counted. There is nothing
 * useful to tell the caller, and a uniform response means the endpoint can't
 * be used to probe what geo the edge assigned you.
 */
export async function POST(request: NextRequest) {
  const country = request.headers.get("x-vercel-ip-country");
  if (country) await recordCountryVisit(country);
  return new NextResponse(null, { status: 204 });
}
