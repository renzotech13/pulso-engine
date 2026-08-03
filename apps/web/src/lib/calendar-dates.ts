/**
 * Pure date-math helpers for the /calendar month grid + list views — no DB,
 * no React. Weeks start Monday (LatAm convention).
 */

export interface MonthParam {
  year: number;
  month: number; // 1-12
}

const MONTH_PARAM_RE = /^(\d{4})-(\d{2})$/;

export function parseMonthParam(raw?: string): MonthParam {
  const match = raw ? MONTH_PARAM_RE.exec(raw) : null;
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) return { year, month };
  }
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

export function monthParamString({ year, month }: MonthParam): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function prevMonthParam({ year, month }: MonthParam): MonthParam {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function nextMonthParam({ year, month }: MonthParam): MonthParam {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** First/last day of the month as YYYY-MM-DD strings. */
export function monthBounds({ year, month }: MonthParam): { start: string; end: string } {
  const start = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${pad2(month)}-${pad2(lastDay)}`;
  return { start, end };
}

export interface MonthGridCell {
  date: string; // YYYY-MM-DD
  inMonth: boolean;
}

/**
 * 6x7 grid (42 cells) covering the full month plus leading/trailing filler
 * days from adjacent months, so every week row is complete. Monday-start.
 */
export function buildMonthGrid({ year, month }: MonthParam): MonthGridCell[] {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay(): 0=Sun..6=Sat: convert to Monday-start offset (0=Mon..6=Sun).
  const mondayOffset = (firstOfMonth.getUTCDay() + 6) % 7;
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(gridStart.getUTCDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setUTCDate(d.getUTCDate() + i);
    return {
      date: d.toISOString().slice(0, 10),
      inMonth: d.getUTCMonth() === month - 1 && d.getUTCFullYear() === year,
    };
  });
}

export function monthLabel({ year, month }: MonthParam): string {
  const date = new Date(Date.UTC(year, month - 1, 1));
  const label = new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    date,
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}
