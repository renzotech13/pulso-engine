import { ExternalLink, Images, X } from "lucide-react";
import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  deleteMediaAssetAction,
  updateMediaAssetTagsAction,
  upsertBrandKitAction,
  upsertPhotoFrameAction,
  uploadMediaAssetsAction,
} from "@/lib/actions";
import { MediaDropzone } from "@/components/media-dropzone";
import { SubmitButton } from "@/components/submit-button";
import { ColorField, TonePresets } from "@/components/tone-presets";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, inputClass, labelClass, selectClass, textareaClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

const DEFAULT_COLOR_PRIMARY = "#7C6FF0";
const DEFAULT_COLOR_SECONDARY = "#FF8B5E";

const PHOTO_FRAME_ASPECT_RATIOS = [
  { value: "1:1", label: "Cuadrado 1:1 (1080×1080)" },
  { value: "4:5", label: "Vertical 4:5 (1080×1350)" },
  { value: "9:16", label: "Historia 9:16 (1080×1920)" },
] as const;

function aspectRatioFor(width: number | null, height: number | null): string {
  if (width === 1080 && height === 1350) return "4:5";
  if (width === 1080 && height === 1920) return "9:16";
  return "1:1";
}

/** What the photo bank says about each asset — never a raw DB field. */
function assetStatus(asset: {
  tagged_at: string | null;
  last_used_at: string | null;
  tag_attempts: number;
}): { label: string; tone: StatusTone } {
  if (asset.tagged_at) {
    if (asset.last_used_at) {
      const days = Math.max(0, Math.round((Date.now() - Date.parse(asset.last_used_at)) / 86_400_000));
      return {
        label: days === 0 ? "Usada hoy" : days === 1 ? "Usada ayer" : `Usada hace ${days} días`,
        tone: "green",
      };
    }
    return { label: "Sin usar todavía", tone: "grey" };
  }
  if (asset.tag_attempts >= 3) return { label: "Sin etiquetar — edítala a mano", tone: "pink" };
  return { label: "Etiquetando…", tone: "orange" };
}

