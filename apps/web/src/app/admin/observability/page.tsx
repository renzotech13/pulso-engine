import { createServiceRoleClient } from "@/lib/supabase/service";
import { TokenUsageChart } from "@/components/token-usage-chart";
import { Card, CardHeader } from "@/components/ui/card";

const CHART_DAYS = 14;
const WINDOW_DAYS = 30;

function startOfDayUTC(daysAgo: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export default async function AdminObservabilityPage() {
  const service = createServiceRoleClient();

  const [{ data: calls }, { data: tenants }] = await Promise.all([
    service
      .from("agent_calls")
      .select("*")
      .gte("created_at", startOfDayUTC(WINDOW_DAYS).toISOString())
      .order("created_at", { ascending: false }),
    service.from("tenants").select("id, name"),
  ]);

  const tenantNameById = new Map((tenants ?? []).map((t) => [t.id, t.name]));
  const todayStart = startOfDayUTC(0);

  interface AggRow {
    tenantId: string;
    tenantName: string;
    agentName: string;
    tokensToday: number;
    tokensMonth: number;
    costMonth: number;
    blockedCount: number;
    latencySum: number;
    latencyCount: number;
  }
  const byKey = new Map<string, AggRow>();
  const dailyTokens = new Map<string, number>();

  for (const call of calls ?? []) {
    const key = `${call.tenant_id}:${call.agent_name}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        tenantId: call.tenant_id,
        tenantName: tenantNameById.get(call.tenant_id) ?? call.tenant_id,
        agentName: call.agent_name,
        tokensToday: 0,
        tokensMonth: 0,
        costMonth: 0,
        blockedCount: 0,
        latencySum: 0,
        latencyCount: 0,
      };
      byKey.set(key, row);
    }

    const tokens = call.input_tokens + call.output_tokens;
    const createdAt = new Date(call.created_at);

    row.tokensMonth += tokens;
    row.costMonth += call.cost_estimated_usd;
    if (createdAt >= todayStart) row.tokensToday += tokens;
    if (call.status === "blocked") row.blockedCount++;
    if (call.status === "success") {
      row.latencySum += call.latency_ms;
      row.latencyCount++;
    }

    const dayKey = call.created_at.slice(0, 10);
    dailyTokens.set(dayKey, (dailyTokens.get(dayKey) ?? 0) + tokens);
  }

  const rows = [...byKey.values()].sort((a, b) => b.tokensMonth - a.tokensMonth);

  const chartData = Array.from({ length: CHART_DAYS }, (_, i) => {
    const day = startOfDayUTC(CHART_DAYS - 1 - i);
    const key = day.toISOString().slice(0, 10);
    return { date: key.slice(5), tokens: dailyTokens.get(key) ?? 0 };
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 font-display text-xs uppercase tracking-[0.2em] text-pulso-accent">
          Panel interno
        </p>
        <h1 className="font-display text-2xl font-semibold">Observabilidad de agentes</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Últimos {WINDOW_DAYS} días, todos los tenants. Costo siempre $0 con LM Studio (local).
        </p>
      </div>

      <Card className="p-5">
        <CardHeader title={`Tokens por día (últimos ${CHART_DAYS})`} />
        <TokenUsageChart data={chartData} />
      </Card>

      <Card className="overflow-hidden p-5">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="pb-2">Tenant</th>
              <th className="pb-2">Agente</th>
              <th className="pb-2">Tokens hoy</th>
              <th className="pb-2">Tokens ({WINDOW_DAYS}d)</th>
              <th className="pb-2">Costo est. ({WINDOW_DAYS}d)</th>
              <th className="pb-2">Bloqueadas</th>
              <th className="pb-2">Latencia prom.</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-neutral-500">
                  Sin llamadas registradas todavía.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={`${row.tenantId}:${row.agentName}`} className="border-t border-ink-700">
                <td className="py-2">{row.tenantName}</td>
                <td className="py-2">{row.agentName}</td>
                <td className="py-2">{row.tokensToday.toLocaleString()}</td>
                <td className="py-2">{row.tokensMonth.toLocaleString()}</td>
                <td className="py-2">${row.costMonth.toFixed(4)}</td>
                <td className={`py-2 ${row.blockedCount > 0 ? "text-status-pink" : ""}`}>
                  {row.blockedCount}
                </td>
                <td className="py-2">
                  {row.latencyCount > 0 ? `${Math.round(row.latencySum / row.latencyCount)}ms` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
