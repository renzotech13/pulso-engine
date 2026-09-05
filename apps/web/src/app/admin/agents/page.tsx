import { getTenantContext } from "@/lib/tenant-context";
import { AgentRunsTable } from "@/components/agent-runs-table";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export default async function AgentsPage() {
  const ctx = await getTenantContext();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operador"
        title="Corridas de agentes"
        description={`Últimas 50 ejecuciones de ${ctx.tenantName}. Se actualiza solo cada pocos segundos.`}
      />
      <Card>
        <CardHeader title="Historial" description="Del más reciente al más antiguo" />
        <AgentRunsTable tenantId={ctx.tenantId} />
      </Card>
    </div>
  );
}
