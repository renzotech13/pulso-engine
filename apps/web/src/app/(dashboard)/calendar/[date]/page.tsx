import Link from "next/link";
import { AlertTriangle, ArrowLeft, ImageOff, Loader2, X } from "lucide-react";
import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  addPhotosToCreativeAction,
  approveCreativeAction,
  createPhotoFrameCreativeAction,
  createStudentShowcaseCreativeAction,
  deleteCreativeAction,
  regenerateCreativeAction,
  removePhotoFromCreativeAction,
  requestPublishAction,
  toggleHoldPublishAction,
  updateCalendarSlotAction,
} from "@/lib/actions";
import {
  BRIEF_KEYS,
  CREATIVE_STATUS,
  PHOTO_SOURCE,
  PLATFORM,
  PUB_STATUS,
  SELECT_OPTIONS,
  formatCalendarDay,
  label,
  limaToday,
  slotDisplayState,
} from "@/lib/labels";
import { Field, inputClass, selectClass, textareaClass } from "@/components/ui/field";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";
import { MediaDropzone } from "@/components/media-dropzone";
import { SubmitButton } from "@/components/submit-button";
import { CarouselSlideGrid } from "@/components/carousel-slide-grid";
import { CreativePreview } from "@/components/creative-preview";
import { MoveDateForm } from "./move-date-form";
import { CaptionForm } from "./caption-form";

const RENDER_TEMPLATES_URL = process.env.NEXT_PUBLIC_RENDER_TEMPLATES_URL ?? "http://localhost:3001";

// Shortlist of countries actually seen among students so far — "Otro" skips
// the flag entirely rather than trying to cover every country up front.
const STUDENT_COUNTRIES = [
  { code: "PE", name: "Perú" },
  { code: "CO", name: "Colombia" },
  { code: "MX", name: "México" },
  { code: "AR", name: "Argentina" },
  { code: "CL", name: "Chile" },
  { code: "EC", name: "Ecuador" },
  { code: "BO", name: "Bolivia" },
  { code: "VE", name: "Venezuela" },
  { code: "ES", name: "España" },
  { code: "US", name: "Estados Unidos" },
] as const;

// Brief keys that are plumbing for the render service, not content the
// user wrote or wants to review — never shown.
const HIDDEN_BRIEF_KEYS = new Set(["photoUrl", "photoUrls", "photoAssetId", "photoAssetIds", "photoSource", "photoSources", "caption"]);
const isColourKey = (key: string) => /colou?r/i.test(key);

interface CreativePublication {
  platform: string;
  status: string;
  error_message: string | null;
  published_at: string | null;
}

interface SlotCreative {
  id: string;
  type: string;
  status: string;
  brief: unknown;
  asset_urls: string[] | null;
  template_id: string | null;
  publications: CreativePublication[] | null;
}

function creativeTone(status: string): StatusTone {
  switch (status) {
    case "approved":
      return "green";
    case "ready":
      return "orange";
    case "failed":
      return "pink";
    default:
      return "blue";
  }
}

