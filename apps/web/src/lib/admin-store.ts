import "server-only";
import { upstashEval, upstashPipeline } from "@/lib/upstash";

export const ADMIN_SETTINGS_KEY = "ctf:admin:settings";
export const ADMIN_AUDIT_KEY = "ctf:admin:audit";
export const SYNC_STATUS_KEY = "ctf:sync:status";
export const AUDIT_CAP = 500;
export const HINT_COST_MAX = 100000;

export type AdminSettings = {
  paused: boolean;
  hintsEnabled: boolean | null;
  hintCost: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type SyncStatus = {
  lastPollAt: string | null;
  lastError: string | null;
  ingested: number;
  reposPolled: number;
  paused: boolean;
};

export type SettingsPatch = { paused?: boolean; hintsEnabled?: boolean; hintCost?: number };

export class AdminValidationError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "AdminValidationError";
    this.field = field;
  }
}

function flatToObject(flat: unknown): Record<string, string> {
  const arr = Array.isArray(flat) ? (flat as string[]) : [];
  const obj: Record<string, string> = {};
  for (let i = 0; i < arr.length; i += 2) obj[arr[i]] = arr[i + 1];
  return obj;
}

export async function getAdminSettings(): Promise<AdminSettings> {
  const [res] = await upstashPipeline([["HGETALL", ADMIN_SETTINGS_KEY]]);
  const h = flatToObject(res.result);
  return {
    paused: h.paused === "1",
    hintsEnabled: h.hintsEnabled === undefined ? null : h.hintsEnabled === "1",
    hintCost: h.hintCost === undefined ? null : Number(h.hintCost),
    updatedBy: h.updatedBy ?? null,
    updatedAt: h.updatedAt ?? null,
  };
}

export async function getSyncStatus(): Promise<SyncStatus | null> {
  const [res] = await upstashPipeline([["HGETALL", SYNC_STATUS_KEY]]);
  const h = flatToObject(res.result);
  if (Object.keys(h).length === 0) return null;
  return {
    lastPollAt: h.lastPollAt ?? null,
    lastError: h.lastError ?? null,
    ingested: Number(h.ingested ?? 0),
    reposPolled: Number(h.reposPolled ?? 0),
    paused: h.paused === "1",
  };
}

// HSET the changed fields + updatedBy/updatedAt, LPUSH one audit line, LTRIM the
// list — one atomic script so a change can never land without its audit record.
// ARGV: [1]=updatedBy [2]=updatedAt [3]=auditLine [4]=cap-1 [5..]=field,value pairs
const UPDATE_SCRIPT = `
redis.call('HSET', KEYS[1], 'updatedBy', ARGV[1], 'updatedAt', ARGV[2])
for i = 5, #ARGV, 2 do redis.call('HSET', KEYS[1], ARGV[i], ARGV[i+1]) end
redis.call('LPUSH', KEYS[2], ARGV[3])
redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[4]))
return redis.call('HGETALL', KEYS[1])`;

export async function updateAdminSettings(patch: SettingsPatch, actor: string): Promise<AdminSettings> {
  const keys = Object.keys(patch);
  if (keys.length === 0) throw new AdminValidationError("patch", "empty patch");
  const fields: string[] = [];
  const changed: Record<string, boolean | number> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === "paused" || k === "hintsEnabled") {
      if (typeof v !== "boolean") throw new AdminValidationError(k, `${k} must be a boolean`);
      fields.push(k, v ? "1" : "0");
      changed[k] = v;
    } else if (k === "hintCost") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > HINT_COST_MAX) {
        throw new AdminValidationError(k, `hintCost must be an integer in [0, ${HINT_COST_MAX}]`);
      }
      fields.push(k, String(v));
      changed[k] = v;
    } else {
      throw new AdminValidationError(k, `unknown setting: ${k}`);
    }
  }
  const at = new Date().toISOString();
  const audit = JSON.stringify({ at, by: actor, changed });
  const result = await upstashEval(
    UPDATE_SCRIPT,
    [ADMIN_SETTINGS_KEY, ADMIN_AUDIT_KEY],
    [actor, at, audit, String(AUDIT_CAP - 1), ...fields],
  );
  const h = flatToObject(result);
  return {
    paused: h.paused === "1",
    hintsEnabled: h.hintsEnabled === undefined ? null : h.hintsEnabled === "1",
    hintCost: h.hintCost === undefined ? null : Number(h.hintCost),
    updatedBy: h.updatedBy ?? null,
    updatedAt: h.updatedAt ?? null,
  };
}
