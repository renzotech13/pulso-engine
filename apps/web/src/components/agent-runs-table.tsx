"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@pulso/db/types";

type AgentRun = Database["public"]["Tables"]["agent_runs"]["Row"];

const POLL_INTERVAL_MS = 3000;

const STATUS_COLOR: Record<AgentRun["status"], string> = {
  running: "text-amber-400",
  succeeded: "text-emerald-400",
  failed: "text-red-400",
};

export function AgentRunsTable({ tenantId }: { tenantId: string }) {
  const [runs, setRuns] = useState<AgentRun[]>([]);

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

  if (runs.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        Sin agent runs todavía. Si los workers están corriendo, deberían aparecer en menos de un minuto.
      </p>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-neutral-500">
          <th className="pb-2">Agente</th>
          <th className="pb-2">Trigger</th>
          <th className="pb-2">Estado</th>
          <th className="pb-2">Inicio</th>
          <th className="pb-2">Duración</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id} className="border-t border-neutral-800">
            <td className="py-2">{run.agent}</td>
            <td className="py-2">{run.trigger}</td>
            <td className={`py-2 ${STATUS_COLOR[run.status]}`}>{run.status}</td>
            <td className="py-2">{new Date(run.started_at).toLocaleTimeString()}</td>
            <td className="py-2">
              {run.finished_at
                ? `${new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()}ms`
                : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
