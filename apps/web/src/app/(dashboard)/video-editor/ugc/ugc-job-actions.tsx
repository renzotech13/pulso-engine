"use client";

import { useState, useTransition } from "react";
import { RotateCw, Trash2 } from "lucide-react";
import { deleteUgcJobAction, regenerateUgcJobAction } from "@/lib/ugc-actions";
import { Button } from "@/components/ui/button";

/** Regenerar cuesta un video nuevo de APIMart (≈ US$0.28): se pide confirmación. */
export function UgcJobActions({ jobId, canRegenerate }: { jobId: string; canRegenerate: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<void>) {
    setError(null);
    start(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Algo falló");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canRegenerate && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (confirm("Regenerar genera un video nuevo y vuelve a costar ≈ US$0.28 en APIMart. ¿Continuar?")) run(() => regenerateUgcJobAction(jobId));
          }}
        >
          <RotateCw size={14} aria-hidden="true" /> Regenerar
        </Button>
      )}
      <Button
        type="button"
        variant="dangerGhost"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (confirm("¿Borrar este video? No se puede deshacer.")) run(() => deleteUgcJobAction(jobId));
        }}
      >
        <Trash2 size={14} aria-hidden="true" /> Borrar
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
