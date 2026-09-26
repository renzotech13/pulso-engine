"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const POLL_INTERVAL_MS = 3000;
const IN_PROGRESS = new Set(["pendiente", "procesando"]);

/**
 * Same polling shape as RenderStatus, plus the progress bar — RVM on a long
 * take runs for many minutes, and a bare spinner for that long reads as hung.
 * Progress updates in place; only a status change refreshes the page (so the
 * server component can mint the signed URLs for the finished MP4).
 */
export function BgReplaceStatus({
  jobId,
  initialStatus,
  initialProgress,
}: {
  jobId: string;
  initialStatus: string;
  initialProgress: number;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [progress, setProgress] = useState(initialProgress);

  useEffect(() => {
    if (!IN_PROGRESS.has(status)) return;

    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    async function poll() {
      const { data } = await supabase.from("video_bg_replace_jobs").select("status, progress").eq("id", jobId).maybeSingle();
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

  const label = status === "pendiente" ? "En cola…" : `Recortando a la persona con RVM… ${progress}%`;

  return (
    <div className="space-y-1.5" aria-busy="true">
      <div className="flex items-center gap-2 text-sm text-fg-2">
        <Loader2 size={16} className="animate-spin text-accent-ink" aria-hidden="true" />
        {label}
      </div>
      {status === "procesando" && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
