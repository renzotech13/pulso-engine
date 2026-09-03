import Link from "next/link";
import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  approveCreativeAction,
  regenerateCreativeAction,
  requestCalendarRegenerationAction,
  requestPublishAction,
  updateCalendarSlotAction,
} from "@/lib/actions";
import {
  buildMonthGrid,
  monthBounds,
  monthLabel,
  monthParamString,
  nextMonthParam,
  parseMonthParam,
  prevMonthParam,
} from "@/lib/calendar-dates";

const RENDER_TEMPLATES_URL = process.env.NEXT_PUBLIC_RENDER_TEMPLATES_URL ?? "http://localhost:3001";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

type View = "grid" | "list";

interface CalendarPageProps {
  searchParams: Promise<{ month?: string; view?: string }>;
}

function statusDotClass(creative: { status: string } | null, slotStatus: string): string {
  if (!creative) return slotStatus === "approved" ? "bg-pulso-primary" : "bg-neutral-700";
  if (creative.status === "failed") return "bg-status-pink";
  if (creative.status === "approved") return "bg-emerald-400";
  return "bg-amber-400";
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const sp = await searchParams;
  const monthParam = parseMonthParam(sp.month);
  const view: View = sp.view === "list" ? "list" : "grid";
  const monthStr = monthParamString(monthParam);
  const prevStr = monthParamString(prevMonthParam(monthParam));
  const nextStr = monthParamString(nextMonthParam(monthParam));
  const { start, end } = monthBounds(monthParam);

  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const { data: slots } = await supabase
    .from("content_calendar")
    .select(
      "*, creatives!content_calendar_creative_id_fkey(type, status, asset_urls, publications(platform, status, error_message))",
    )
    .eq("tenant_id", ctx.tenantId)
    .gte("date", start)
    .lte("date", end)
    .order("date")
    .order("slot_index");

  // A day can hold more than one slot now that a tenant can publish several
  // times a day (see `tenants.publish_hours`), so the date alone no longer
  // identifies a publication.
  const slotsByDate = new Map<string, NonNullable<typeof slots>>();
  for (const slot of slots ?? []) {
    const daySlots = slotsByDate.get(slot.date);
    if (daySlots) daySlots.push(slot);
    else slotsByDate.set(slot.date, [slot]);
  }
  const grid = buildMonthGrid(monthParam);
  const listDates = grid.filter((cell) => cell.inMonth).map((cell) => cell.date);

  const viewLinkClass = (active: boolean) =>
    active
      ? "rounded-lg bg-pulso-primary px-3 py-1.5 text-sm font-medium text-white"
      : "rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-neutral-400 hover:border-pulso-accent/60 hover:text-neutral-200";

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 font-display text-xs uppercase tracking-[0.2em] text-pulso-accent">
          Cronograma
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-semibold">{ctx.tenantName}</h1>
          <form action={requestCalendarRegenerationAction}>
            <input type="hidden" name="tenantId" value={ctx.tenantId} />
            <button
              type="submit"
              className="rounded-lg bg-pulso-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent"
            >
              Regenerar
            </button>
          </form>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          El Planner llena ~30 días hacia adelante desde hoy — meses lejanos pueden verse vacíos
          hasta que se acerque la fecha.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/calendar?month=${prevStr}&view=${view}`}
            className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-neutral-400 hover:border-pulso-accent/60 hover:text-neutral-200"
          >
            ← Anterior
          </Link>
          <span className="font-display text-sm font-semibold text-neutral-200">
            {monthLabel(monthParam)}
          </span>
          <Link
            href={`/calendar?month=${nextStr}&view=${view}`}
            className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-neutral-400 hover:border-pulso-accent/60 hover:text-neutral-200"
          >
            Siguiente →
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <Link href={`/calendar?month=${monthStr}&view=grid`} className={viewLinkClass(view === "grid")}>
            Cuadrícula
          </Link>
          <Link href={`/calendar?month=${monthStr}&view=list`} className={viewLinkClass(view === "list")}>
            Lista
          </Link>
        </div>
      </div>

      {view === "grid" ? (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <div className="grid grid-cols-7 border-b border-ink-700 bg-ink-900">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wide text-neutral-500"
              >
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {grid.map((cell) => {
              const daySlots = slotsByDate.get(cell.date) ?? [];
              const soleCreative = daySlots.length === 1 ? daySlots[0]?.creatives ?? null : null;
              const dayNumber = Number(cell.date.slice(8, 10));
              const cellContent = (
                <div
                  className={`flex h-24 flex-col gap-1 border-b border-r border-ink-700 p-1.5 last:border-r-0 sm:h-28 ${
                    cell.inMonth ? "bg-ink-950" : "bg-ink-950/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs ${cell.inMonth ? "text-neutral-300" : "text-neutral-700"}`}>
                      {dayNumber}
                    </span>
                    <div className="flex items-center gap-1">
                      {daySlots.map((daySlot) => (
                        <span
                          key={daySlot.id}
                          className={`h-2 w-2 rounded-full ${statusDotClass(daySlot.creatives ?? null, daySlot.status)}`}
                        />
                      ))}
                    </div>
                  </div>
                  {cell.inMonth &&
                    daySlots.map((daySlot) => (
                      <p key={daySlot.id} className="line-clamp-1 text-[11px] leading-tight text-neutral-400">
                        {daySlot.publish_hour !== null && (
                          <span className="text-neutral-600">{daySlot.publish_hour}h </span>
                        )}
                        {daySlot.theme}
                      </p>
                    ))}
                  {/* The thumbnail only fits when the day has a single slot;
                      with two, the themes already fill the cell. */}
                  {soleCreative && soleCreative.asset_urls.length > 0 && cell.inMonth && (
                    <div className="mt-auto h-8 w-8 overflow-hidden rounded">
                      {soleCreative.type === "video" ? (
                        <video src={soleCreative.asset_urls[0]} className="h-full w-full object-cover" muted />
                      ) : (
                        <img src={soleCreative.asset_urls[0]} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                  )}
                </div>
              );

              // Every in-month day is clickable, even without a slot yet — the
              // detail page itself now handles the no-slot case (e.g. "Publicar
              // con marco" can create one), so gating the link on an existing
              // slot just made empty days unreachable for no reason.
              return cell.inMonth ? (
                <Link key={cell.date} href={`/calendar/${cell.date}?month=${monthStr}&view=grid`}>
                  {cellContent}
                </Link>
              ) : (
                <div key={cell.date}>{cellContent}</div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {listDates.flatMap((date) => {
            const daySlots = slotsByDate.get(date) ?? [];

            if (daySlots.length === 0) {
              return (
                <div key={date} className="rounded-xl border border-ink-700 bg-ink-900 p-3 text-sm">
                  <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                    <span className="text-neutral-500">{date}</span>
                    <span className="text-neutral-600">sin contenido planificado</span>
                  </div>
                </div>
              );
            }

            // One row per slot, not per day: with two daily publications the
            // date alone no longer says which one is meant, so each row
            // carries its hour alongside.
            return daySlots.map((slot) => {
              const creative = slot.creatives ?? null;

              return (
                <div key={slot.id} className="rounded-xl border border-ink-700 bg-ink-900 p-3 text-sm">
                <form
                  action={updateCalendarSlotAction}
                  className="grid grid-cols-[90px_1fr_110px_110px_70px] items-center gap-2"
                >
                  <span className="text-neutral-500">
                    {date}
                    {slot.publish_hour !== null && (
                      <span className="ml-1 text-neutral-600">{slot.publish_hour}h</span>
                    )}
                  </span>
                      <input type="hidden" name="slotId" value={slot.id} />
                      <input
                        name="theme"
                        defaultValue={slot.theme}
                        className="rounded-lg border border-ink-700 bg-ink-950 px-2 py-1 text-neutral-100"
                      />
                      <select
                        name="slotType"
                        defaultValue={slot.slot_type}
                        className="rounded-lg border border-ink-700 bg-ink-950 px-2 py-1 text-neutral-100"
                      >
                        <option value="post">post</option>
                        <option value="carousel">carousel</option>
                        <option value="story">story</option>
                        <option value="reel">reel</option>
                      </select>
                      <select
                        name="status"
                        defaultValue={slot.status}
                        className="rounded-lg border border-ink-700 bg-ink-950 px-2 py-1 text-neutral-100"
                      >
                        <option value="draft">draft</option>
                        <option value="approved">approved</option>
                        <option value="skipped">skipped</option>
                      </select>
                      <button
                        type="submit"
                        className="rounded-lg bg-ink-800 px-2 py-1 text-neutral-200 hover:bg-ink-700"
                      >
                        Guardar
                      </button>
                </form>

                {slot.creative_id &&
                  (creative?.status === "failed" ? (
                    <div className="mt-2 flex items-center gap-3 border-t border-ink-700 pt-2">
                      <span className="text-sm text-status-pink">⚠ Falló el render</span>
                      <form action={regenerateCreativeAction}>
                        <input type="hidden" name="creativeId" value={slot.creative_id} />
                        <input type="hidden" name="calendarSlotId" value={slot.id} />
                        <button
                          type="submit"
                          className="rounded-lg bg-ink-800 px-2 py-1 text-sm text-neutral-200 hover:bg-ink-700"
                        >
                          Regenerar
                        </button>
                      </form>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-ink-700 pt-2">
                      {creative?.type === "video" ? (
                        <video
                          src={`${RENDER_TEMPLATES_URL}/api/render/${slot.creative_id}.mp4`}
                          className="h-20 w-20 rounded object-cover"
                          muted
                          controls
                        />
                      ) : (
                        <img
                          src={`${RENDER_TEMPLATES_URL}/api/render/${slot.creative_id}.png`}
                          alt=""
                          className="h-20 w-20 rounded object-cover"
                        />
                      )}

                      {creative?.status === "approved" ? (
                        <span className="text-sm text-emerald-400">✓ Aprobado</span>
                      ) : (
                        <form action={approveCreativeAction}>
                          <input type="hidden" name="creativeId" value={slot.creative_id} />
                          <button
                            type="submit"
                            className="rounded-lg bg-emerald-700 px-2 py-1 text-sm text-white hover:bg-emerald-600"
                          >
                            Aprobar
                          </button>
                        </form>
                      )}

                      <form action={regenerateCreativeAction}>
                        <input type="hidden" name="creativeId" value={slot.creative_id} />
                        <input type="hidden" name="calendarSlotId" value={slot.id} />
                        <button
                          type="submit"
                          className="rounded-lg bg-ink-800 px-2 py-1 text-sm text-neutral-200 hover:bg-ink-700"
                        >
                          Regenerar
                        </button>
                      </form>

                      {creative?.status === "approved" && (
                        <form action={requestPublishAction}>
                          <input type="hidden" name="creativeId" value={slot.creative_id} />
                          <button
                            type="submit"
                            className="rounded-lg bg-pulso-primary px-2 py-1 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent"
                          >
                            Publicar
                          </button>
                        </form>
                      )}

                      {creative?.publications && creative.publications.length > 0 && (
                        <div className="flex flex-wrap gap-2 text-xs">
                          {creative.publications.map((pub, i) => (
                            <span
                              key={i}
                              className={pub.status === "published" ? "text-emerald-400" : "text-status-pink"}
                              title={pub.error_message ?? undefined}
                            >
                              {pub.status === "published" ? "✓" : "✗"} {pub.platform}
                            </span>
                          ))}
                        </div>
                      )}

                      <Link
                        href={`/calendar/${date}?month=${monthStr}&view=list&slot=${slot.slot_index}`}
                        className="ml-auto text-xs text-pulso-accent hover:underline"
                      >
                        Ver detalle →
                      </Link>
                    </div>
                  ))}
                {slot.status === "approved" && !slot.creative_id && (
                  <div className="mt-2 border-t border-ink-700 pt-2 text-sm text-neutral-600">generando…</div>
                )}
                </div>
              );
            });
          })}
        </div>
      )}
    </div>
  );
}
