"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Before this file existed, any error thrown while rendering a dashboard
// page became Next's blank "Application error" screen with the real message
// redacted in production.
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="mx-auto max-w-lg">
      <p className="mb-1 font-display text-xs uppercase tracking-[0.2em] text-status-pink">Algo salió mal</p>
      <h1 className="font-display text-xl">No se pudo mostrar esta página</h1>
      <p className="mt-2 break-words text-sm text-neutral-400">{error.message}</p>
      <div className="mt-4">
        <Button variant="secondary" onClick={reset}>
          Reintentar
        </Button>
      </div>
    </Card>
  );
}
