import { getTenantContext } from "@/lib/tenant-context";
import { AgentRunsTable } from "@/components/agent-runs-table";
import { Card } from "@/components/ui/card";

export default async function AgentsPage() {
  const ctx = await getTenantContext();

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 font-display text-xs uppercase tracking-[0.2em] text-pulso-accent">
          Observabilidad
        </p>
        <h1 className="font-display text-2xl font-semibold">Agent runs — {ctx.tenantName}</h1>
      </div>
      <Card className="p-5">
        <AgentRunsTable tenantId={ctx.tenantId} />
      </Card>
    </div>
  );
}
