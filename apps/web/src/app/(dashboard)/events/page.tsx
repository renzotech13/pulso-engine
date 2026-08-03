import { getTenantContext } from "@/lib/tenant-context";
import { EventsStream } from "@/components/events-stream";
import { Card } from "@/components/ui/card";

export default async function EventsPage() {
  const ctx = await getTenantContext();

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 font-display text-xs uppercase tracking-[0.2em] text-pulso-accent">
          Observabilidad
        </p>
        <h1 className="font-display text-2xl font-semibold">Eventos — {ctx.tenantName}</h1>
      </div>
      <Card className="p-5">
        <EventsStream tenantId={ctx.tenantId} />
      </Card>
    </div>
  );
}
