import { describe, expect, it } from "vitest";
import { formatCompact, getRemaining, type Remaining } from "@/lib/countdown";

const AT = Date.parse("2026-08-19T12:00:00.000Z");
const at = (ms: number) => getRemaining(AT + ms, AT);

describe("getRemaining", () => {
  it("splits the gap into days, hours, minutes and seconds", () => {
    expect(at(2 * 86400_000 + 3 * 3600_000 + 4 * 60_000 + 5_000)).toEqual({
      days: 2,
      hours: 3,
      minutes: 4,
      seconds: 5,
    });
  });

  it("returns null once the target has passed", () => {
    expect(at(-1)).toBeNull();
  });

  // The boundary a cooldown actually lands on: at exactly the retry instant
  // the wait is over, so this must be null and not a zeroed struct — a caller
  // rendering "0s" would tell a contestant to keep waiting when they can go.
  it("returns null at exactly the target instant", () => {
    expect(at(0)).toBeNull();
  });

  it("returns null for an unparseable target rather than NaN fields", () => {
    expect(getRemaining(Number.NaN, AT)).toBeNull();
  });

  it("floors partial seconds instead of rounding up", () => {
    expect(at(1_999)?.seconds).toBe(1);
  });
});

describe("formatCompact", () => {
  const r = (partial: Partial<Remaining>): Remaining => ({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    ...partial,
  });

  it("shows bare seconds under a minute", () => {
    expect(formatCompact(r({ seconds: 45 }))).toBe("45s");
  });

  it("shows minutes and zero-padded seconds under an hour", () => {
    expect(formatCompact(r({ minutes: 4, seconds: 12 }))).toBe("4m 12s");
    expect(formatCompact(r({ minutes: 4, seconds: 2 }))).toBe("4m 02s");
  });

  it("shows hours and zero-padded minutes under a day", () => {
    expect(formatCompact(r({ hours: 1, minutes: 4 }))).toBe("1h 04m");
  });

  it("shows days and hours beyond a day", () => {
    expect(formatCompact(r({ days: 2, hours: 3, minutes: 59 }))).toBe("2d 3h");
  });

  // Never more than two units: the point is a glanceable "how long", not a
  // full duration readout.
  it("never renders more than two units", () => {
    const everything = r({ days: 1, hours: 2, minutes: 3, seconds: 4 });
    expect(formatCompact(everything).split(" ")).toHaveLength(2);
  });
});
