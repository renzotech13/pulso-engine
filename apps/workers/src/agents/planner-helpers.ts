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

/**
 * The Monday (YYYY-MM-DD) of the calendar week `dateStr` falls in — a stable
 * grouping key for "same week", not a real ISO week number (nothing here
 * needs the actual week-of-year, just a consistent bucket per Mon-Sun span).
 */
export function weekStartDate(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const day = date.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return formatDate(date);
}

/**
 * Downgrades a proposed carousel to a plain post once its calendar week has
 * already used up `maxWeeklyCarousels` — carousels are the one slot type
 * that costs several Gemini calls (one per slide) instead of at most one, so
 * a tenant that wants that cost bounded needs it enforced here, not just
 * asked for in the prompt: the Planner's own doc comment already says never
 * to trust the model's proposals blindly, and slot_type is no exception.
 *
 * `alreadyScheduled` seeds each week's count from carousels a PREVIOUS
 * planner run (or a human) already placed, so a fresh run doesn't stack more
 * on top of a week that's already at its cap. `maxWeeklyCarousels` of
 * `undefined` means uncapped (the tenant's `publish_hours`-style default),
 * and passes every carousel through unchanged.
 */
export function applyWeeklyCarouselCap<T extends { date: string; slot_type: string }>(
  proposedSlots: readonly T[],
  alreadyScheduled: readonly { date: string; slot_type: string }[],
  maxWeeklyCarousels: number | undefined,
): T[] {
  if (maxWeeklyCarousels === undefined) return [...proposedSlots];

  const countByWeek = new Map<string, number>();
  for (const slot of alreadyScheduled) {
    if (slot.slot_type !== "carousel") continue;
    const week = weekStartDate(slot.date);
    countByWeek.set(week, (countByWeek.get(week) ?? 0) + 1);
  }

  return proposedSlots.map((slot) => {
    if (slot.slot_type !== "carousel") return slot;

    const week = weekStartDate(slot.date);
    const countSoFar = countByWeek.get(week) ?? 0;
    if (countSoFar >= maxWeeklyCarousels) {
      return { ...slot, slot_type: "post" };
    }
    countByWeek.set(week, countSoFar + 1);
    return slot;
  });
}

/**
 * Same never-trust-the-model posture as applyWeeklyCarouselCap: while
 * tenants.reels_paused is on ("hasta nuevo aviso" — open reel bugs being
 * fixed), no new slot the Planner proposes should be a reel, prompt hint or
 * not. Existing already-approved reel slots are handled separately, at
 * generation time in creative.ts, since they were placed before the pause.
 */
export function applyReelsPause<T extends { slot_type: string }>(
  proposedSlots: readonly T[],
  reelsPaused: boolean,
): T[] {
  if (!reelsPaused) return [...proposedSlots];
  return proposedSlots.map((slot) => (slot.slot_type === "reel" ? { ...slot, slot_type: "post" } : slot));
}
