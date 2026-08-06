import Link from "next/link";
import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  addPhotosToCreativeAction,
  approveCreativeAction,
  createPhotoFrameCreativeAction,
  regenerateCarouselSlideAction,
  regenerateCreativeAction,
  removePhotoFromCreativeAction,
  replaceCarouselSlidePhotoAction,
  requestPublishAction,
  updateCalendarSlotAction,
} from "@/lib/actions";
import { inputClass as fieldClass, labelClass } from "@/components/ui/field";
import { Card, CardHeader } from "@/components/ui/card";
import { MediaDropzone } from "@/components/media-dropzone";
import { SubmitButton } from "@/components/submit-button";
import { AutoSubmitFileInput } from "@/components/auto-submit-file-input";
import { MoveDateForm } from "./move-date-form";
import { CaptionForm } from "./caption-form";

const RENDER_TEMPLATES_URL = process.env.NEXT_PUBLIC_RENDER_TEMPLATES_URL ?? "http://localhost:3001";

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
          className="group relative aspect-square overflow-hidden rounded-lg border border-ink-700 transition-colors duration-200 hover:border-pulso-accent/60"
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
              <button
                type="submit"
                title="Eliminar esta foto"
                className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs leading-none text-white opacity-0 transition-opacity duration-150 hover:bg-status-pink group-hover:opacity-100"
              >
                ×
              </button>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}

interface CarouselSlideGridProps {
  urls: string[];
  creativeId: string;
  tenantId: string;
  date: string;
}

/**
 * Per-slide fix controls for an AI-generated carousel — separate from
 * ThumbnailGrid (which only ever deletes) because a carousel slide can't
 * just be removed without leaving a gap in the copy; it needs a replacement
 * photo, either AI-regenerated or uploaded by hand.
 */
function CarouselSlideGrid({ urls, creativeId, tenantId, date }: CarouselSlideGridProps) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {urls.map((url, i) => (
        <div
          key={url}
          className="group relative aspect-square overflow-hidden rounded-lg border border-ink-700 transition-colors duration-200 hover:border-pulso-accent/60"
        >
          <a href={url} target="_blank" rel="noreferrer" title={`Slide ${i + 1}`} className="block h-full w-full">
            <img src={url} alt={`Slide ${i + 1}`} className="h-full w-full object-cover" />
          </a>
          <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {i + 1}
          </span>
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-black/75 py-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <form action={regenerateCarouselSlideAction}>
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="date" value={date} />
              <input type="hidden" name="creativeId" value={creativeId} />
              <input type="hidden" name="slideIndex" value={i} />
              <SubmitButton
                pendingText="⏳"
                title="Regenerar esta imagen con IA"
                className="rounded px-1 text-sm text-white hover:text-pulso-accent disabled:opacity-50"
              >
                ↻
              </SubmitButton>
            </form>
            <form action={replaceCarouselSlidePhotoAction}>
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="date" value={date} />
              <input type="hidden" name="creativeId" value={creativeId} />
              <input type="hidden" name="slideIndex" value={i} />
              <label
                title="Reemplazar con una foto propia"
                className="cursor-pointer rounded px-1 text-sm text-white hover:text-pulso-accent"
              >
                ⤴
                <AutoSubmitFileInput name="photo" accept="image/*" className="hidden" />
              </label>
            </form>
          </div>
        </div>
      ))}
    </div>
  );
}

function PublicationBadges({ publications }: { publications: CreativePublication[] | null }) {
  if (!publications || publications.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {publications.map((pub, i) => (
        <span
          key={i}
          className={pub.status === "published" ? "text-emerald-400" : "text-status-pink"}
          title={pub.error_message ?? undefined}
        >
          {pub.status === "published" ? "✓" : "✗"} {pub.platform}
        </span>
      ))}
    </div>
  );
}

interface DetailPageProps {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ month?: string; view?: string }>;
}

