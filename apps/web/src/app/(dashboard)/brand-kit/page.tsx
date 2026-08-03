import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { upsertBrandKitAction, upsertPhotoFrameAction } from "@/lib/actions";
import { MediaDropzone } from "@/components/media-dropzone";
import { TonePresets } from "@/components/tone-presets";
import { inputClass, labelClass } from "@/components/ui/field";
import { Card, CardHeader } from "@/components/ui/card";

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

export default async function BrandKitPage() {
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const [{ data: brandKit }, { data: photoFrame }] = await Promise.all([
    supabase.from("brand_kits").select("*").eq("tenant_id", ctx.tenantId).maybeSingle(),
    supabase
      .from("render_templates")
      .select("frame_image_url, canvas_width, canvas_height")
      .eq("tenant_id", ctx.tenantId)
      .eq("component_ref", "photo-frame")
      .maybeSingle(),
  ]);

  const colorPrimary = brandKit?.color_primary ?? DEFAULT_COLOR_PRIMARY;
  const colorSecondary = brandKit?.color_secondary ?? DEFAULT_COLOR_SECONDARY;

  return (
    <div className="space-y-8">
      <div>
        <p className="mb-1 font-display text-xs uppercase tracking-[0.2em] text-pulso-accent">
          Marca
        </p>
        <h1 className="font-display text-2xl font-semibold">{ctx.tenantName}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Esto es lo que el Creative usa para componer cada pieza: logo, colores y el tono con el
          que le habla a tus clientes.
        </p>
      </div>

      <form
        action={upsertBrandKitAction}
        className="grid grid-cols-1 gap-6 rounded-xl border border-ink-700 bg-ink-900 p-5 sm:grid-cols-2"
      >
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

        <div>
          <label className={labelClass}>Color primario</label>
          <input
            name="colorPrimary"
            type="color"
            defaultValue={colorPrimary}
            className="h-10 w-full cursor-pointer rounded-lg border border-ink-700 bg-ink-900 p-1"
          />
        </div>

        <div>
          <label className={labelClass}>Color secundario</label>
          <input
            name="colorSecondary"
            type="color"
            defaultValue={colorSecondary}
            className="h-10 w-full cursor-pointer rounded-lg border border-ink-700 bg-ink-900 p-1"
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>Tono de voz</label>
          <TonePresets name="toneDescription" defaultValue={brandKit?.tone_description ?? ""} />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>Sitio web</label>
          <input
            name="websiteUrl"
            type="url"
            placeholder="https://tuempresa.com"
            defaultValue={brandKit?.website_url ?? ""}
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <MediaDropzone
            name="briefDocument"
            accept=".pdf,.txt,application/pdf,text/plain"
            label="Brief del negocio (PDF o TXT)"
            hint="Arrastra un PDF o TXT con contexto del negocio, o haz click para elegir"
            multiple={false}
          />
          {brandKit?.brief_document_url && (
            <p className="mt-2 text-xs text-neutral-500">
              Archivo actual:{" "}
              <a
                href={brandKit.brief_document_url}
                target="_blank"
                rel="noreferrer"
                className="text-pulso-accent hover:underline"
              >
                {brandKit.brief_document_name ?? "ver documento"}
              </a>
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <button
            type="submit"
            className="rounded-lg bg-pulso-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent"
          >
            Guardar
          </button>
        </div>
      </form>

      <Card className="p-5">
        <CardHeader title="Marco de publicaciones" />
        <p className="mb-4 text-sm text-neutral-500">
          Sube tu propio marco (PNG con transparencia) y elige en qué tamaño trabaja. Después, en
          cada día del calendario vas a poder subir una o varias fotos y se van a componer
          automáticamente detrás de este marco — cada foto se ajusta para cubrir todo el cuadro,
          sin dejar espacios vacíos.
        </p>
        <form action={upsertPhotoFrameAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

          <div>
            <label className={labelClass}>Relación de aspecto</label>
            <select
              name="aspectRatio"
              defaultValue={aspectRatioFor(photoFrame?.canvas_width ?? null, photoFrame?.canvas_height ?? null)}
              className={inputClass}
            >
              {PHOTO_FRAME_ASPECT_RATIOS.map((ratio) => (
                <option key={ratio.value} value={ratio.value}>
                  {ratio.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-pulso-primary px-4 py-2 text-sm font-medium text-white transition-colors duration-300 ease-in-out hover:bg-pulso-accent"
            >
              Guardar marco
            </button>
          </div>
        </form>
      </Card>

      <section>
        <h2 className="mb-3 font-display text-sm font-semibold text-neutral-300">
          Así se ven tus colores juntos
        </h2>
        <div
          className="flex h-32 w-full max-w-sm items-end rounded-xl p-4"
          style={{
            background: `radial-gradient(circle at 30% 20%, ${colorSecondary} 0%, ${colorPrimary} 65%)`,
          }}
        >
          <span className="font-display text-lg font-semibold text-white drop-shadow">
            {ctx.tenantName}
          </span>
        </div>
      </section>
    </div>
  );
}
