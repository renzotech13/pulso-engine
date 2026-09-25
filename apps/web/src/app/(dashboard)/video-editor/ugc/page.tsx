import Link from "next/link";
import { Download, Film, Wallet } from "lucide-react";
import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/labels";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { UgcForm } from "./ugc-form";
import { UgcJobActions } from "./ugc-job-actions";
import { UgcStatus } from "./ugc-status";

const JOB_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pendiente: { label: "En cola", tone: "grey" },
  generando: { label: "Generando", tone: "blue" },
  extendiendo: { label: "Extendiendo", tone: "blue" },
  armando: { label: "Armando", tone: "blue" },
  listo: { label: "Listo", tone: "green" },
  error: { label: "Error", tone: "pink" },
};

const OUTPUT_BUCKET = "video-editor-output";
const SIGNED_URL_TTL_SECONDS = 60 * 30;

export default async function UgcFactoryPage() {
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const { data: jobs } = await supabase
    .from("video_ugc_jobs")
    .select("id, nombre, batch_id, preset, status, progress, output_path, task_ids, error_message, cost_usd, saldo_apimart, created_at")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(60);

  const lista = jobs ?? [];
  const listos = lista.filter((j) => j.status === "listo").length;
  const enCurso = lista.filter((j) => !["listo", "error"].includes(j.status)).length;
  const gasto = lista.reduce((sum, j) => sum + Number(j.cost_usd), 0);
  const saldo = lista.find((j) => j.saldo_apimart !== null)?.saldo_apimart ?? null;

  // Dos URLs firmadas por video listo: una para el <video> y otra con download, que fija Content-Disposition
  // (el atributo `download` solo se ignora en un enlace de otro origen).
  const bucket = supabase.storage.from(OUTPUT_BUCKET);
  const conUrls = await Promise.all(
    lista.map(async (job) => {
      if (job.status !== "listo" || !job.output_path) return { job };
      const salida45 = (job.task_ids as { salida45?: string } | null)?.salida45;
      const [preview, download, download45] = await Promise.all([
        bucket.createSignedUrl(job.output_path, SIGNED_URL_TTL_SECONDS),
        bucket.createSignedUrl(job.output_path, SIGNED_URL_TTL_SECONDS, { download: `${job.nombre}-9x16.mp4` }),
        salida45 ? bucket.createSignedUrl(salida45, SIGNED_URL_TTL_SECONDS, { download: `${job.nombre}-4x5.mp4` }) : Promise.resolve(null),
      ]);
      return { job, previewUrl: preview.data?.signedUrl, downloadUrl: download.data?.signedUrl, download45Url: download45?.data?.signedUrl };
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={ctx.tenantName}
        title="Fábrica de video UGC"
        description="Elige el tipo de video (UGC con protagonista hablando, o situación de un comerciante con voz en off), los elementos de marca y genera uno o un lote. Todo sale en 9:16 y 4:5 con zona segura."
        actions={
          <Link href="/video-editor" className={buttonClass("secondary")}>
            Volver al editor
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card padding="sm">
          <p className="eyebrow text-fg-3">Videos listos</p>
          <p className="font-display text-2xl text-fg">{listos}</p>
          {enCurso > 0 && <p className="text-xs text-fg-3">{enCurso} en curso</p>}
        </Card>
        <Card padding="sm">
          <p className="eyebrow text-fg-3">Gasto registrado</p>
          <p className="font-display text-2xl text-fg">US${gasto.toFixed(2)}</p>
          <p className="text-xs text-fg-3">de los últimos 60 videos</p>
        </Card>
        <Card padding="sm">
          <p className="eyebrow flex items-center gap-1 text-fg-3">
            <Wallet size={12} aria-hidden="true" /> Saldo de APIMart
          </p>
          <p className="font-display text-2xl text-fg">{saldo === null ? "—" : `US$${Number(saldo).toFixed(2)}`}</p>
          <p className="text-xs text-fg-3">Se actualiza cada vez que se genera un video</p>
        </Card>
      </div>

      <Card>
        <CardHeader title="Nueva producción" description="Un video o un lote de hasta 30. UGC parte de la foto de la protagonista; la situación genera sus propias imágenes." />
        <UgcForm tenantId={ctx.tenantId} />
      </Card>

      <Card>
        <CardHeader title="Videos recientes" description="Los enlaces de reproducción y descarga duran 30 minutos; recarga la página para renovarlos." />
        {conUrls.length === 0 ? (
          <EmptyState icon={<Film size={28} />} title="Todavía no hay videos" description="Completa el formulario de arriba para generar el primero." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {conUrls.map(({ job, previewUrl, downloadUrl, download45Url }) => {
              const status = JOB_STATUS[job.status] ?? { label: job.status, tone: "grey" as const };
              return (
                <div key={job.id} className="space-y-3 rounded-card border border-line bg-surface p-3">
                  {previewUrl ? (
                    <video src={previewUrl} controls preload="metadata" className="mx-auto aspect-[9/16] max-h-[420px] w-full rounded-btn bg-black object-contain" />
                  ) : (
                    <div className="flex aspect-[9/16] max-h-[420px] w-full items-center justify-center rounded-btn bg-surface-2 text-fg-3">
                      <Film size={28} aria-hidden="true" />
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{job.nombre}</p>
                      <p className="text-xs text-fg-3">
                        {formatDateTime(job.created_at)}
                        {Number(job.cost_usd) > 0 && ` · US$${Number(job.cost_usd).toFixed(2)}`}
                        {job.preset === "situacion" ? " · situación" : " · UGC"}{job.batch_id && " · lote"}
                      </p>
                    </div>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </div>
                  <UgcStatus jobId={job.id} initialStatus={job.status} initialProgress={job.progress} preset={job.preset} />
                  {job.status === "error" && job.error_message && <p className="text-xs text-danger">{job.error_message}</p>}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {downloadUrl ? (
                      <div className="flex flex-wrap gap-2">
                        <a href={downloadUrl} className={buttonClass("secondary", "sm")}>
                          <Download size={14} aria-hidden="true" /> 9:16
                        </a>
                        {download45Url && (
                          <a href={download45Url} className={buttonClass("secondary", "sm")}>
                            <Download size={14} aria-hidden="true" /> 4:5
                          </a>
                        )}
                      </div>
                    ) : (
                      <span />
                    )}
                    <UgcJobActions jobId={job.id} canRegenerate={job.status === "listo" || job.status === "error"} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