export default async function BrandKitPage() {
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const [{ data: brandKit }, { data: photoFrame }, { data: mediaAssets }] = await Promise.all([
    supabase.from("brand_kits").select("*").eq("tenant_id", ctx.tenantId).maybeSingle(),
    supabase
      .from("render_templates")
      .select("frame_image_url, canvas_width, canvas_height")
      .eq("tenant_id", ctx.tenantId)
      .eq("component_ref", "photo-frame")
      .maybeSingle(),
    supabase
      .from("media_assets")
      .select("id, url, tags, description, tag_source, tagged_at, tag_attempts, tag_error, last_used_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("kind", "image")
      .order("created_at", { ascending: false }),
  ]);

  const colorPrimary = brandKit?.color_primary ?? DEFAULT_COLOR_PRIMARY;
  const colorSecondary = brandKit?.color_secondary ?? DEFAULT_COLOR_SECONDARY;
  const assets = mediaAssets ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={ctx.tenantName}
        title="Marca"
        description="Esto es lo que el Creative usa para componer cada pieza: logo, colores y el tono con el que le habla a tus clientes."
      />

      <Card>
        <CardHeader
          title="Identidad"
          description="Logo, colores y voz. Todo agente parte de acá antes de escribir o diseñar."
        />
        <form action={upsertBrandKitAction} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <input type="hidden" name="tenantId" value={ctx.tenantId} />

          <div className="sm:col-span-2">
            <MediaDropzone
              name="logo"
              accept="image/*"
              label="Logo"
              hint="Arrastra tu logo acá o haz click para elegir"
              multiple={false}
              {...(brandKit?.logo_url ? { currentPreviewUrl: brandKit.logo_url } : {})}
            />
          </div>

          <ColorField name="colorPrimary" label="Color primario" defaultValue={colorPrimary} />
          <ColorField name="colorSecondary" label="Color secundario" defaultValue={colorSecondary} />

          <div className="sm:col-span-2">
            <p className={labelClass}>Así se ven tus colores juntos</p>
            <div
              className="flex h-28 w-full max-w-sm items-end rounded-xl border border-ink-700 p-4"
              style={{
                background: `radial-gradient(circle at 30% 20%, ${colorSecondary} 0%, ${colorPrimary} 65%)`,
              }}
            >
              <span className="font-display text-lg font-semibold text-white drop-shadow">
                {ctx.tenantName}
              </span>
            </div>
            <p className="mt-1 text-xs text-neutral-600">La vista previa se actualiza al guardar.</p>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="toneDescription" className={labelClass}>
              Tono de voz
            </label>
            <TonePresets
              id="toneDescription"
              name="toneDescription"
              defaultValue={brandKit?.tone_description ?? ""}
            />
          </div>

          <Field
            id="voiceTraining"
            label="Entrenamiento"
            hint="Indicaciones libres que todo agente tiene en cuenta al escribir el copy (titular, subtítulo, caption): detalles del negocio, temas puntuales, CTAs, firmas, cosas que evitar. Se suma al tono de voz, no lo reemplaza. No dirige las fotos generadas — para eso usa Dirección de arte, abajo."
            className="sm:col-span-2"
          >
            <textarea
              id="voiceTraining"
              name="voiceTraining"
              rows={8}
              placeholder="Ej: nunca menciones a la competencia. Somos expertos en trámites de importación, no solo logística. Evita la palabra 'sinergia'. El Puerto de Chancay ya no es novedad para nuestros clientes desde julio 2026..."
              defaultValue={brandKit?.voice_training ?? ""}
              className={textareaClass}
            />
          </Field>

          <Field
            id="artDirection"
            label="Dirección de arte"
            hint="Solo lo fotográfico: tipo de escena, personas, lugar, tratamiento de color, qué evitar. No pongas tipografía, textos, titulares ni CTAs — eso va en Entrenamiento y nunca se dibuja: si lo pones acá, el modelo intentará dibujarlo (así salió el primer post con la firma del dueño y un botón de WhatsApp pintados en la foto)."
            className="sm:col-span-2"
          >
            <textarea
              id="artDirection"
              name="artDirection"
              rows={5}
              placeholder="Ej: fotografía documental realista de emprendedores peruanos en su contexto de trabajo (taller, tienda, oficina pequeña), luz natural, escala de grises o virado camel. Evitar: imaginería de casino o apuesta, stock corporativo genérico, logos de terceros."
              defaultValue={brandKit?.art_direction ?? ""}
              className={textareaClass}
            />
          </Field>

          <Field
            id="bannedPhrases"
            label="Frases prohibidas"
            hint="Una por línea. A diferencia del entrenamiento, esto no es una sugerencia para el modelo: si una pieza sale con alguna de estas frases, se rechaza y se vuelve a redactar automáticamente. Sin distinguir mayúsculas ni tildes."
            className="sm:col-span-2"
          >
            <textarea
              id="bannedPhrases"
              name="bannedPhrases"
              rows={4}
              placeholder={"sin sustos\nsinergia\nsoluciones integrales"}
              defaultValue={(brandKit?.banned_phrases ?? []).join("\n")}
              className={textareaClass}
            />
          </Field>

          <Field id="websiteUrl" label="Sitio web" className="sm:col-span-2">
            <input
              id="websiteUrl"
              name="websiteUrl"
              type="url"
              placeholder="https://tuempresa.com"
              defaultValue={brandKit?.website_url ?? ""}
              className={inputClass}
            />
          </Field>

          <div className="sm:col-span-2">
            <MediaDropzone
              name="briefDocument"
              accept=".pdf,.txt,application/pdf,text/plain"
              label="Brief del negocio (PDF o TXT)"
              hint="Arrastra un PDF o TXT con contexto del negocio, o haz click para elegir"
              multiple={false}
            />
            {brandKit?.brief_document_url && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500">
                Archivo actual:
                <a
                  href={brandKit.brief_document_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-pulso-accent hover:underline"
                >
                  {brandKit.brief_document_name ?? "ver documento"}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              </p>
            )}
          </div>

          <div className="flex justify-end border-t border-ink-700 pt-4 sm:col-span-2">
            <SubmitButton pendingText="Guardando…">Guardar</SubmitButton>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Marco de publicaciones"
          description="Sube tu propio marco (PNG con transparencia) y elige en qué tamaño trabaja. En cada día del calendario vas a poder subir una o varias fotos y se componen automáticamente detrás de este marco — cada foto se ajusta para cubrir todo el cuadro, sin dejar espacios vacíos."
        />
        <form action={upsertPhotoFrameAction} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <input type="hidden" name="tenantId" value={ctx.tenantId} />

          <div className="sm:col-span-2">
            <MediaDropzone
              name="frame"
              accept="image/png"
              label="Marco (PNG, fondo transparente)"
              hint="Arrastra tu marco acá o haz click para elegir"
              multiple={false}
              {...(photoFrame?.frame_image_url ? { currentPreviewUrl: photoFrame.frame_image_url } : {})}
            />
          </div>

          <Field id="aspectRatio" label="Relación de aspecto">
            <select
              id="aspectRatio"
              name="aspectRatio"
              defaultValue={aspectRatioFor(photoFrame?.canvas_width ?? null, photoFrame?.canvas_height ?? null)}
              className={selectClass}
            >
              {PHOTO_FRAME_ASPECT_RATIOS.map((ratio) => (
                <option key={ratio.value} value={ratio.value}>
                  {ratio.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex items-end justify-end">
            <SubmitButton pendingText="Guardando…">Guardar marco</SubmitButton>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Banco de fotos"
          description="Fotos reales de tu negocio que el Creative usa de fondo (con título, subtítulo y colores de marca encima). Cada foto se describe una sola vez con IA y desde ahí se elige por tema; puedes corregir las etiquetas de cualquiera. Las fotos generadas con IA se alternan con estas según lo configurado para tu negocio."
        />
        <form action={uploadMediaAssetsAction} className="mb-5 flex flex-wrap items-end gap-3">
          <input type="hidden" name="tenantId" value={ctx.tenantId} />
          <div className="min-w-[220px] flex-1">
            <MediaDropzone
              name="photos"
              accept="image/*"
              label="Fotos"
              hint="Arrastra fotos acá o haz click para elegir"
            />
          </div>
          <SubmitButton pendingText="Subiendo…">Agregar al banco</SubmitButton>
        </form>

        {assets.length === 0 ? (
          <EmptyState
            icon={<Images size={28} aria-hidden="true" />}
            title="Todavía no hay fotos en el banco"
            description="Sube fotos reales de tu local, tu equipo o tus productos y el Creative las va a usar de fondo en los posts."
          />
        ) : (
          <>
            <p className="mb-3 text-xs text-neutral-500">
              {assets.length} {assets.length === 1 ? "foto" : "fotos"} ·{" "}
              {assets.filter((a) => !a.last_used_at).length} sin usar ·{" "}
              {assets.filter((a) => a.tagged_at).length} etiquetadas
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {assets.map((asset) => {
                const status = assetStatus(asset);
                return (
                  <div key={asset.id} className="rounded-lg border border-ink-700 bg-ink-950/60 p-2">
                    <div className="group relative aspect-square overflow-hidden rounded-md">
                      <img src={asset.url} alt={asset.description ?? ""} className="h-full w-full object-cover" />
                      <form action={deleteMediaAssetAction} className="absolute right-1 top-1">
                        <input type="hidden" name="tenantId" value={ctx.tenantId} />
                        <input type="hidden" name="assetId" value={asset.id} />
                        <button
                          type="submit"
                          title="Eliminar esta foto"
                          aria-label="Eliminar esta foto"
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-950/80 text-white opacity-0 transition-opacity duration-150 hover:bg-status-pink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulso-accent/60 group-hover:opacity-100"
                        >
                          <X size={12} aria-hidden="true" />
                        </button>
                      </form>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {asset.tags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-ink-700 px-2 py-0.5 text-[10px] text-neutral-400"
                        >
                          {tag}
                        </span>
                      ))}
                      {asset.tags.length > 4 && (
                        <span className="px-1 text-[10px] text-neutral-600">+{asset.tags.length - 4}</span>
                      )}
                    </div>
                    <div className="mt-2">
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] text-pulso-accent hover:underline">
                        Editar etiquetas
                      </summary>
                      <form action={updateMediaAssetTagsAction} className="mt-2 space-y-2">
                        <input type="hidden" name="tenantId" value={ctx.tenantId} />
                        <input type="hidden" name="assetId" value={asset.id} />
                        <input
                          name="tags"
                          aria-label="Etiquetas"
                          defaultValue={asset.tags.join(", ")}
                          placeholder="emprendedora, taller, sunat"
                          className={`${inputClass} text-xs`}
                        />
                        <textarea
                          name="description"
                          aria-label="Descripción"
                          rows={2}
                          defaultValue={asset.description ?? ""}
                          placeholder="Qué se ve en la foto"
                          className={`${textareaClass} text-xs`}
                        />
                        <SubmitButton variant="subtle" size="sm" pendingText="Guardando…">
                          Guardar
                        </SubmitButton>
                      </form>
                    </details>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
