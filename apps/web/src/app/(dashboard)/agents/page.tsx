import { getTenantContext } from "@/lib/tenant-context";
import { AgentRunsTable } from "@/components/agent-runs-table";

export default async function AgentsPage() {
  const ctx = await getTenantContext();

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Agent runs — {ctx.tenantName}</h1>
      <AgentRunsTable tenantId={ctx.tenantId} />
    </div>
  );
}
