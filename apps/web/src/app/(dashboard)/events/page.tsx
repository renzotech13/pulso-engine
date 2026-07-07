import { getTenantContext } from "@/lib/tenant-context";
import { EventsStream } from "@/components/events-stream";

export default async function EventsPage() {
  const ctx = await getTenantContext();

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Eventos — {ctx.tenantName}</h1>
      <EventsStream tenantId={ctx.tenantId} />
    </div>
  );
}
