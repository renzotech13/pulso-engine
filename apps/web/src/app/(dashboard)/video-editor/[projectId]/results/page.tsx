import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateProjectPresetAction, requestVideoRenderAction } from "@/lib/video-editor-actions";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { selectClass } from "@/components/ui/field";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { RenderStatus } from "../../render-status";

const VIDEO_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  en_revision: { label: "En revisión", tone: "orange" },
  renderizando: { label: "Renderizando", tone: "blue" },
  listo: { label: "Listo", tone: "green" },
  error: { label: "Error", tone: "pink" },
};

const OUTPUT_BUCKET = "video-editor-output";
const SIGNED_URL_TTL_SECONDS = 60 * 30;

export default async function VideoProjectResultsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("video_projects")
    .select("id, nombre, preset_id, tenant_id")
    .eq("id", projectId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!project) notFound();

  const [{ data: videos }, { data: presets }] = await Promise.all([
    supabase.from("video_project_videos").select("*").eq("project_id", projectId).order("script_id", { ascending: true }),
    supabase
      .from("video_presets")
      .select("id, nombre")
      .or(`tenant_id.is.null,tenant_id.eq.${ctx.tenantId}`)
      .order("nombre", { ascending: true }),
  ]);

  // Signed URLs, not stored public ones: video-editor-output is a private
  // bucket (Fase 3 migration) since a render might not be approved for
  // publishing yet — every page load mints a fresh, short-lived link
  // instead of ever persisting one that could outlive that intent.
  const withUrls = await Promise.all(
    (videos ?? []).map(async (video) => {
      const [mp4, srt] = await Promise.all([
        video.output_mp4_path
          ? supabase.storage.from(OUTPUT_BUCKET).createSignedUrl(video.output_mp4_path, SIGNED_URL_TTL_SECONDS)
          : Promise.resolve({ data: null }),
        video.output_srt_path
          ? supabase.storage.from(OUTPUT_BUCKET).createSignedUrl(video.output_srt_path, SIGNED_URL_TTL_SECONDS)
          : Promise.resolve({ data: null }),
      ]);
      return { video, mp4Url: mp4.data?.signedUrl, srtUrl: srt.data?.signedUrl };
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={ctx.tenantName}
        title={`Resultados — ${project.nombre}`}
        actions={
          <Link href="/video-editor" className={buttonClass("secondary")}>
            Volver a proyectos
          </Link>
        }
      />

      {withUrls.length === 0 && (
        <Card>
          <p className="text-sm text-fg-2">Este proyecto todavía no tiene ningún video renderizado.</p>
        </Card>
      )}

      {withUrls.map(({ video, mp4Url, srtUrl }) => {
        const status = VIDEO_STATUS[video.status] ?? { label: video.status, tone: "grey" as const };
        return (
          <Card key={video.id}>
            <CardHeader title={video.script_id} actions={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>} />

            <RenderStatus videoId={video.id} initialStatus={video.status} />

            {video.status === "error" && <p className="text-sm text-danger">{video.error_message}</p>}

            {video.status === "listo" && mp4Url && (
              <div className="flex flex-wrap items-center gap-3">
                <a href={mp4Url} className={buttonClass("secondary")}>
                  <Download size={16} aria-hidden="true" />
                  Descargar MP4
                </a>
                {srtUrl && (
                  <a href={srtUrl} className={buttonClass("secondary")}>
                    <Download size={16} aria-hidden="true" />
                    Descargar SRT
                  </a>
                )}
              </div>
            )}

            {video.status !== "renderizando" && (presets ?? []).length > 1 && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="eyebrow mb-2 text-fg-3">Re-renderizar con otro preset</p>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={updateProjectPresetAction} className="flex items-center gap-2">
                    <input type="hidden" name="projectId" value={projectId} />
                    <select name="presetId" defaultValue={project.preset_id} className={`${selectClass} w-56`}>
                      {(presets ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre}
                        </option>
                      ))}
                    </select>
                    <SubmitButton variant="secondary" size="sm">
                      Guardar preset
                    </SubmitButton>
                  </form>
                  <form action={requestVideoRenderAction}>
                    <input type="hidden" name="videoId" value={video.id} />
                    <input type="hidden" name="projectId" value={projectId} />
                    <SubmitButton size="sm">Re-renderizar</SubmitButton>
                  </form>
                </div>
                <p className="mt-1.5 text-xs text-fg-3">No se vuelve a transcribir ni a alinear — solo se rehace el render final.</p>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
