// The event dates line, derived from two ISO instant bounds instead of the
// old event.yaml `dates:` free-text string. Pure and client-safe: no
// `server-only`, no `process.env`.
//
// Formatting is pinned to UTC (`timeZone: "UTC"`) rather than the host's
// local zone so this is deterministic under test regardless of where it
// runs — the trade-off is that a bound just after local midnight in a
// negative-UTC-offset zone can print the previous calendar day. Accepted for
// now; callers wanting local-zone display need a different helper.

const FULL_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** Parses an ISO instant, or returns `null` for a missing/unparseable one —
 *  a malformed bound is treated the same as an absent one rather than
 *  surfacing "Invalid Date" text. */
function parseInstant(iso: string | null): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The dates line for the landing page / admin panel: "Oct 1, 2026" for a
 * single day, "Oct 1 – Oct 3, 2026" within one year, "Dec 31, 2026 – Jan 2,
 * 2027" across years, "From Oct 1, 2026" / "Until Oct 3, 2026" for an
 * open-ended bound, and "" when neither bound parses.
 */
export function formatDateRange(start: string | null, end: string | null): string {
  const startDate = parseInstant(start);
  const endDate = parseInstant(end);

  if (!startDate && !endDate) return "";
  if (startDate && !endDate) return `From ${FULL_DATE.format(startDate)}`;
  if (!startDate && endDate) return `Until ${FULL_DATE.format(endDate)}`;

  const startFull = FULL_DATE.format(startDate as Date);
  const endFull = FULL_DATE.format(endDate as Date);
  if (startFull === endFull) return startFull;

  const sameYear = (startDate as Date).getUTCFullYear() === (endDate as Date).getUTCFullYear();
  const startHalf = sameYear ? MONTH_DAY.format(startDate as Date) : startFull;
  return `${startHalf} – ${endFull}`;
}
