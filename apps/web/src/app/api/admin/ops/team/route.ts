import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  OpsValidationError,
  forceDisbandTeam,
  forceRemoveFromTeam,
  forceTransferCaptain,
} from "@/lib/admin-ops-store";

/**
 * Per-team support operations (issue #168).
 *
 *   POST   {slug, action:"remove-member"|"transfer-captain", login}
 *   DELETE {slug}   disband
 *
 * These are the captain-only actions in `team-store.ts`, available to an
 * organizer. They exist because the captain-only path is blocked *exactly*
 * when the captain is unreachable, which is when support is needed: a team
 * whose captain has vanished cannot rename, remove a member, regenerate its
 * code, or disband, and nothing else can rescue it.
 *
 * Unlike the contestant routes, the acting login is NOT the subject — an
 * organizer acts on a team they are not a member of. The store's scripts still
 * verify the team exists and the target is a member in the same atomic step as
 * the write, so an admin override is not the one path that races with a
 * contestant clicking Leave.
 */

function fail(err: unknown, label: string) {
  if (err instanceof OpsValidationError) {
    return NextResponse.json({ error: err.message, field: err.field }, { status: 400 });
  }
  console.error(`[admin/ops/team] ${label} failed`, err);
  return NextResponse.json({ error: "unavailable" }, { status: 503 });
}

export async function POST(request: Request) {
  const gate = await requireAdmin(request.headers);
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  let body: { slug?: unknown; login?: unknown; action?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.slug !== "string" || typeof body.login !== "string") {
    return NextResponse.json({ error: "slug and login must be strings" }, { status: 400 });
  }

  try {
    if (body.action === "remove-member") {
      return NextResponse.json(await forceRemoveFromTeam(body.slug, body.login, gate.login));
    }
    if (body.action === "transfer-captain") {
      return NextResponse.json(await forceTransferCaptain(body.slug, body.login, gate.login));
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return fail(err, String(body.action));
  }
}

export async function DELETE(request: Request) {
  const gate = await requireAdmin(request.headers);
  if (!gate.ok) return NextResponse.json({ error: "forbidden" }, { status: gate.status });

  let body: { slug?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.slug !== "string") {
    return NextResponse.json({ error: "slug must be a string" }, { status: 400 });
  }

  try {
    return NextResponse.json(await forceDisbandTeam(body.slug, gate.login));
  } catch (err) {
    return fail(err, "disband");
  }
}
