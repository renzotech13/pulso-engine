"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const POLL_INTERVAL_MS = 3000;

const STEP_LABEL: Record<string, string> = {
  subido: "Preparando el proyecto…",
  leyendo_guion: "Leyendo el guion…",
  transcribiendo: "Transcribiendo el audio (puede tardar unos minutos)…",
};

/**
 * Polls video_projects.status directly (RLS already scopes this to the
 * tenant's own rows — same pattern as agent-runs-table.tsx) until it leaves
 * the "still processing" states, then refreshes the page so the server
 * component re-renders with whatever comes next (the review screen, or the
 * error message).
 */
export function ProcessingStatus({ projectId, initialStatus }: { projectId: string; initialStatus: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    if (!(status in STEP_LABEL)) return;

    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    async function poll() {
      const { data } = await supabase.from("video_projects").select("status").eq("id", projectId).maybeSingle();
      if (cancelled || !data) return;
      if (data.status !== status) {
        setStatus(data.status);
        router.refresh();
      }
    }

    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId, status, router]);

  if (!(status in STEP_LABEL)) return null;

  return (
    <div className="flex items-center gap-3 rounded-card border border-line bg-surface-2/40 px-4 py-3 text-sm text-fg-2" aria-busy="true">
      <Loader2 size={18} className="animate-spin text-accent-ink" aria-hidden="true" />
      {STEP_LABEL[status]}
    </div>
  );
}
