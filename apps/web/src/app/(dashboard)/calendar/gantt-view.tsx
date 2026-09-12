import Link from "next/link";
import type { MonthParam } from "@/lib/calendar-dates";
import { SLOT_TYPE, slotDisplayState, type SlotDisplayState } from "@/lib/labels";
import { DOT_CLASS, StatusDot } from "@/components/ui/status-badge";

const WEEKDAY_INITIALS = ["L", "M", "X", "J", "V", "S", "D"];

/** Only the fields the Gantt actually reads off a content_calendar row + its joined creative. */
export interface GanttSlot {
  id: string;
  date: string;
  slot_index: number;
  slot_type: string;
  theme: string;
  status: string;
  hold_publish: boolean;
  published_at: string | null;
  creative_id: string | null;
  creatives: { status: string } | null;
}

interface CalendarGanttViewProps {
  monthParam: MonthParam;
  today: string;
  slotsByDate: Map<string, GanttSlot[]>;
  publishHours: number[];
  legend: Map<SlotDisplayState["key"], SlotDisplayState>;
  monthStr: string;
  filterQuery: string;
}

function daysInMonth({ year, month }: MonthParam): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * A row per publish turn (slot_index), a column per day of the month. Reuses
 * the exact same query result and status vocabulary as the grid/list views —
 * this is just a third way of laying out the same data, not a new source of
 * truth. Blog posts, avatar videos and ad spend don't live in content_calendar
 * today, so they can't show up here; this only ever reflects what the
 * Planner/Creative/Publish loop actually tracks.
 */
export function CalendarGanttView({
  monthParam,
  today,
  slotsByDate,
  publishHours,
  legend,
  monthStr,
  filterQuery,
}: CalendarGanttViewProps) {
  const total = daysInMonth(monthParam);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const dateOf = (day: number) => `${monthParam.year}-${pad2(monthParam.month)}-${pad2(day)}`;
  const days = Array.from({ length: total }, (_, i) => i + 1);

  // At least one row for the main slot; extra rows only appear once
  // publish_hours grew or something has actually used that slot_index.
  const maxSlotIndex = Math.max(
    publishHours.length - 1,
    ...[...slotsByDate.values()].flatMap((daySlots) => daySlots.map((s) => s.slot_index)),
    0,
  );
  const rows = Array.from({ length: maxSlotIndex + 1 }, (_, i) => i);

  const stateOf = (slot: GanttSlot): SlotDisplayState => slotDisplayState(slot, slot.creatives, today);
  const columns = `88px repeat(${total}, minmax(24px, 1fr))`;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-card border border-line">
        <div className="min-w-[900px]">
          <div className="grid border-b border-line bg-surface" style={{ gridTemplateColumns: columns }}>
            <div />
            {days.map((day) => {
              const date = dateOf(day);
              const weekday = (new Date(Date.UTC(monthParam.year, monthParam.month - 1, day)).getUTCDay() + 6) % 7;
              const isWeekend = weekday >= 5;
              const isToday = date === today;
              return (
                <div
                  key={day}
                  className={`flex flex-col items-center gap-0.5 px-0.5 py-2 text-center ${
                    isToday ? "bg-accent/10" : ""
                  }`}
                >
                  <span className={`tnum text-xs ${isToday ? "font-semibold text-accent-ink" : "text-fg-2"}`}>
                    {day}
                  </span>
                  <span className={`text-[10px] ${isWeekend ? "text-fg-2" : "text-fg-3"}`}>
                    {WEEKDAY_INITIALS[weekday]}
                  </span>
                </div>
              );
            })}
          </div>

          {rows.map((rowIndex) => (
            <div
              key={rowIndex}
              className="grid border-b border-line last:border-b-0"
              style={{ gridTemplateColumns: columns }}
            >
              <div className="flex flex-col justify-center gap-0.5 border-r border-line px-2 py-2">
                <span className="text-xs font-medium text-fg-2">
                  {publishHours[rowIndex] !== undefined ? `${publishHours[rowIndex]}h` : `Turno ${rowIndex + 1}`}
                </span>
                <span className="eyebrow text-[9px] text-fg-3">{rowIndex === 0 ? "Principal" : "Extra"}</span>
              </div>
              {days.map((day) => {
                const date = dateOf(day);
                const isToday = date === today;
                const slot = (slotsByDate.get(date) ?? []).find((s) => s.slot_index === rowIndex);
                const isOpenTurn = date >= today && publishHours[rowIndex] !== undefined;

                return (
                  <div
                    key={day}
                    className={`flex items-center justify-center px-0.5 py-2 ${isToday ? "bg-accent/5" : ""}`}
                  >
                    {slot ? (
                      <Link
                        href={`/calendar/${date}?month=${monthStr}&view=gantt${filterQuery}`}
                        title={`${date} · ${SLOT_TYPE[slot.slot_type] ?? slot.slot_type}: ${slot.theme} — ${
                          stateOf(slot).label
                        }`}
                        aria-label={`${date}: ${slot.theme}`}
                        className={`block h-5 w-full rounded transition-opacity duration-150 hover:opacity-80 ${
                          DOT_CLASS[stateOf(slot).tone]
                        }`}
                      />
                    ) : isOpenTurn ? (
                      <span
                        className="h-5 w-full rounded border border-dashed border-line-2"
                        title={`${date} · turno libre`}
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {legend.size > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-3">
          {[...legend.values()].map((state) => (
            <span key={state.key} className="inline-flex items-center gap-1.5">
              <StatusDot tone={state.tone} />
              {state.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
