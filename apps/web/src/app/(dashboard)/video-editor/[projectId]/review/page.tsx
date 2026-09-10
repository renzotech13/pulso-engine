import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveVideoReviewAction, requestVideoRenderAction } from "@/lib/video-editor-actions";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, inputClass, textareaClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/submit-button";

interface EdlSegment {
  archivo: string;
  inicio: number;
  fin: number;
  lineaGuion: string;
  guionTexto?: string;
}
interface Edl {
  videoId: string;
  segmentos: EdlSegment[];
}
interface SubtitleBlock {
  startSec: number;
  endSec: number;
  text: string;
  bajaConfianza: boolean;
}

function fileLabel(storagePath: string): string {
  return storagePath.split("/").pop() ?? storagePath;
}

export default async function VideoProjectReviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("video_projects")
    .select("id, nombre, tenant_id")
    .eq("id", projectId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!project) notFound();

  const { data: videos } = await supabase
    .from("video_project_videos")
    .select("*")
    .eq("project_id", projectId)
    .order("script_id", { ascending: true });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={ctx.tenantName}
        title={`Revisión — ${project.nombre}`}
        description="Corregí lo que haga falta y renderizá cuando esté listo. No hace falta editar segmento por segmento si ya se ve bien."
        actions={
          <Link href="/video-editor" className={buttonClass("secondary")}>
            Volver a proyectos
          </Link>
        }
      />

      {(videos ?? []).length === 0 && (
        <Card>
          <p className="text-sm text-fg-2">Este proyecto todavía no tiene videos — puede que la alineación no haya encontrado ningún archivo que calce con el guion.</p>
        </Card>
      )}

      {(videos ?? []).map((video) => {
        const edl = ((video.edl as Edl | null)?.segmentos ?? []);
        const bloques = ((video.subtitulos as { bloques: SubtitleBlock[] } | null) ?? { bloques: [] }).bloques;
        const readOnly = video.status !== "en_revision";

        return (
          <Card key={video.id}>
            <CardHeader
              title={video.script_id}
              description={video.necesita_revision ? "El parser del PDF no encontró un título explícito para este video — revisalo." : undefined}
              actions={<StatusBadge tone={readOnly ? "blue" : "orange"}>{readOnly ? "Ya renderizado / renderizando" : "En revisión"}</StatusBadge>}
            />

            <form action={saveVideoReviewAction} className="space-y-5">
              <input type="hidden" name="videoId" value={video.id} />
              <input type="hidden" name="projectId" value={projectId} />

              <div className="flex items-center gap-2">
                <input type="checkbox" id={`mostrarTitulo_${video.id}`} name="mostrarTitulo" defaultChecked={video.mostrar_titulo} disabled={readOnly} className="h-4 w-4" />
                <label htmlFor={`mostrarTitulo_${video.id}`} className="text-sm text-fg">
                  Mostrar título en los primeros segundos
                </label>
              </div>

              <Field id={`titulo_${video.id}`} label="Título">
                <input id={`titulo_${video.id}`} name="titulo" defaultValue={video.titulo ?? ""} className={inputClass} disabled={readOnly} />
              </Field>

              <Field id={`guion_${video.id}`} label="Guion asignado" hint="Solo de referencia acá — para corregir el texto que se muestra, editá los bloques de subtítulos más abajo.">
                <textarea id={`guion_${video.id}`} readOnly value={video.guion} rows={3} className={`${textareaClass} bg-surface-2`} />
              </Field>

              <div>
                <p className="eyebrow mb-2 text-fg-3">Segmentos ({edl.length})</p>
                <div className="space-y-2">
                  {edl.map((segment, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-btn border border-line bg-surface-2/40 p-3">
                      <input type="checkbox" name={`segIncluded_${i}`} defaultChecked disabled={readOnly} className="mt-1 h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="truncate text-sm text-fg">{segment.guionTexto ?? segment.lineaGuion}</p>
                        <p className="text-xs text-fg-3">{fileLabel(segment.archivo)}</p>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="0.01"
                            name={`segInicio_${i}`}
                            defaultValue={segment.inicio}
                            disabled={readOnly}
                            className={`${inputClass} w-28 text-xs`}
                            aria-label="Inicio (segundos)"
                          />
                          <input
                            type="number"
                            step="0.01"
                            name={`segFin_${i}`}
                            defaultValue={segment.fin}
                            disabled={readOnly}
                            className={`${inputClass} w-28 text-xs`}
                            aria-label="Fin (segundos)"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="eyebrow mb-2 text-fg-3">Subtítulos ({bloques.length})</p>
                <div className="space-y-2">
                  {bloques.map((block, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        name={`subText_${i}`}
                        defaultValue={block.text}
                        disabled={readOnly}
                        className={`${inputClass} ${block.bajaConfianza ? "border-amber" : ""}`}
                      />
                      {block.bajaConfianza && (
                        <span className="shrink-0 text-xs text-amber" title="El texto no pudo confirmarse contra el guion — revisalo">
                          baja confianza
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {!readOnly && <SubmitButton variant="secondary">Guardar cambios</SubmitButton>}
            </form>

            {!readOnly && (
              <form action={requestVideoRenderAction} className="mt-3">
                <input type="hidden" name="videoId" value={video.id} />
                <input type="hidden" name="projectId" value={projectId} />
                <SubmitButton pendingText="Enviando…">Renderizar</SubmitButton>
              </form>
            )}

            {readOnly && (
              <Link href={`/video-editor/${projectId}/results`} className="mt-3 inline-block text-sm text-accent-ink hover:underline">
                Ver resultados →
              </Link>
            )}
          </Card>
        );
      })}
    </div>
  );
}
