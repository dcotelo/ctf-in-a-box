import "server-only";
import { auth } from "@/lib/auth";
import { eventConfig } from "@/lib/event-config";
import { listStoredAdmins } from "@/lib/admin-admins";

/** Admins baked into the image from `event.yaml`. These are the BOOTSTRAP
 *  identities: they always authorize, they cannot be revoked through the
 *  panel, and they are the recovery path if a runtime grant goes wrong or
 *  Redis is empty. Changing them needs a rebuild — which is the whole reason
 *  runtime grants exist (issue #147). */
const bakedAdmins = new Set(eventConfig.admins.map((a) => a.toLowerCase()));

/** True for a login baked into the image. Synchronous and Redis-free, so it
 *  is safe anywhere — including the paths that only need "is this the
 *  organizer" for display. */
export function isBakedAdmin(login: string | undefined): boolean {
  return typeof login === "string" && bakedAdmins.has(login.toLowerCase());
}

/** Baked admins, lowercased. The panel needs them to mark which rows it must
 *  refuse to remove. */
export function listBakedAdmins(): string[] {
  return [...bakedAdmins].sort();
}

/**
 * True when `login` is an admin — baked into the image OR granted at runtime.
 *
 * FAILS CLOSED. A Redis error propagates rather than resolving false-y by
 * accident, and `requireAdmin` turns it into a 403. This is deliberately the
 * OPPOSITE of `effectivePaused`'s read in admin-store, which fails OPEN so a
 * Redis blip cannot drop live submissions: that one is a safety switch whose
 * failure should not stop an event, and this one is an access check whose
 * failure must not grant access. Both behaviours are correct; they differ
 * because the cost of being wrong differs.
 *
 * A baked admin short-circuits before Redis is touched, so the organizer can
 * still get in when the datastore is down — which is exactly when they most
 * need the panel.
 */
export async function isAdminLogin(login: string | undefined): Promise<boolean> {
  if (typeof login !== "string" || login === "") return false;
  if (isBakedAdmin(login)) return true;
  const stored = await listStoredAdmins();
  return stored.includes(login.toLowerCase());
}

export async function requireAdmin(
  headers: Headers,
): Promise<{ ok: true; login: string } | { ok: false; status: 401 | 403 }> {
  const session = await auth.api.getSession({ headers });
  if (!session) return { ok: false, status: 401 };
  const login = (session.user as { login?: string }).login;
  if (typeof login !== "string" || login === "") return { ok: false, status: 403 };
  if (isBakedAdmin(login)) return { ok: true, login };
  let stored: string[];
  try {
    stored = await listStoredAdmins();
  } catch {
    // Fail closed: an unreachable datastore denies, it does not grant. The
    // baked check above already ran, so an organizer listed in event.yaml is
    // unaffected by this branch.
    return { ok: false, status: 403 };
  }
  if (!stored.includes(login.toLowerCase())) return { ok: false, status: 403 };
  return { ok: true, login };
}