export default async function CalendarDetailPage({ params, searchParams }: DetailPageProps) {
  const { date } = await params;
  const sp = await searchParams;
  const backMonth = sp.month ?? date.slice(0, 7);
  const backView = sp.view ?? "grid";

  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const [{ data: slot }, { data: photoFrame }] = await Promise.all([
    supabase.from("content_calendar").select("*").eq("tenant_id", ctx.tenantId).eq("date", date).maybeSingle(),
    supabase
      .from("render_templates")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("component_ref", "photo-frame")
      .maybeSingle(),
  ]);

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

  return (
    <div className="space-y-6">
      <Link
        href={`/calendar?month=${backMonth}&view=${backView}`}
        className="text-sm text-pulso-accent hover:underline"
      >
        ← Volver al calendario
      </Link>

      <div>
        <p className="mb-1 font-display text-xs uppercase tracking-[0.2em] text-pulso-accent">{date}</p>
        <h1 className="font-display text-2xl font-semibold">{slot?.theme ?? "Sin contenido planificado"}</h1>
      </div>

      {slot && (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
          {creative && creative.status !== "failed" ? (
            creative.type === "video" ? (
              <video
                src={`${RENDER_TEMPLATES_URL}/api/render/${creative.id}.mp4`}
                className="w-full"
                controls
              />
            ) : (
              <img
                src={`${RENDER_TEMPLATES_URL}/api/render/${creative.id}.png`}
                alt=""
                className="w-full"
              />
            )
          ) : creative?.status === "failed" ? (
            <div className="flex h-64 items-center justify-center text-status-pink">⚠ Falló el render</div>
          ) : (
            <div className="flex h-64 items-center justify-center text-neutral-600">
              {slot.status === "approved" ? "generando…" : "sin creative todavía"}
            </div>
          )}

          {creative && creative.asset_urls && creative.asset_urls.length > 1 && (
            <div className="border-t border-ink-700 p-3">
              <p className="mb-2 text-xs text-neutral-500">
                {creative.asset_urls.length}{" "}
                {creative.type === "carousel"
                  ? "slides — pasa el mouse sobre uno para regenerarlo con IA (↻) o reemplazarlo con tu propia foto (⤴)."
                  : "fotos listas — click para descargar cada una"}
                {photoFrame && creative.template_id === photoFrame.id && isAppendable(creative)
                  ? ", pasa el mouse y click en × para eliminar una"
                  : ""}
              </p>
              {creative.type === "carousel" ? (
                <CarouselSlideGrid
                  urls={creative.asset_urls}
                  creativeId={creative.id}
                  tenantId={ctx.tenantId}
                  date={date}
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
            <form
              action={addPhotosToCreativeAction}
              className="flex flex-wrap items-end gap-3 border-t border-ink-700 p-3"
            >
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
              <SubmitButton
                pendingText="Agregando…"
                className="rounded-lg bg-pulso-primary px-3 py-1.5 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                Agregar fotos
              </SubmitButton>
            </form>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-ink-700 bg-ink-900 p-4 text-sm">
            <p className={labelClass}>Estado</p>
            <p className="text-neutral-200">
              Slot: <span className="text-neutral-400">{slot.status}</span>
              {creative && (
                <>
                  {" · "}Creative: <span className="text-neutral-400">{creative.status}</span>
                </>
              )}
            </p>

            <div className="mt-3 border-t border-ink-700 pt-3">
              <MoveDateForm tenantId={ctx.tenantId} slotId={slot.id} date={date} />
            </div>

            {creative?.brief ? (
              <div className="mt-3 space-y-1 border-t border-ink-700 pt-3 text-neutral-400">
                {typeof creative.brief === "object" &&
                  creative.brief !== null &&
                  Object.entries(creative.brief as Record<string, unknown>).map(([key, value]) =>
                    key !== "caption" && typeof value === "string" && value ? (
                      <p key={key}>
                        <span className="text-neutral-600">{key}:</span> {value}
                      </p>
                    ) : null,
                  )}
              </div>
            ) : null}

            {creative && (
              <CaptionForm
                tenantId={ctx.tenantId}
                creativeId={creative.id}
                date={date}
                caption={
                  typeof (creative.brief as { caption?: unknown } | null)?.caption === "string"
                    ? ((creative.brief as { caption: string }).caption)
                    : ""
                }
              />
            )}

            {creative?.publications && creative.publications.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-700 pt-3 text-xs">
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

            <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-700 pt-3">
              {creative && creative.status !== "approved" && (
                <form action={approveCreativeAction}>
                  <input type="hidden" name="creativeId" value={creative.id} />
                  <button
                    type="submit"
                    className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-600"
                  >
                    Aprobar
                  </button>
                </form>
              )}
              {creative?.status === "approved" && (
                <form action={requestPublishAction}>
                  <input type="hidden" name="creativeId" value={creative.id} />
                  <button
                    type="submit"
                    className="rounded-lg bg-pulso-primary px-3 py-1.5 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent"
                  >
                    Publicar
                  </button>
                </form>
              )}
            </div>
          </div>

          <form action={updateCalendarSlotAction} className="rounded-xl border border-ink-700 bg-ink-900 p-4">
            <input type="hidden" name="slotId" value={slot.id} />
            {creative && <input type="hidden" name="creativeId" value={creative.id} />}
            <input type="hidden" name="calendarSlotId" value={slot.id} />

            <div className="mb-3">
              <label className={labelClass}>Tema</label>
              <input name="theme" defaultValue={slot.theme} className={fieldClass} />
            </div>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Tipo</label>
                <select name="slotType" defaultValue={slot.slot_type} className={fieldClass}>
                  <option value="post">post</option>
                  <option value="carousel">carousel</option>
                  <option value="story">story</option>
                  <option value="reel">reel</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Estado</label>
                <select name="status" defaultValue={slot.status} className={fieldClass}>
                  <option value="draft">draft</option>
                  <option value="approved">approved</option>
                  <option value="skipped">skipped</option>
                </select>
              </div>
            </div>
            <div className="mb-4">
              <label className={labelClass}>Indicación para mejorar esta pieza</label>
              <textarea
                name="notes"
                rows={4}
                defaultValue={slot.notes ?? ""}
                placeholder="Ej: usa un tono más cercano, agranda la idea principal, prueba con otra foto…"
                className={fieldClass}
              />
              <p className="mt-1 text-xs text-neutral-600">
                Se usa para el texto (titular, subtítulo, precio) tanto en imágenes como en videos. Cambios de
                tamaño de letra, layout o recorte de video todavía no son ajustables desde acá.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-pulso-accent/60"
              >
                Guardar
              </button>
              {creative && (
                <button
                  type="submit"
                  formAction={regenerateCreativeAction}
                  className="rounded-lg bg-pulso-primary px-3 py-1.5 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent"
                >
                  Guardar y regenerar
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
      )}

      {otherPhotoFrameCreatives.length > 0 && (
        <Card className="p-5">
          <CardHeader title="Otras publicaciones con marco de este día" />
          <div className="space-y-4">
            {otherPhotoFrameCreatives.map((c) => (
              <div key={c.id} className="rounded-xl border border-ink-700 bg-ink-900 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-neutral-300">
                    {(c.asset_urls?.length ?? 0)} foto{(c.asset_urls?.length ?? 0) !== 1 ? "s" : ""} ·{" "}
                    <span className="text-neutral-500">{c.status}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {c.status !== "approved" && (
                      <form action={approveCreativeAction}>
                        <input type="hidden" name="creativeId" value={c.id} />
                        <button
                          type="submit"
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-600"
                        >
                          Aprobar
                        </button>
                      </form>
                    )}
                    {c.status === "approved" && (
                      <form action={requestPublishAction}>
                        <input type="hidden" name="creativeId" value={c.id} />
                        <button
                          type="submit"
                          className="rounded-lg bg-pulso-primary px-3 py-1.5 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent"
                        >
                          Publicar
                        </button>
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
                  <form
                    action={addPhotosToCreativeAction}
                    className="mt-3 flex flex-wrap items-end gap-3 border-t border-ink-700 pt-3"
                  >
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
                    <SubmitButton
                      pendingText="Agregando…"
                      className="rounded-lg bg-pulso-primary px-3 py-1.5 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Agregar fotos
                    </SubmitButton>
                  </form>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {photoFrame && (
        <Card className="p-5">
          <CardHeader title="Crear nueva publicación con marco" />
          <p className="mb-4 text-sm text-neutral-500">
            Esto arma una publicación <strong>nueva y separada</strong> para este día — úsalo cuando
            quieras publicar otra cosa distinta, no para sumar fotos a la que ya hiciste (para eso usa
            &quot;Agregar más fotos&quot; arriba). Sube una o varias fotos — cada una se compone
            automáticamente detrás de tu marco (configurado en Marca). Una foto crea una publicación
            normal; dos o más crean un carrusel.
          </p>
          <form action={createPhotoFrameCreativeAction} className="space-y-4">
            <input type="hidden" name="tenantId" value={ctx.tenantId} />
            <input type="hidden" name="date" value={date} />

            <MediaDropzone
              name="photos"
              accept="image/*"
              label="Fotos"
              hint="Arrastra fotos acá o haz click para elegir"
            />

            <div>
              <label className={labelClass}>Texto de la publicación</label>
              <textarea
                name="caption"
                rows={3}
                placeholder="Ej: Nuestra categoría Sub-13 se enfrentó a Academia Los Leones…"
                className={fieldClass}
              />
            </div>

            <SubmitButton
              pendingText="Creando…"
              className="rounded-lg bg-pulso-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              Crear publicación
            </SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
