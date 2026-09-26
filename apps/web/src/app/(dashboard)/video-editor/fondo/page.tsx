import Link from "next/link";
import { Download, Layers } from "lucide-react";
import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/labels";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { BgReplaceForm } from "./bg-replace-form";
import { BgReplaceStatus } from "./bg-replace-status";

const JOB_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pendiente: { label: "En cola", tone: "grey" },
  procesando: { label: "Procesando", tone: "blue" },
  listo: { label: "Listo", tone: "green" },
  error: { label: "Error", tone: "pink" },
};

const OUTPUT_BUCKET = "video-editor-output";
const SIGNED_URL_TTL_SECONDS = 60 * 30;

export default async function BgReplacePage() {
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const { data: jobs } = await supabase
    .from("video_bg_replace_jobs")
    .select("id, nombre, status, progress, cut_position, output_path, error_message, created_at")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(30);

  // Two signed URLs per finished job: one plain (for the <video> preview)
  // and one with download:true, which sets Content-Disposition — the
  // `download` attribute alone is ignored on a cross-origin link.
  const withUrls = await Promise.all(
    (jobs ?? []).map(async (job) => {
      if (job.status !== "listo" || !job.output_path) return { job };
      const bucket = supabase.storage.from(OUTPUT_BUCKET);
      const [preview, download] = await Promise.all([
        bucket.createSignedUrl(job.output_path, SIGNED_URL_TTL_SECONDS),
        bucket.createSignedUrl(job.output_path, SIGNED_URL_TTL_SECONDS, { download: `${job.nombre}.mp4` }),
      ]);
      return { job, previewUrl: preview.data?.signedUrl, downloadUrl: download.data?.signedUrl };
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={ctx.tenantName}
        title="Reemplazo de fondo"
        description="Subí una toma con la persona y un video de fondo: RVM recorta a la persona y pone el video corriendo detrás, desde la altura del corte hacia arriba."
        actions={
          <Link href="/video-editor" className={buttonClass("secondary")}>
            Volver a proyectos
          </Link>
        }
      />

      <Card>
        <BgReplaceForm tenantId={ctx.tenantId} />
      </Card>

      <Card>
        <CardHeader title="Trabajos" description="El MP4 resultante se puede subir como toma cruda en un proyecto nuevo." />
        {withUrls.length === 0 ? (
          <EmptyState icon={<Layers size={28} />} title="Todavía no hay trabajos" description="Subí tus dos videos arriba para empezar." />
        ) : (
          <div className="divide-y divide-line">
            {withUrls.map(({ job, previewUrl, downloadUrl }) => {
              const status = JOB_STATUS[job.status] ?? { label: job.status, tone: "grey" as const };
              return (
                <div key={job.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{job.nombre}</p>
                      <p className="text-xs text-fg-3">
                        {formatDateTime(job.created_at)} · corte al {Math.round(Number(job.cut_position) * 100)}%
                      </p>
                    </div>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </div>

                  <BgReplaceStatus jobId={job.id} initialStatus={job.status} initialProgress={job.progress} />

                  {job.status === "error" && <p className="text-sm text-danger">{job.error_message ?? "Falló sin un mensaje de error."}</p>}

                  {previewUrl && (
                    <div className="space-y-3">
                      <video src={previewUrl} controls preload="metadata" className="max-h-96 w-full rounded-card bg-ink" />
                      {downloadUrl && (
                        <a href={downloadUrl} className={buttonClass("secondary")}>
                          <Download size={16} aria-hidden="true" />
                          Descargar MP4
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
