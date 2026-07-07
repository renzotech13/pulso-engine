"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@pulso/db/types";

type EventRow = Database["public"]["Tables"]["events"]["Row"];

const POLL_INTERVAL_MS = 3000;

const STATUS_COLOR: Record<EventRow["status"], string> = {
  pending: "text-amber-400",
  dispatched: "text-emerald-400",
  failed: "text-red-400",
};

export function EventsStream({ tenantId }: { tenantId: string }) {
  const [events, setEvents] = useState<EventRow[]>([]);

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

  if (events.length === 0) {
    return <p className="text-sm text-neutral-500">Sin eventos todavía.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-neutral-500">
          <th className="pb-2">Tipo</th>
          <th className="pb-2">Estado</th>
          <th className="pb-2">Intentos</th>
          <th className="pb-2">Creado</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id} className="border-t border-neutral-800">
            <td className="py-2">{event.type}</td>
            <td className={`py-2 ${STATUS_COLOR[event.status]}`}>{event.status}</td>
            <td className="py-2">{event.attempts}</td>
            <td className="py-2">{new Date(event.created_at).toLocaleTimeString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
