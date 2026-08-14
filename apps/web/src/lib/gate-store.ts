import "server-only";
import { upstashEval, upstashPipeline } from "@/lib/upstash";

/**
 * Brute-force throttle for the challenges gate, one Redis hash per client IP.
 * Five failed password attempts lock the IP for 24 hours.
 *
 * `gate:attempts:<ip>` holds `failures` and `lastFailAt` (epoch ms) and
 * carries a 30-day EXPIRE, refreshed on every charged attempt, as a retention
 * bound on the IP address it holds — not the lock mechanism. Unlike DynamoDB
 * TTL (best-effort, reaped within ~48h), Redis EXPIRE deletes the key exactly
 * on schedule, so the /privacy promise ("expires automatically after 30
 * days") is now literal rather than approximate. The 24h lock window is still
 * enforced on read regardless — an expired window is treated as a fresh
 * start — so the throttle stays correct even if that were not true.
 *
 * consumeGateAttempt deliberately THROWS on transport errors: the caller
 * fails closed (500), so an Upstash outage can never disable the throttle.
 *
 * ORDERING IS THE WHOLE POINT. The attempt is charged BEFORE the password is
 * compared, and the charge-and-decide is a single Lua EVAL — Redis executes
 * a script as one atomic step, so a burst of concurrent same-IP requests
 * serialises on that script rather than all reading the same pre-burst
 * counter and all reaching the compare.
 */

export const GATE_MAX_FAILURES = 5;
export const GATE_LOCK_MS = 24 * 60 * 60 * 1000;
/** Retention bound for the IP address held in a throttle key, as seconds —
 *  what Redis EXPIRE wants. Exported so the retention window is directly
 *  testable. Deliberately longer than the lock window, so a live lock can
 *  never outlive its key. */
export const GATE_TTL_SECONDS = 30 * 24 * 60 * 60;

const gateKey = (ip: string) => `gate:attempts:${ip}`;

export type GateThrottle = { failures: number; lastFailAt: number } | null;

/** Diagnostic read, not on the hot path (consumeGateAttempt is self-contained
 *  in its Lua script) — kept for the same visibility the DynamoDB store had. */
export async function getGateThrottle(ip: string): Promise<GateThrottle> {
  const [res] = await upstashPipeline([["HMGET", gateKey(ip), "failures", "lastFailAt"]]);
  if (res.error) throw new Error(`Upstash HMGET failed: ${res.error}`);
  const [failures, lastFailAt] = Array.isArray(res.result) ? (res.result as (string | null)[]) : [null, null];
  if (failures == null || lastFailAt == null) return null;
  return { failures: Number(failures), lastFailAt: Number(lastFailAt) };
}

/** Seconds until the lock lifts; 0 = not locked. Pure so the lock math is
 *  directly testable. */
export function gateLockRemainingSeconds(throttle: GateThrottle, now: number): number {
  if (!throttle || throttle.failures < GATE_MAX_FAILURES) return 0;
  const liftAt = throttle.lastFailAt + GATE_LOCK_MS;
  return now < liftAt ? Math.ceil((liftAt - now) / 1000) : 0;
}

export type GateVerdict =
  /** Budget was charged. The caller may now compare the password. */
  | { allowed: true }
  /** Locked out. Never let the caller compare. */
  | { allowed: false; retryAfterSeconds: number };

// KEYS[1] = gate:attempts:<ip>
// ARGV[1] = now (epoch ms)     ARGV[2] = windowStart (now - GATE_LOCK_MS)
// ARGV[3] = GATE_MAX_FAILURES  ARGV[4] = GATE_TTL_SECONDS
//
// A window whose last failure is at or before windowStart has already lapsed
// (matches gateLockRemainingSeconds: liftAt <= now), so it restarts at zero
// before the cap is checked — an attacker who waits out the lock always gets
// a fresh budget rather than being denied by a stale counter.
const CONSUME_SCRIPT = `
local failures = tonumber(redis.call('HGET', KEYS[1], 'failures') or '0')
local lastFailAt = tonumber(redis.call('HGET', KEYS[1], 'lastFailAt') or '0')
if lastFailAt <= tonumber(ARGV[2]) then
  failures = 0
end
if failures >= tonumber(ARGV[3]) then
  return {0, failures, lastFailAt}
end
failures = failures + 1
redis.call('HSET', KEYS[1], 'failures', failures, 'lastFailAt', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return {1, failures, tonumber(ARGV[1])}`;

/**
 * Charge one attempt against this IP's budget and say whether the caller may
 * proceed to the password compare. Atomic: the read, the window-restart
 * decision, and the write are one Lua EVAL, so concurrent requests serialise
 * on Redis's single-threaded script execution rather than racing.
 *
 * Note the caller is charged for a SUCCESSFUL attempt too — the compare has
 * not happened yet and cannot, without reintroducing the race. The successful
 * caller's budget is returned by clearGateThrottle, and it leaves holding a
 * 30-day unlock cookie either way. See the route for why that is survivable.
 */
export async function consumeGateAttempt(ip: string, now: number): Promise<GateVerdict> {
  const windowStart = now - GATE_LOCK_MS;
  const raw = await upstashEval(
    CONSUME_SCRIPT,
    [gateKey(ip)],
    [now, windowStart, GATE_MAX_FAILURES, GATE_TTL_SECONDS],
  );
  const [allowed, failures, lastFailAt] = Array.isArray(raw) ? (raw as [number, number, number]) : [0, 0, 0];
  if (allowed === 1) return { allowed: true };
  // Clamp to 1: the script only denies inside a live window, so zero here
  // would be a contradiction, and Retry-After: 0 reads as "retry now".
  const retryAfterSeconds = Math.max(
    1,
    gateLockRemainingSeconds({ failures: Number(failures), lastFailAt: Number(lastFailAt) }, now),
  );
  return { allowed: false, retryAfterSeconds };
}

/**
 * Return the budget after a successful unlock. Best-effort by contract — a
 * failed delete must never block the 200 — but it matters more than it used
 * to, because attempts are now charged before the compare. Someone who typos
 * four times and gets it right on the fifth has spent the whole budget; if
 * this delete does not land, that IP is at the cap holding the correct
 * password. Hence the retry.
 *
 * Even in the worst case they are not locked out of anything they need right
 * now: the 200 that follows carries a 30-day unlock cookie. The cost is that a
 * SECOND unlock from that IP (another device, a cleared cookie) is refused
 * until the window lapses.
 *
 * Returns whether the key is gone, so the caller can log the difference.
 */
export async function clearGateThrottle(ip: string): Promise<boolean> {
  const key = gateKey(ip);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const [res] = await upstashPipeline([["DEL", key]]);
      if (res.error) throw new Error(res.error);
      return true;
    } catch (err) {
      if (attempt === 2) {
        console.error(`[gate] throttle clear failed after retry: ${(err as Error).message}`);
        return false;
      }
    }
  }
  return false;
}
