/**
 * Pure functions used by the Planner — kept separate from planner.ts (which
 * needs the DB/LLM) so gap detection and ephemeris resolution can be unit
 * tested without a database or a running LM Studio server.
 */

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function atMidnightUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Every YYYY-MM-DD in [today, today+horizonDays) that isn't in `filledDates`. */
export function computeOpenDates(
  today: Date,
  horizonDays: number,
  filledDates: ReadonlySet<string>,
): string[] {
  const start = atMidnightUtc(today);
  const open: string[] = [];

  for (let i = 0; i < horizonDays; i++) {
    const candidate = new Date(start);
    candidate.setUTCDate(candidate.getUTCDate() + i);
    const dateStr = formatDate(candidate);
    if (!filledDates.has(dateStr)) open.push(dateStr);
  }

  return open;
}

export interface EphemerisLike {
  name: string;
  date: string;
  is_recurring_annually: boolean;
  relevance_tags: string[];
}

export interface ResolvedEphemeris {
  name: string;
  date: string;
}

/**
 * Resolves each ephemeris to a concrete date within [today, today+horizonDays)
 * and filters by rubro relevance. Recurring ones (fixed month/day, e.g.
 * Christmas) are checked against this year and next year's occurrence;
 * non-recurring ones (pre-resolved floating dates, e.g. "Día de la Madre
 * 2027-05-09") are checked as-is.
 */
export function resolveEphemeridesInWindow(
  ephemerides: readonly EphemerisLike[],
  today: Date,
  horizonDays: number,
  rubro: string | null,
): ResolvedEphemeris[] {
  const windowStart = atMidnightUtc(today);
  const windowEnd = new Date(windowStart);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + horizonDays - 1);

  const resolved: ResolvedEphemeris[] = [];

  for (const ephemeris of ephemerides) {
    const isRelevant =
      ephemeris.relevance_tags.includes("general") ||
      (rubro !== null && ephemeris.relevance_tags.includes(rubro));
    if (!isRelevant) continue;

    if (ephemeris.is_recurring_annually) {
      const [, monthStr, dayStr] = ephemeris.date.split("-");
      const month = Number(monthStr) - 1;
      const day = Number(dayStr);

      for (const year of [windowStart.getUTCFullYear(), windowStart.getUTCFullYear() + 1]) {
        const candidate = new Date(Date.UTC(year, month, day));
        if (candidate >= windowStart && candidate <= windowEnd) {
          resolved.push({ name: ephemeris.name, date: formatDate(candidate) });
        }
      }
    } else {
      const candidate = new Date(`${ephemeris.date}T00:00:00Z`);
      if (candidate >= windowStart && candidate <= windowEnd) {
        resolved.push({ name: ephemeris.name, date: ephemeris.date });
      }
    }
  }

  return resolved;
}
