"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const POLL_INTERVAL_MS = 4000;
const IN_PROGRESS = new Set(["pendiente", "generando", "extendiendo", "armando"]);

const LABEL: Record<string, string> = {
  pendiente: "En cola…",
  generando: "Generando el primer tramo (8 s)…",
  extendiendo: "Extendiendo el video…",
  armando: "Armando: destello, títulos y precio…",
};

/** Mismo patrón que BgReplaceStatus: el avance se actualiza en sitio, solo un cambio de estado refresca la página. */
export function UgcStatus({ jobId, initialStatus, initialProgress }: { jobId: string; initialStatus: string; initialProgress: number }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [progress, setProgress] = useState(initialProgress);

  useEffect(() => {
    if (!IN_PROGRESS.has(status)) return;
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    async function poll() {
      const { data } = await supabase.from("video_ugc_jobs").select("status, progress").eq("id", jobId).maybeSingle();
      if (cancelled || !data) return;
      setProgress(data.progress);
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
  }, [jobId, status, router]);

  if (!IN_PROGRESS.has(status)) return null;
  return (
    <div className="space-y-1.5" aria-busy="true">
      <div className="flex items-center gap-2 text-xs text-fg-2">
        <Loader2 size={14} className="animate-spin text-accent-ink" aria-hidden="true" />
        {LABEL[status] ?? status} {status !== "pendiente" && `${progress}%`}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