function publicationTone(status: string): StatusTone {
  if (status === "published") return "green";
  if (status === "failed") return "pink";
  return "blue";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

interface ThumbnailGridProps {
  urls: string[];
  creativeId: string;
  tenantId: string;
  date: string;
  canDelete: boolean;
}

function ThumbnailGrid({ urls, creativeId, tenantId, date, canDelete }: ThumbnailGridProps) {
  if (urls.length === 0) return null;
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {urls.map((url, i) => (
        <div
          key={url}
          className="group relative aspect-square overflow-hidden rounded-btn border border-line transition-colors duration-200 hover:border-accent/60"
        >
          <a href={url} target="_blank" rel="noreferrer" download title={`Descargar foto ${i + 1}`} className="block h-full w-full">
            <img src={url} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" />
          </a>
          {canDelete && (
            <form action={removePhotoFromCreativeAction} className="absolute right-1 top-1">
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="date" value={date} />
              <input type="hidden" name="creativeId" value={creativeId} />
              <input type="hidden" name="index" value={i} />
              <SubmitButton
                variant="danger"
                size="sm"
                title="Eliminar esta foto"
                aria-label={`Eliminar foto ${i + 1}`}
                pendingText={<span className="sr-only">Quitando…</span>}
                className="rounded-full opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X size={14} aria-hidden="true" />
              </SubmitButton>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}

/** One badge per platform, with the failure reason spelled out instead of hidden in a tooltip. */
function PublicationBadges({ publications }: { publications: CreativePublication[] | null }) {
  if (!publications || publications.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {publications.map((pub, i) => (
        <li key={i} className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={publicationTone(pub.status)}>
            {label(PLATFORM, pub.platform)} · {label(PUB_STATUS, pub.status)}
          </StatusBadge>
          {pub.status === "failed" && pub.error_message && (
            <span className="text-xs text-danger">{pub.error_message}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The creative's brief as labelled rows — never the raw JSON dump this used to be. */
function BriefRows({ brief }: { brief: unknown }) {
  const record = asRecord(brief);
  if (!record) return null;

  const known = Object.keys(BRIEF_KEYS).filter((key) => !HIDDEN_BRIEF_KEYS.has(key));
  const extra = Object.keys(record).filter(
    (key) => !(key in BRIEF_KEYS) && !HIDDEN_BRIEF_KEYS.has(key) && !isColourKey(key),
  );
  const rows = [...known, ...extra]
    .map((key) => [key, record[key]] as const)
    .filter((entry): entry is readonly [string, string] => typeof entry[1] === "string" && entry[1].length > 0);

  const photoUrl = typeof record.photoUrl === "string" && record.photoUrl ? record.photoUrl : null;
  const photoSource = typeof record.photoSource === "string" ? label(PHOTO_SOURCE, record.photoSource) : "";

  if (rows.length === 0 && !photoUrl) return null;

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <dl className="space-y-2">
          {rows.map(([key, value]) => (
            <div key={key}>
              <dt className="eyebrow text-fg-3">{label(BRIEF_KEYS, key)}</dt>
              <dd className="text-sm text-fg">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {photoUrl && (
        <div className="flex items-center gap-3">
          <a href={photoUrl} target="_blank" rel="noreferrer" title="Abrir la foto original" className="shrink-0">
            <img src={photoUrl} alt="" className="h-12 w-12 rounded-btn border border-line object-cover" />
          </a>
          <div>
            <p className="eyebrow text-fg-3">Foto</p>
            {photoSource && <p className="text-xs text-fg-2">{photoSource}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

interface DetailPageProps {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ month?: string; view?: string; slot?: string; filtro?: string }>;
}

export default async function CalendarDetailPage({ params, searchParams }: DetailPageProps) {
  const { date } = await params;
  const sp = await searchParams;
  const backMonth = sp.month ?? date.slice(0, 7);
  const backView = sp.view ?? "grid";
  // Round-trips the "solo atención" filter through the day detail page —
  // without this, filtering the list to what needs attention and opening one
  // loses the filter on the way back, dropping the reviewer back into the
  // full unfiltered month.
  const backFilterQuery = sp.filtro === "atencion" ? "&filtro=atencion" : "";
  // A day can hold more than one publication (see `tenants.publish_hours`),
  // so the date alone no longer identifies a slot: `?slot=` says which one is
  // being viewed. Without the param, the day's first.
  const requestedSlotIndex = Number(sp.slot ?? "0");

  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const [{ data: daySlots }, { data: photoFrame }, { data: studentShowcase }, { data: tenant }] = await Promise.all([
    supabase
      .from("content_calendar")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .eq("date", date)
      .order("slot_index"),
    supabase
      .from("render_templates")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("component_ref", "photo-frame")
      .maybeSingle(),
    supabase
      .from("render_templates")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("component_ref", "student-showcase")
      .maybeSingle(),
    supabase.from("tenants").select("publish_hours").eq("id", ctx.tenantId).maybeSingle(),
  ]);

  // The turns this business publishes in, e.g. [9, 18] — used to label the
  // slot switcher and to offer a target turn when moving a piece.
  const publishHours = tenant?.publish_hours ?? [];

  const slots = daySlots ?? [];
  // Turns are driven by the tenant's schedule, with any extra slot that
  // exists beyond it (a manually created one) appended, so nothing is
  // hidden. An empty turn is still a turn you can open.
  const turnIndexes = [
    ...new Set([...publishHours.map((_, index) => index), ...slots.map((s) => s.slot_index)]),
  ].sort((a, b) => a - b);
  const turns = turnIndexes.map((index) => {
    const filled = slots.find((s) => s.slot_index === index);
    const hour = filled?.publish_hour ?? publishHours[index];
    return {
      index,
      filled: Boolean(filled),
      label: hour === undefined || hour === null ? `Publicación ${index + 1}` : formatHour(hour),
    };
  });
  // Resolve the turn first, then the piece in it — so an empty turn shows as
  // empty, and a day whose only piece sits in a later turn opens on that
  // piece instead of on a blank page.
  const slotIndex = turnIndexes.includes(requestedSlotIndex)
    ? requestedSlotIndex
    : (slots[0]?.slot_index ?? requestedSlotIndex);
  const slot = slots.find((s) => s.slot_index === slotIndex) ?? null;

  // Days the Planner hasn't touched have no slot yet — that's fine here
  // (unlike the old behavior), since "Publicar con marco" can create one.
  // A slot can hold several creatives (e.g. several photo-frame posts made
  // the same day) — content_calendar.creative_id only names the featured
  // one; the rest are fetched separately so they aren't invisible.
  const { data: slotCreatives } = slot
    ? await supabase
        .from("creatives")
        .select("id, type, status, brief, asset_urls, template_id, publications(platform, status, error_message, published_at)")
        .eq("calendar_slot_id", slot.id)
        .order("created_at", { ascending: true })
    : { data: null as SlotCreative[] | null };

  const creatives = slotCreatives ?? [];
  const creative = creatives.find((c) => c.id === slot?.creative_id) ?? null;
  const photoFrameCreatives = photoFrame ? creatives.filter((c) => c.template_id === photoFrame.id) : [];
  const otherPhotoFrameCreatives = photoFrameCreatives.filter((c) => c.id !== creative?.id);
  const isAppendable = (c: SlotCreative) => !c.publications?.some((p) => p.status === "published");

  const displayState = slot ? slotDisplayState(slot, creative, limaToday()) : null;
  const isGenerating = creative?.status === "pending" || creative?.status === "rendering";
  const caption = asRecord(creative?.brief)?.caption;
  const captionText = typeof caption === "string" ? caption : "";

  const backHref = `/calendar?month=${backMonth}&view=${backView}${backFilterQuery}`;
  const title =
    capitalize(formatCalendarDay(date)) +
    (slot?.publish_hour !== null && slot?.publish_hour !== undefined ? ` · ${formatHour(slot.publish_hour)}` : "");

  return (
    <div className="space-y-6">
      <Link href={backHref} className={buttonClass("link", "sm", "text-sm")}>
        <ArrowLeft size={14} aria-hidden="true" />
        Volver al calendario
      </Link>

      <PageHeader
        eyebrow={ctx.tenantName}
        title={title}
        description={slot?.theme ?? "Sin contenido planificado"}
        actions={
          // Every turn the business publishes in, not just the ones that
          // already have a piece — otherwise an empty afternoon is invisible
          // and there is no way to open it and fill it.
          turns.length > 1 ? (
            <Segmented
              ariaLabel="Turno del día"
              items={turns.map((turn) => ({
                href: `/calendar/${date}?month=${backMonth}&view=${backView}&slot=${turn.index}${backFilterQuery}`,
                label: turn.filled ? turn.label : `${turn.label} · libre`,
                active: turn.index === slotIndex,
              }))}
            />
          ) : undefined
        }
      />

      {slot && displayState && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card padding="none" className="overflow-hidden">
            {creative && creative.status === "failed" ? (
              <div className="p-4">
                <EmptyState
                  icon={<AlertTriangle size={28} aria-hidden="true" />}
                  title="Falló la generación de la pieza"
                  description="Escribe una indicación y usa «Guardar y regenerar», o elimina la pieza para dejar el día libre."
                />
              </div>
            ) : creative && isGenerating ? (
              <div className="p-4">
                <EmptyState
                  icon={<Loader2 size={28} className="animate-spin" aria-hidden="true" />}
                  title="Generando la pieza…"
                  description="Suele tardar entre 1 y 3 minutos. Recarga la página para ver si ya está."
                />
              </div>
            ) : creative ? (
              creative.type === "video" ? (
                <video src={`${RENDER_TEMPLATES_URL}/api/render/${creative.id}.mp4`} className="w-full" controls />
              ) : (
                <CreativePreview src={`${RENDER_TEMPLATES_URL}/api/render/${creative.id}.png`} />
              )
            ) : slot.status === "approved" ? (
              <div className="p-4">
                <EmptyState
                  icon={<Loader2 size={28} className="animate-spin" aria-hidden="true" />}
                  title="Generando la pieza…"
                  description="Suele tardar entre 1 y 3 minutos. Recarga la página para ver si ya está."
                />
              </div>
            ) : (
              <div className="p-4">
                <EmptyState
                  icon={<ImageOff size={28} aria-hidden="true" />}
                  title="Sin pieza todavía"
                  description="Cambia el estado a «Aprobado» y guarda para que el agente creativo la genere."
                />
              </div>
            )}

            {creative && creative.asset_urls && creative.asset_urls.length > 1 && (
              <div className="border-t border-line p-3">
                <p className="mb-2 text-xs text-fg-3">
                  {creative.asset_urls.length}{" "}
                  {creative.type === "carousel"
                    ? "slides — pasa el mouse sobre uno para regenerarlo con IA o reemplazarlo con tu propia foto."
                    : "fotos listas — click para descargar cada una"}
                  {photoFrame && creative.template_id === photoFrame.id && isAppendable(creative)
                    ? ", pasa el mouse y usa la × para eliminar una"
                    : ""}
                </p>
                {creative.type === "carousel" ? (
                  <CarouselSlideGrid
                    urls={creative.asset_urls}
                    creativeId={creative.id}
                    tenantId={ctx.tenantId}
                    date={date}
                    slotIndex={slotIndex}
                  />
                ) : (
                  <ThumbnailGrid
                    urls={creative.asset_urls}
                    creativeId={creative.id}
                    tenantId={ctx.tenantId}
                    date={date}
                    canDelete={Boolean(photoFrame && creative.template_id === photoFrame.id && isAppendable(creative))}
                  />
                )}
              </div>
            )}

            {creative && photoFrame && creative.template_id === photoFrame.id && isAppendable(creative) && (
              <form action={addPhotosToCreativeAction} className="flex flex-wrap items-end gap-3 border-t border-line p-3">
                <input type="hidden" name="tenantId" value={ctx.tenantId} />
                <input type="hidden" name="date" value={date} />
                <input type="hidden" name="creativeId" value={creative.id} />
                <div className="min-w-[220px] flex-1">
                  <MediaDropzone
                    name="photos"
                    accept="image/*"
                    label="Agregar más fotos a esta publicación"
                    hint="Arrastra fotos acá o haz click para elegir"
                  />
                </div>
                <SubmitButton variant="primary" size="sm" pendingText="Agregando…">
                  Agregar fotos
                </SubmitButton>
              </form>
            )}
          </Card>

          <div className="space-y-4">
            <Card padding="sm">
              <CardHeader
                title="Estado"
                actions={<StatusBadge tone={displayState.tone}>{displayState.label}</StatusBadge>}
              />

              <div className="space-y-4 text-sm">
                {slot.hold_publish && (
                  <p className="rounded-btn bg-amber/10 px-3 py-2 text-xs text-amber">
                    La publicación automática de este día está en pausa. La generación sigue normal.
                  </p>
                )}

                {creative?.publications && creative.publications.length > 0 && (
                  <div>
                    <p className="mb-1.5 eyebrow text-fg-3">Publicaciones</p>
                    <PublicationBadges publications={creative.publications} />
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {creative && creative.status !== "approved" && (
                    <form action={approveCreativeAction}>
                      <input type="hidden" name="creativeId" value={creative.id} />
                      <SubmitButton variant="success" size="sm" pendingText="Aprobando…">
                        Aprobar
                      </SubmitButton>
                    </form>
                  )}
                  {creative?.status === "approved" && (
                    <form action={requestPublishAction}>
                      <input type="hidden" name="creativeId" value={creative.id} />
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
                  <form action={toggleHoldPublishAction}>
                    <input type="hidden" name="tenantId" value={ctx.tenantId} />
                    <input type="hidden" name="slotId" value={slot.id} />
                    <input type="hidden" name="date" value={date} />
                    <input type="hidden" name="holdPublish" value={String(!slot.hold_publish)} />
                    <SubmitButton
                      variant={slot.hold_publish ? "secondary" : "dangerGhost"}
                      size="sm"
                      pendingText="Guardando…"
                      title={
                        slot.hold_publish
                          ? "Vuelve a permitir que este día se publique solo"
                          : "El contenido se sigue generando normal — solo bloquea que se publique automáticamente"
                      }
                    >
                      {slot.hold_publish ? "Reactivar publicación automática" : "No publicar"}
                    </SubmitButton>
                  </form>
                  {creative && (
                    <form action={deleteCreativeAction}>
                      <input type="hidden" name="tenantId" value={ctx.tenantId} />
                      <input type="hidden" name="slotId" value={slot.id} />
                      <input type="hidden" name="date" value={date} />
                      <input type="hidden" name="creativeId" value={creative.id} />
                      <SubmitButton
                        variant="dangerGhost"
                        size="sm"
                        pendingText="Eliminando…"
                        confirmMessage="¿Eliminar esta pieza? Se borra el creative y lo generado — el día queda libre en borrador. Esto no se puede deshacer."
                        title="Borra esta pieza y deja el día libre (no se puede si ya se publicó de verdad)"
                      >
                        Eliminar
                      </SubmitButton>
                    </form>
                  )}
                </div>

                <div className="border-t border-line pt-4">
                  <MoveDateForm
                    tenantId={ctx.tenantId}
                    slotId={slot.id}
                    date={date}
                    publishHours={publishHours}
                  />
                </div>
              </div>
            </Card>

            {creative && (
              <Card padding="sm">
                <CardHeader
                  title="Contenido de la pieza"
                  description="Lo que el agente creativo armó para este día."
                />
                <div className="space-y-4">
                  <BriefRows brief={creative.brief} />
                  <div className="border-t border-line pt-4">
                    <CaptionForm tenantId={ctx.tenantId} creativeId={creative.id} date={date} caption={captionText} />
                  </div>
                </div>
              </Card>
            )}

            <Card padding="sm">
              <CardHeader title="Planificación" description="Tema, tipo y estado del día." />
              <form action={updateCalendarSlotAction} className="space-y-3">
                <input type="hidden" name="slotId" value={slot.id} />
                {creative && <input type="hidden" name="creativeId" value={creative.id} />}
                <input type="hidden" name="calendarSlotId" value={slot.id} />

                <Field id="slot-theme" label="Tema">
                  <input id="slot-theme" name="theme" defaultValue={slot.theme} className={inputClass} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field id="slot-type" label="Tipo">
                    <select id="slot-type" name="slotType" defaultValue={slot.slot_type} className={selectClass}>
                      {SELECT_OPTIONS.slotType.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.text}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="slot-status" label="Estado">
                    <select id="slot-status" name="status" defaultValue={slot.status} className={selectClass}>
                      {SELECT_OPTIONS.slotStatus.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.text}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field
                  id="slot-notes"
                  label="Indicación para mejorar esta pieza"
                  hint="Se usa para el texto (titular, subtítulo, precio) tanto en imágenes como en videos. Cambios de tamaño de letra, layout o recorte de video todavía no son ajustables desde acá."
                >
                  <textarea
                    id="slot-notes"
                    name="notes"
                    rows={4}
                    defaultValue={slot.notes ?? ""}
                    placeholder="Ej: usa un tono más cercano, agranda la idea principal, prueba con otra foto…"
                    className={textareaClass}
                  />
                </Field>

                <div className="flex flex-wrap gap-2 pt-1">
                  <SubmitButton variant="secondary" size="sm" pendingText="Guardando…">
                    Guardar
                  </SubmitButton>
                  {creative && (
                    <SubmitButton
                      variant="danger"
                      size="sm"
                      formAction={regenerateCreativeAction}
                      pendingText="Regenerando…"
                      confirmMessage="Borra la pieza actual y crea otra. ¿Continuar?"
                    >
                      Guardar y regenerar
                    </SubmitButton>
                  )}
                </div>
              </form>
            </Card>
          </div>
        </div>
      )}

      {otherPhotoFrameCreatives.length > 0 && (
        <Card>
          <CardHeader
            title="Otras publicaciones con marco de este día"
            description="Piezas creadas a mano para este mismo día, además de la principal."
          />
          <div className="space-y-4">
            {otherPhotoFrameCreatives.map((c) => (
              <Card key={c.id} padding="sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
                    <span>
                      {c.asset_urls?.length ?? 0} foto{(c.asset_urls?.length ?? 0) !== 1 ? "s" : ""}
                    </span>
                    <StatusBadge tone={creativeTone(c.status)}>{label(CREATIVE_STATUS, c.status)}</StatusBadge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {c.status !== "approved" && (
                      <form action={approveCreativeAction}>
                        <input type="hidden" name="creativeId" value={c.id} />
                        <SubmitButton variant="success" size="sm" pendingText="Aprobando…">
                          Aprobar
                        </SubmitButton>
                      </form>
                    )}
                    {c.status === "approved" && (
                      <form action={requestPublishAction}>
                        <input type="hidden" name="creativeId" value={c.id} />
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
                  </div>
                </div>

                {c.asset_urls && c.asset_urls.length > 0 && (
                  <div className="mb-3">
                    <ThumbnailGrid
                      urls={c.asset_urls}
                      creativeId={c.id}
                      tenantId={ctx.tenantId}
                      date={date}
                      canDelete={isAppendable(c)}
                    />
                  </div>
                )}

                <PublicationBadges publications={c.publications} />

                {isAppendable(c) && (
                  <form action={addPhotosToCreativeAction} className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
                    <input type="hidden" name="tenantId" value={ctx.tenantId} />
                    <input type="hidden" name="date" value={date} />
                    <input type="hidden" name="creativeId" value={c.id} />
                    <div className="min-w-[220px] flex-1">
                      <MediaDropzone
                        name="photos"
                        accept="image/*"
                        label="Agregar más fotos a esta publicación"
                        hint="Arrastra fotos acá o haz click para elegir"
                      />
                    </div>
                    <SubmitButton variant="primary" size="sm" pendingText="Agregando…">
                      Agregar fotos
                    </SubmitButton>
                  </form>
                )}
              </Card>
            ))}
          </div>
        </Card>
      )}

      {photoFrame && (
        <Card>
          <CardHeader
            title="Crear nueva publicación con marco"
            description="Una publicación nueva y separada para este día."
          />
          <p className="mb-4 text-sm text-fg-3">
            Úsalo cuando quieras publicar otra cosa distinta, no para sumar fotos a la que ya hiciste (para eso
            usa &quot;Agregar más fotos&quot; arriba). Sube una o varias fotos — cada una se compone
            automáticamente detrás de tu marco (configurado en Marca). Una foto crea una publicación normal;
            dos o más crean un carrusel.
          </p>
          <form action={createPhotoFrameCreativeAction} className="space-y-4">
            <input type="hidden" name="tenantId" value={ctx.tenantId} />
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="slotIndex" value={slotIndex} />

            <MediaDropzone name="photos" accept="image/*" label="Fotos" hint="Arrastra fotos acá o haz click para elegir" />

            <Field id="photo-frame-caption" label="Texto de la publicación">
              <textarea
                id="photo-frame-caption"
                name="caption"
                rows={3}
                placeholder="Ej: Nuestra categoría Sub-13 se enfrentó a Academia Los Leones…"
                className={textareaClass}
              />
            </Field>

            <SubmitButton variant="primary" pendingText="Creando…">
              Crear publicación
            </SubmitButton>
          </form>
        </Card>
      )}

      {studentShowcase && (
        <Card>
          <CardHeader title="Alumna destacada" description="Arma el carrusel de una alumna con lo que tengas de cada tipo." />
          <p className="mb-4 text-sm text-fg-3">
            Sube fotos de sus trabajos, certificado y retrato — cada una es opcional, y el carrusel sale solo con
            las que llenes, siempre en ese orden.
          </p>
          <form action={createStudentShowcaseCreativeAction} className="space-y-4">
            <input type="hidden" name="tenantId" value={ctx.tenantId} />
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="slotIndex" value={slotIndex} />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="showcase-event-name" label="Nombre del evento" required>
                <input
                  id="showcase-event-name"
                  name="eventName"
                  required
                  placeholder="Expo Desfile Joyería Punto Peruano"
                  className={inputClass}
                />
              </Field>
              <Field id="showcase-event-year" label="Año" required>
                <input id="showcase-event-year" name="eventYear" required placeholder="2026" className={inputClass} />
              </Field>
              <Field id="showcase-student-name" label="Nombre de la alumna" required>
                <input
                  id="showcase-student-name"
                  name="studentName"
                  required
                  placeholder="Diana Gonzales"
                  className={inputClass}
                />
              </Field>
              <Field id="showcase-country" label="País" hint="Opcional — agrega la bandera al carrusel.">
                <select id="showcase-country" name="countryCode" defaultValue="" className={selectClass}>
                  <option value="">Sin bandera</option>
                  {STUDENT_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <MediaDropzone
              name="photosWork"
              accept="image/*"
              label="Trabajos de la alumna (1 o 2 fotos)"
              hint="Arrastra hasta 2 fotos, o deja vacío para omitir este slide"
            />

            <MediaDropzone
              name="photoCertificate"
              accept="image/*"
              label="Certificado (1 foto)"
              hint="Una foto, o deja vacío para omitir este slide"
              multiple={false}
            />

            <MediaDropzone
              name="photoPortrait"
              accept="image/*"
              label="Retrato (1 foto)"
              hint="Una foto, o deja vacío para omitir este slide"
              multiple={false}
            />

            <Field id="showcase-caption" label="Texto de la publicación">
              <textarea
                id="showcase-caption"
                name="caption"
                rows={3}
                placeholder="Ej: Felicitamos a Diana por su certificación como especialista…"
                className={textareaClass}
              />
            </Field>

            <SubmitButton variant="primary" pendingText="Creando…">
              Crear publicación
            </SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
