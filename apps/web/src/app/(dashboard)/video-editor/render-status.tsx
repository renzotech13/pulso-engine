"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const POLL_INTERVAL_MS = 3000;

/** Same polling shape as ProcessingStatus, scoped to one video's render instead of the whole project. */
export function RenderStatus({ videoId, initialStatus }: { videoId: string; initialStatus: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    if (status !== "renderizando") return;

    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    async function poll() {
      const { data } = await supabase.from("video_project_videos").select("status").eq("id", videoId).maybeSingle();
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
  }, [videoId, status, router]);

  if (status !== "renderizando") return null;

  return (
    <div className="flex items-center gap-2 text-sm text-fg-2" aria-busy="true">
      <Loader2 size={16} className="animate-spin text-accent-ink" aria-hidden="true" />
      Renderizando…
    </div>
  );
}
