"use client";

import { useEffect, useState } from "react";
import { ListTree } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@pulso/db/types";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, label } from "@/lib/labels";

type EventRow = Database["public"]["Tables"]["events"]["Row"];

const POLL_INTERVAL_MS = 3000;
const SKELETON_ROWS = 6;

const EVENT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: "Pendiente", tone: "grey" },
  dispatched: { label: "Enviado", tone: "green" },
  failed: { label: "Falló", tone: "pink" },
};

/**
 * Spanish names for the event types the workers emit (they double as the
 * `trigger` of an agent run). Unknown types fall back to the raw name so a
 * new event still shows up instead of disappearing.
 */
export const EVENT_TYPE: Record<string, string> = {
  "calendar.plan.requested": "Plan de calendario solicitado",
  "calendar.slots.proposed": "Publicaciones propuestas",
  "creative.requested": "Pieza solicitada",
  "creative.generated": "Pieza generada",
  "publish.requested": "Publicación solicitada",
  "publish.completed": "Publicación completada",
  "news.digest.requested": "Resumen de noticias solicitado",
  "news.suggestions.generated": "Ideas de noticias generadas",
  "agent.heartbeat.requested": "Latido solicitado",
  "agent.heartbeat.completed": "Latido completado",
};

function eventStatus(raw: string): { label: string; tone: StatusTone } {
  return EVENT_STATUS[raw] ?? { label: raw, tone: "grey" };
}

const HEADERS = ["Tipo", "Estado", "Intentos", "Creado"];

export function EventsStream({ tenantId }: { tenantId: string }) {
  const [events, setEvents] = useState<EventRow[] | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    async function load() {
      const { data } = await supabase
        .from("events")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled) setEvents(data ?? []);
    }

    void load();
    const interval = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tenantId]);

  if (events === null) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Cargando eventos">
        <div className="skeleton h-3 w-2/3" />
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <div key={i} className="skeleton h-8 w-full" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <EmptyState
        icon={<ListTree size={28} />}
        title="Sin eventos todavía"
        description="Los eventos aparecen aquí apenas un agente o el orquestador los emite."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
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
          {events.map((event) => {
            const status = eventStatus(event.status);
            return (
              <tr key={event.id} className="border-b border-ink-700/60 last:border-b-0">
                <td className="py-2 pr-4">
                  <p className="text-neutral-100">{label(EVENT_TYPE, event.type)}</p>
                  {EVENT_TYPE[event.type] && <p className="text-xs text-neutral-600">{event.type}</p>}
                </td>
                <td className="py-2 pr-4">
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </td>
                <td className="py-2 pr-4 tabular-nums text-neutral-300">{event.attempts}</td>
                <td className="py-2 pr-4 whitespace-nowrap text-neutral-300">{formatDateTime(event.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
