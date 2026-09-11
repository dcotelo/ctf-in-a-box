// Which of the six targets this event runs (issue #386, PR 2). Stored in
// ctf:admin:settings as `secureDevTargets` (a JSON array of ids), edited on the
// admin Secure Development tab, read per request by lib/enabled-apps.ts and
// per tick by the sync poller. Client-safe on purpose: the admin tab reads the
// catalogue and default from here.
import { apps, type AppId } from "@/lib/apps";

export const TARGET_IDS: readonly AppId[] = apps.map((a) => a.id);
/** Spec §2: the default is every target — a fresh box runs all six. */
export const DEFAULT_SECURE_DEV_TARGETS: readonly AppId[] = TARGET_IDS;
export const SECURE_DEV_TARGETS_MESSAGE = `secureDevTargets must name at least one of: ${TARGET_IDS.join(", ")}`;

const ID_SET = new Set<string>(TARGET_IDS);
export function isAppId(v: unknown): v is AppId {
  return typeof v === "string" && ID_SET.has(v);
}

/** Known ids only, deduplicated, in catalogue order; null when nothing survives. */
function normalizeList(list: unknown[]): AppId[] | null {
  const wanted = new Set(list.filter(isAppId));
  const ordered = TARGET_IDS.filter((id) => wanted.has(id));
  return ordered.length > 0 ? ordered : null;
}

export function normalizeSecureDevTargets(raw: string | undefined): AppId[] | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return Array.isArray(parsed) ? normalizeList(parsed) : null;
}

export type TargetsCheck = { ok: true; value: AppId[] } | { ok: false; message: string };

export function checkSecureDevTargets(v: unknown): TargetsCheck {
  if (!Array.isArray(v) || v.length === 0 || !v.every(isAppId)) return { ok: false, message: SECURE_DEV_TARGETS_MESSAGE };
  const value = normalizeList(v);
  return value ? { ok: true, value } : { ok: false, message: SECURE_DEV_TARGETS_MESSAGE };
}
