"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { jobInputSchema } from "@pulso/shared/ugc";
import type { Json } from "@pulso/db/types";
import { createSupabaseServerClient } from "./supabase/server";

const createUgcInput = z.object({
  tenantId: z.string().uuid(),
  /** Presente solo en modo lote: agrupa los videos de una misma tanda. */
  batchNombre: z.string().trim().max(120).optional(),
  jobs: z.array(jobInputSchema).min(1).max(30),
});

/**
 * Corre justo después de que el navegador sube la foto de la protagonista
 * directo a Storage (mismo flujo que el reemplazo de fondo): recibe un objeto
 * plano, no FormData. Un video por fila; en lote comparten batch_id.
 */
export async function createUgcJobsAction(input: z.input<typeof createUgcInput>): Promise<{ jobIds: string[] }> {
  const parsed = createUgcInput.parse(input);
  // RLS ya rechaza un tenant ajeno, pero la ruta es texto libre: sin esto una
  // fila podría apuntar al worker (service_role) a los archivos de otro negocio.
  const prefix = `${parsed.tenantId}/`;
  const ajeno = parsed.jobs.some((j) =>
    j.preset === "situacion"
      ? j.situacion.voz.origen === "audio" && !j.situacion.voz.audioPath.startsWith(prefix)
      : ![j.framePath, j.referenciaPath].every((r) => r === undefined || r.startsWith(prefix)),
  );
  if (ajeno) throw new Error("un archivo subido no pertenece a este negocio");

  const supabase = await createSupabaseServerClient();
  const batchId = parsed.jobs.length > 1 || parsed.batchNombre ? crypto.randomUUID() : null;

  const { data: rows, error } = await supabase
    .from("video_ugc_jobs")
    .insert(
      parsed.jobs.map((j) =>
        j.preset === "situacion"
          ? {
              tenant_id: parsed.tenantId,
              batch_id: batchId,
              nombre: j.nombre,
              preset: "situacion",
              model: "seedance-1-0-pro-fast",
              situacion: j.situacion as unknown as Json,
              elementos: j.elementos as unknown as Json,
            }
          : {
              tenant_id: parsed.tenantId,
              batch_id: batchId,
              nombre: j.nombre,
              preset: "ugc",
              model: j.model,
              // Con referencia, frame_path guarda la foto de referencia y `situacion` marca que hay que generar el primer cuadro.
              frame_path: (j.framePath ?? j.referenciaPath)!,
              ...(j.referenciaPath ? { situacion: { generarPrimerCuadro: true, ropa: j.ropa ?? "" } as unknown as Json } : {}),
              escena: j.escena,
              guion_a: j.guionA,
              guion_b: j.guionB,
              elementos: j.elementos as unknown as Json,
            },
      ),
    )
    .select("id");
  if (error || !rows) throw new Error(error?.message ?? "no se pudieron crear los videos");

  // Cada video emite su evento: el worker de la Mac los toma de a uno.
  for (const row of rows) {
    const { error: rpcError } = await supabase.rpc("request_video_ugc", { target_job_id: row.id });
    if (rpcError) throw new Error(rpcError.message);
  }

  revalidatePath("/video-editor/ugc");
  return { jobIds: rows.map((r) => r.id) };
}

/** Regenerar = volver a encolar el mismo video (mismos guiones y elementos). */
export async function regenerateUgcJobAction(jobId: string): Promise<void> {
  z.string().uuid().parse(jobId);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("request_video_ugc", { target_job_id: jobId });
  if (error) throw new Error(error.message);
  revalidatePath("/video-editor/ugc");
}

export async function deleteUgcJobAction(jobId: string): Promise<void> {
  z.string().uuid().parse(jobId);
  const supabase = await createSupabaseServerClient();
  const { data: job } = await supabase.from("video_ugc_jobs").select("output_path").eq("id", jobId).maybeSingle();
  const { error } = await supabase.from("video_ugc_jobs").delete().eq("id", jobId);
  if (error) throw new Error(error.message);
  if (job?.output_path) await supabase.storage.from("video-editor-output").remove([job.output_path]);
  revalidatePath("/video-editor/ugc");
}
