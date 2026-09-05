import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
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
import {
  PLATFORM,
  PUB_STATUS,
  SELECT_OPTIONS,
  formatCalendarDay,
  label,
  limaToday,
  slotDisplayState,
  type SlotDisplayState,
} from "@/lib/labels";
import { SubmitButton } from "@/components/submit-button";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { inputClass, selectClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { StatusBadge, StatusDot, type StatusTone } from "@/components/ui/status-badge";

const RENDER_TEMPLATES_URL = process.env.NEXT_PUBLIC_RENDER_TEMPLATES_URL ?? "http://localhost:3001";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

// The states that need a human before anything else moves forward.
const ATTENTION_KEYS = new Set<SlotDisplayState["key"]>(["overdue", "failed", "review"]);

type View = "grid" | "list";

interface CalendarPageProps {
  searchParams: Promise<{ month?: string; view?: string; filtro?: string }>;
}

function publicationTone(status: string): StatusTone {
  if (status === "published") return "green";
  if (status === "failed") return "pink";
  return "blue";
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const sp = await searchParams;
  const monthParam = parseMonthParam(sp.month);
  const view: View = sp.view === "list" ? "list" : "grid";
  const attentionOnly = sp.filtro === "atencion";
  const monthStr = monthParamString(monthParam);
  const prevStr = monthParamString(prevMonthParam(monthParam));
  const nextStr = monthParamString(nextMonthParam(monthParam));
  const { start, end } = monthBounds(monthParam);
  const today = limaToday();
  const todayMonthStr = today.slice(0, 7);

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

  // One vocabulary for "what's going on with this slot" — shared by the grid
  // dots, the summary strip, the legend and the list badges.
  const stateOf = (slot: NonNullable<typeof slots>[number]): SlotDisplayState =>
    slotDisplayState(slot, slot.creatives ?? null, today);

  let publishedCount = 0;
  let readyCount = 0;
  let attentionCount = 0;
  const legend = new Map<SlotDisplayState["key"], SlotDisplayState>();
  for (const slot of slots ?? []) {
    const state = stateOf(slot);
    if (state.key === "published") publishedCount += 1;
    else if (state.key === "ready") readyCount += 1;
    if (ATTENTION_KEYS.has(state.key)) attentionCount += 1;
    if (!legend.has(state.key)) legend.set(state.key, state);
  }

  const filterQuery = attentionOnly ? "&filtro=atencion" : "";
  const navHref = (month: string) => `/calendar?month=${month}&view=${view}${filterQuery}`;
  const attentionHref = `/calendar?month=${monthStr}&view=list&filtro=atencion`;

  const daysWithoutContent = listDates.filter((date) => (slotsByDate.get(date) ?? []).length === 0).length;
  const listRows = listDates
    .map((date) => {
      const daySlots = (slotsByDate.get(date) ?? []).filter(
        (slot) => !attentionOnly || ATTENTION_KEYS.has(stateOf(slot).key),
      );
      return { date, daySlots };
    })
    .filter((row) => row.daySlots.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={ctx.tenantName}
        title="Calendario"
        description="El Planner llena ~30 días hacia adelante desde hoy — meses lejanos pueden verse vacíos hasta que se acerque la fecha."
        actions={
          <>
            <Segmented
              ariaLabel="Vista del calendario"
              items={[
                {
                  href: `/calendar?month=${monthStr}&view=grid`,
                  label: "Cuadrícula",
                  active: view === "grid",
                },
                {
                  href: `/calendar?month=${monthStr}&view=list${filterQuery}`,
                  label: "Lista",
                  active: view === "list",
                },
              ]}
            />
            <form action={requestCalendarRegenerationAction}>
              <input type="hidden" name="tenantId" value={ctx.tenantId} />
              <SubmitButton
                variant="secondary"
                confirmMessage="Se volverá a planificar el mes con los días libres. ¿Continuar?"
                pendingText="Planificando…"
              >
                Volver a planificar
              </SubmitButton>
            </form>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={navHref(prevStr)} className={buttonClass("secondary", "sm")} aria-label="Mes anterior">
            <ChevronLeft size={14} aria-hidden="true" />
          </Link>
          <span className="min-w-[10rem] text-center font-display text-sm font-semibold text-neutral-200">
            {monthLabel(monthParam)}
          </span>
          <Link href={navHref(nextStr)} className={buttonClass("secondary", "sm")} aria-label="Mes siguiente">
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
          {monthStr !== todayMonthStr && (
            <Link href={navHref(todayMonthStr)} className={buttonClass("secondary", "sm")}>
              Hoy
            </Link>
          )}
        </div>

        <p className="text-sm text-neutral-500">
          Este mes:{" "}
          <span className="text-neutral-300">
            {publishedCount} {publishedCount === 1 ? "publicada" : "publicadas"}
          </span>
          {" · "}
          <span className="text-neutral-300">
            {readyCount} {readyCount === 1 ? "lista" : "listas"}
          </span>
          {" · "}
          {attentionCount > 0 ? (
            <Link href={attentionHref} className="font-medium text-status-pink hover:underline">
              {attentionCount} {attentionCount === 1 ? "requiere" : "requieren"} atención
            </Link>
          ) : (
            <span className="text-neutral-300">0 requieren atención</span>
          )}
        </p>
      </div>

      {view === "grid" ? (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-ink-700">
            <div className="grid grid-cols-7 border-b border-ink-700 bg-ink-900">
              {WEEKDAY_LABELS.map((weekday, i) => (
                <div
                  key={weekday}
                  className={`px-2 py-2 text-center text-xs font-medium uppercase tracking-wide ${
                    i >= 5 ? "text-neutral-600" : "text-neutral-500"
                  }`}
                >
                  {weekday}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {grid.map((cell) => {
                const daySlots = slotsByDate.get(cell.date) ?? [];
                const soleCreative = daySlots.length === 1 ? (daySlots[0]?.creatives ?? null) : null;
                const dayNumber = Number(cell.date.slice(8, 10));
                const isToday = cell.date === today;
                const cellContent = (
                  <div
                    className={`flex h-24 flex-col gap-1 border-b border-r border-ink-700 p-1.5 transition-colors duration-200 last:border-r-0 sm:h-28 ${
                      cell.inMonth ? "bg-ink-950 hover:bg-ink-900" : "bg-ink-950/40"
                    } ${isToday ? "ring-1 ring-inset ring-pulso-accent/60" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs ${
                          isToday
                            ? "font-semibold text-pulso-accent"
                            : cell.inMonth
                              ? "text-neutral-300"
                              : "text-neutral-700"
                        }`}
                      >
                        {dayNumber}
                      </span>
                    </div>
                    {cell.inMonth &&
                      daySlots.map((daySlot) => {
                        const state = stateOf(daySlot);
                        return (
                          <p
                            key={daySlot.id}
                            className="flex min-w-0 items-center gap-1 text-xs leading-tight text-neutral-400"
                          >
                            <StatusDot tone={state.tone} title={state.label} />
                            {daySlot.publish_hour !== null && (
                              <span className="shrink-0 text-neutral-600">{daySlot.publish_hour}h</span>
                            )}
                            <span className="truncate">{daySlot.theme}</span>
                          </p>
                        );
                      })}
                    {/* The thumbnail only fits when the day has a single slot;
                        with two, the themes already fill the cell. */}
                    {soleCreative && soleCreative.asset_urls.length > 0 && cell.inMonth && (
                      <div className="mt-auto h-8 w-8 overflow-hidden rounded">
                        {soleCreative.type === "video" ? (
                          <video
                            src={soleCreative.asset_urls[0]}
                            className="h-full w-full object-cover"
                            muted
                          />
                        ) : (
                          <img
                            src={soleCreative.asset_urls[0]}
                            alt=""
                            className="h-full w-full object-cover"
                          />
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
                  <Link key={cell.date} href={`/calendar/${cell.date}?month=${monthStr}&view=grid${filterQuery}`}>
                    {cellContent}
                  </Link>
                ) : (
                  <div key={cell.date}>{cellContent}</div>
                );
              })}
            </div>
          </div>

          {legend.size > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
              {[...legend.values()].map((state) => (
                <span key={state.key} className="inline-flex items-center gap-1.5">
                  <StatusDot tone={state.tone} />
                  {state.label}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {attentionOnly && (
            <p className="text-sm text-neutral-500">
              Mostrando solo lo que requiere atención.{" "}
              <Link
                href={`/calendar?month=${monthStr}&view=list`}
                className="text-pulso-accent hover:underline"
              >
                Ver todo el mes
              </Link>
            </p>
          )}

          {listRows.length === 0 && (
            <EmptyState
              icon={<CalendarDays size={28} aria-hidden="true" />}
              title={attentionOnly ? "Nada requiere atención este mes" : "Sin contenido planificado este mes"}
              description={
                attentionOnly
                  ? "Todas las piezas están publicadas, listas o en camino."
                  : "El Planner llena ~30 días hacia adelante desde hoy. Si este mes ya está cerca, pide una nueva planificación."
              }
            />
          )}

          {listRows.map(({ date, daySlots }) => (
            <section key={date} className="space-y-1.5">
              <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                {formatCalendarDay(date)}
                {date === today && <span className="ml-2 text-pulso-accent">Hoy</span>}
              </h2>

              {/* One card per slot, not per day: with two daily publications
                  the date alone no longer says which one is meant, so each
                  card carries its hour alongside. */}
              {daySlots.map((slot) => {
                const creative = slot.creatives ?? null;
                const state = stateOf(slot);
                const detailHref = `/calendar/${date}?month=${monthStr}&view=list&slot=${slot.slot_index}${filterQuery}`;

                return (
                  <Card key={slot.id} padding="sm">
                    <form
                      action={updateCalendarSlotAction}
                      className="grid grid-cols-1 gap-2 md:grid-cols-[120px_1fr_150px_130px_auto] md:items-center"
                    >
                      <div className="flex items-center gap-2 text-sm text-neutral-400">
                        {slot.publish_hour !== null && <span>{slot.publish_hour}h</span>}
                        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                      </div>
                      <input type="hidden" name="slotId" value={slot.id} />
                      <input
                        name="theme"
                        defaultValue={slot.theme}
                        aria-label="Tema"
                        className={inputClass}
                      />
                      <select
                        name="slotType"
                        defaultValue={slot.slot_type}
                        aria-label="Formato"
                        className={selectClass}
                      >
                        {SELECT_OPTIONS.slotType.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.text}
                          </option>
                        ))}
                      </select>
                      <select
                        name="status"
                        defaultValue={slot.status}
                        aria-label="Estado"
                        className={selectClass}
                      >
                        {SELECT_OPTIONS.slotStatus.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.text}
                          </option>
                        ))}
                      </select>
                      <SubmitButton variant="subtle" size="sm" pendingText="Guardando…">
                        Guardar
                      </SubmitButton>
                    </form>

                    {slot.creative_id && (
                      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-ink-700 pt-3">
                        {creative?.status !== "failed" &&
                          (creative?.type === "video" ? (
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
                          ))}

                        {creative?.status === "failed" && (
                          <span className="text-sm text-status-pink">Falló el render de la pieza</span>
                        )}

                        {creative?.status !== "failed" && creative?.status !== "approved" && (
                          <form action={approveCreativeAction}>
                            <input type="hidden" name="creativeId" value={slot.creative_id} />
                            <SubmitButton variant="success" size="sm" pendingText="Aprobando…">
                              Aprobar
                            </SubmitButton>
                          </form>
                        )}

                        <form action={regenerateCreativeAction}>
                          <input type="hidden" name="creativeId" value={slot.creative_id} />
                          <input type="hidden" name="calendarSlotId" value={slot.id} />
                          <SubmitButton
                            variant="dangerGhost"
                            size="sm"
                            pendingText="Regenerando…"
                            confirmMessage="Se descartará la pieza actual y se generará una nueva. ¿Continuar?"
                          >
                            Regenerar
                          </SubmitButton>
                        </form>

                        {creative?.status === "approved" && (
                          <form action={requestPublishAction}>
                            <input type="hidden" name="creativeId" value={slot.creative_id} />
                            <SubmitButton
                              variant="primary"
                              size="sm"
                              pendingText="Publicando…"
                              confirmMessage="Se publicará ahora en las redes conectadas. ¿Continuar?"
                            >
                              Publicar
                            </SubmitButton>
                          </form>
                        )}

                        {creative?.publications && creative.publications.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2">
                            {creative.publications.map((pub, i) => (
                              <span key={i} className="inline-flex flex-col gap-0.5">
                                <StatusBadge tone={publicationTone(pub.status)}>
                                  {label(PLATFORM, pub.platform)} · {label(PUB_STATUS, pub.status)}
                                </StatusBadge>
                                {pub.error_message && (
                                  <span
                                    className="max-w-xs truncate text-xs text-status-pink"
                                    title={pub.error_message}
                                  >
                                    {pub.error_message}
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                        )}

                        <Link href={detailHref} className={buttonClass("link", "sm", "ml-auto text-xs")}>
                          Ver detalle →
                        </Link>
                      </div>
                    )}

                    {!slot.creative_id && (
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-ink-700 pt-3 text-sm text-neutral-500">
                        <span>
                          {slot.status === "approved"
                            ? "Generando la pieza… suele tardar 1-3 minutos."
                            : "Aún no hay pieza para este día."}
                        </span>
                        <Link href={detailHref} className={buttonClass("link", "sm", "text-xs")}>
                          Ver detalle →
                        </Link>
                      </div>
                    )}
                  </Card>
                );
              })}
            </section>
          ))}

          {daysWithoutContent > 0 && (
            <p className="text-sm text-neutral-600">
              {daysWithoutContent} {daysWithoutContent === 1 ? "día sin contenido" : "días sin contenido"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
