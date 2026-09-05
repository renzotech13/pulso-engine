"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@pulso/db/types";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AGENT, formatDateTime, formatDuration, label } from "@/lib/labels";
import { EVENT_TYPE } from "@/components/events-stream";

type AgentRun = Database["public"]["Tables"]["agent_runs"]["Row"];

const POLL_INTERVAL_MS = 3000;
const SKELETON_ROWS = 6;

const RUN_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  running: { label: "En curso", tone: "blue" },
  succeeded: { label: "Correcto", tone: "green" },
  failed: { label: "Falló", tone: "pink" },
};

function runStatus(raw: string): { label: string; tone: StatusTone } {
  return RUN_STATUS[raw] ?? { label: raw, tone: "grey" };
}

const HEADERS = ["Agente", "Origen", "Estado", "Inicio", "Duración"];

export function AgentRunsTable({ tenantId }: { tenantId: string }) {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    async function load() {
      const { data } = await supabase
        .from("agent_runs")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("started_at", { ascending: false })
        .limit(50);
      if (!cancelled) setRuns(data ?? []);
    }

    void load();
    const interval = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tenantId]);

  if (runs === null) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Cargando corridas">
        <div className="skeleton h-3 w-2/3" />
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <div key={i} className="skeleton h-8 w-full" />
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={<Activity size={28} />}
        title="Sin corridas todavía"
        description="Si los workers están corriendo, deberían aparecer en menos de un minuto."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-ink-700 text-left text-xs uppercase tracking-wide text-neutral-500">
            {HEADERS.map((h) => (
              <th key={h} scope="col" className="pb-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const status = runStatus(run.status);
            return (
              <tr key={run.id} className="border-b border-ink-700/60 last:border-b-0">
                <td className="py-2 pr-4 text-neutral-100">{label(AGENT, run.agent)}</td>
                <td className="py-2 pr-4 text-neutral-400">{label(EVENT_TYPE, run.trigger)}</td>
                <td className="py-2 pr-4">
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </td>
                <td className="py-2 pr-4 whitespace-nowrap text-neutral-300">{formatDateTime(run.started_at)}</td>
                <td className="py-2 pr-4 whitespace-nowrap text-neutral-300">
                  {run.finished_at
                    ? formatDuration(new Date(run.finished_at).getTime() - new Date(run.started_at).getTime())
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
