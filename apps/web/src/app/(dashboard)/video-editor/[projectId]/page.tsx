import { notFound, redirect } from "next/navigation";
import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { ProcessingStatus } from "../processing-status";

/**
 * The project's status decides which of the two real screens it belongs
 * on — this route exists so a bookmarked/shared /video-editor/<id> link
 * always lands somewhere sensible instead of a 404, and so the list page
 * (which can't know a project's exact review/results split ahead of a
 * click) has one safe href for a project that isn't en_revision yet.
 */
export default async function VideoProjectHubPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("video_projects")
    .select("id, nombre, status, error_message")
    .eq("id", projectId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();

  if (!project) notFound();

  if (project.status === "en_revision") redirect(`/video-editor/${projectId}/review`);

  if (project.status === "error") {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow={ctx.tenantName} title={project.nombre} />
        <Card>
          <p className="text-sm text-danger">{project.error_message ?? "El proyecto falló sin un mensaje de error."}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={ctx.tenantName} title={project.nombre} />
      <Card>
        <ProcessingStatus projectId={projectId} initialStatus={project.status} />
      </Card>
    </div>
  );
}
