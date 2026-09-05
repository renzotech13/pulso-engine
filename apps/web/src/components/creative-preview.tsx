"use client";

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * The rendered piece, served by the render-templates service. When that
 * service is down (it runs as a launchd job on the Mac — see the project
 * memory) the <img> 404s and used to leave a broken-image icon with no
 * explanation; this swaps in a proper empty state instead.
 */
export function CreativePreview({
  src,
  alt = "",
  className = "w-full",
}: {
  src: string;
  alt?: string | undefined;
  className?: string | undefined;
}) {
  const [failed, setFailed] = useState(false);
  // Without this, a single 404 (render service down when this src loaded)
  // stays poisoned for every other slot/day visited afterward via client-side
  // nav — the component instance persists across route changes, only `src`
  // changes, so `failed` never got a chance to clear on its own.
  useEffect(() => setFailed(false), [src]);

  if (failed) {
    return (
      <div className="p-4">
        <EmptyState
          icon={<ImageOff size={28} aria-hidden="true" />}
          title="Vista previa no disponible"
          description="El servicio de render está apagado. Enciéndelo y recarga la página para ver la pieza."
        />
      </div>
    );
  }

  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}
