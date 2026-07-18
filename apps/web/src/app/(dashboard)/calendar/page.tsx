import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestCalendarRegenerationAction, updateCalendarSlotAction } from "@/lib/actions";

const HORIZON_DAYS = 30;

function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function CalendarPage() {
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const today = new Date().toISOString().slice(0, 10);
  const horizonEnd = addDays(today, HORIZON_DAYS - 1);

  const { data: slots } = await supabase
    .from("content_calendar")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .gte("date", today)
    .lte("date", horizonEnd)
    .order("date");

  const slotsByDate = new Map((slots ?? []).map((slot) => [slot.date, slot]));
  const dates = Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(today, i));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Calendario — {ctx.tenantName}</h1>
        <form action={requestCalendarRegenerationAction}>
          <input type="hidden" name="tenantId" value={ctx.tenantId} />
          <button
            type="submit"
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium hover:bg-indigo-500"
          >
            Regenerar
          </button>
        </form>
      </div>

      <div className="space-y-1.5">
        {dates.map((date) => {
          const slot = slotsByDate.get(date);
          return (
            <form
              key={date}
              action={updateCalendarSlotAction}
              className="grid grid-cols-[90px_1fr_110px_110px_70px] items-center gap-2 rounded border border-neutral-800 p-2 text-sm"
            >
              <span className="text-neutral-400">{date}</span>
              {slot ? (
                <>
                  <input type="hidden" name="slotId" value={slot.id} />
                  <input
                    name="theme"
                    defaultValue={slot.theme}
                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
                  />
                  <select
                    name="slotType"
                    defaultValue={slot.slot_type}
                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
                  >
                    <option value="post">post</option>
                    <option value="carousel">carousel</option>
                    <option value="story">story</option>
                    <option value="reel">reel</option>
                  </select>
                  <select
                    name="status"
                    defaultValue={slot.status}
                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
                  >
                    <option value="draft">draft</option>
                    <option value="approved">approved</option>
                    <option value="skipped">skipped</option>
                  </select>
                  <button
                    type="submit"
                    className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700"
                  >
                    Guardar
                  </button>
                </>
              ) : (
                <span className="col-span-4 text-neutral-600">sin contenido planificado</span>
              )}
            </form>
          );
        })}
      </div>
    </div>
  );
}
