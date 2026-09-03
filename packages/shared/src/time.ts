/**
 * Everything Pulso Engine schedules (calendar dates, publish hours) is in
 * Peru time, but the services run on the machine's clock and `toISOString()`
 * returns UTC. Between 19:00 and midnight in Lima those two disagree: for
 * UTC it's already tomorrow. That made publish.tick treat TOMORROW's slots
 * as publishable five hours early.
 *
 * Peru has no DST, so "UTC-5" is always correct, but this still resolves it
 * through Intl rather than subtracting 5 hours by hand — if another country
 * ever shows up, this stays the right place to change.
 */
const LIMA_TIME_ZONE = "America/Lima";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: LIMA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: LIMA_TIME_ZONE,
  hour: "2-digit",
  hour12: false,
});

/** Today's date in Lima, as YYYY-MM-DD (which is exactly what en-CA formats). */
export function limaToday(now: Date = new Date()): string {
  return dateFormatter.format(now);
}

/** The current hour in Lima, 0-23. */
export function limaHour(now: Date = new Date()): number {
  // en-GB with hour12:false reports midnight as "24" on some runtimes.
  return Number(hourFormatter.format(now)) % 24;
}
