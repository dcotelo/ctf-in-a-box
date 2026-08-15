import "server-only";
import { auth } from "@/lib/auth";
import { eventConfig } from "@/lib/event-config";

const adminSet = new Set(eventConfig.admins.map((a) => a.toLowerCase()));

export function isAdminLogin(login: string | undefined): boolean {
  return typeof login === "string" && adminSet.has(login.toLowerCase());
}

export async function requireAdmin(
  headers: Headers,
): Promise<{ ok: true; login: string } | { ok: false; status: 401 | 403 }> {
  const session = await auth.api.getSession({ headers });
  if (!session) return { ok: false, status: 401 };
  const login = (session.user as { login?: string }).login;
  if (!isAdminLogin(login)) return { ok: false, status: 403 };
  return { ok: true, login: login as string };
}
