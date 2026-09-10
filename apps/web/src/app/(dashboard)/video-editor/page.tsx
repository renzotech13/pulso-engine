import Link from "next/link";
import { Clapperboard, Plus } from "lucide-react";
import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/labels";

const PROJECT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  subido: { label: "Subido", tone: "grey" },
  leyendo_guion: { label: "Leyendo guion", tone: "blue" },
  transcribiendo: { label: "Transcribiendo", tone: "blue" },
  en_revision: { label: "En revisión", tone: "orange" },
  error: { label: "Error", tone: "pink" },
};

export default async function VideoEditorPage() {
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const { data: projects } = await supabase
    .from("video_projects")
    .select("id, nombre, status, created_at")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false });

  const projectList = projects ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={ctx.tenantName}
        title="Editor de Video"
        description="Subí tomas en crudo y un guion en PDF — el sistema transcribe, arma el corte, pone título y subtítulos con tu línea gráfica, y mezcla música. Vos solo revisás y aprobás."
        actions={
          <Link href="/video-editor/new" className={buttonClass()}>
            <Plus size={16} aria-hidden="true" />
            Nuevo proyecto
          </Link>
        }
      />

      <Card>
        {projectList.length === 0 ? (
          <EmptyState
            icon={<Clapperboard size={28} />}
            title="Todavía no hay proyectos"
            description="Creá uno nuevo para subir tus primeras tomas."
            action={
              <Link href="/video-editor/new" className={buttonClass()}>
                Nuevo proyecto
              </Link>
            }
          />
        ) : (
          <div className="divide-y divide-line">
            {projectList.map((project) => {
              const status = PROJECT_STATUS[project.status] ?? { label: project.status, tone: "grey" as const };
              const href = project.status === "en_revision" ? `/video-editor/${project.id}/review` : `/video-editor/${project.id}`;
              return (
                <Link
                  key={project.id}
                  href={href}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:bg-surface-2/40"
                >
                  <div>
                    <p className="text-sm font-medium text-fg">{project.nombre}</p>
                    <p className="text-xs text-fg-3">{formatDateTime(project.created_at)}</p>
                  </div>
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
