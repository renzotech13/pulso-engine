import { getTenantContext } from "@/lib/tenant-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { VideoUploadForm } from "./video-upload-form";

export default async function NewVideoProjectPage() {
  const ctx = await getTenantContext();
  const supabase = await createSupabaseServerClient();

  const { data: presets } = await supabase
    .from("video_presets")
    .select("id, nombre, tenant_id")
    .or(`tenant_id.is.null,tenant_id.eq.${ctx.tenantId}`)
    .order("nombre", { ascending: true });

  const presetList = presets ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={ctx.tenantName}
        title="Nuevo proyecto"
        description="Un guion en PDF puede describir uno o más videos — el sistema arma uno por cada uno que encuentre."
      />

      <Card>
        {presetList.length === 0 ? (
          <p className="text-sm text-fg-2">
            No hay ningún preset disponible todavía. Pedile a un administrador que cargue uno antes de crear un proyecto.
          </p>
        ) : (
          <VideoUploadForm tenantId={ctx.tenantId} presets={presetList} />
        )}
      </Card>
    </div>
  );
}
