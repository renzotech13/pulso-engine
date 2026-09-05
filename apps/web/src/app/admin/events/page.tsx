import { getTenantContext } from "@/lib/tenant-context";
import { EventsStream } from "@/components/events-stream";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export default async function EventsPage() {
  const ctx = await getTenantContext();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operador"
        title="Eventos"
        description={`Últimos 50 eventos de ${ctx.tenantName}. Se actualiza solo cada pocos segundos.`}
      />
      <Card>
        <CardHeader title="Cola de eventos" description="Del más reciente al más antiguo" />
        <EventsStream tenantId={ctx.tenantId} />
      </Card>
    </div>
  );
}
